import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

/**
 * Paint is recoloured per car and tail lights are driven by the brake-light
 * code, so each keeps its own material; everything else shares one.
 */
export type CarLodBucket = 'paint' | 'tail' | 'body';

export interface CarLodOptions {
  classify: (material: THREE.Material) => CarLodBucket;
  /** Bake the paint material's colour texture into the paint bucket. */
  paintTexture: boolean;
  /** Fraction of each bucket's triangles the simplifier aims to keep. */
  ratio: number;
  /** Largest allowed deviation, relative to the bucket's extent. */
  error: number;
}

export interface CarLodPart {
  geometry: THREE.BufferGeometry;
  doubleSided: boolean;
}

export type CarLodParts = Partial<Record<CarLodBucket, CarLodPart>>;

/** The dark cabin seen through tinted glass, which the far version bakes opaque. */
const CABIN_COLOR = new THREE.Color(0.018, 0.02, 0.024);
const CREASE_ANGLE = THREE.MathUtils.degToRad(40);
const TEXTURE_SAMPLE_SIZE = 64;
const COLOR_WEIGHT = 0.6;

let simplifierReady = false;
const simplifierLoad: Promise<boolean> = MeshoptSimplifier.supported
  ? MeshoptSimplifier.ready.then(
      () => (simplifierReady = true),
      (error: unknown) => {
        console.warn('Distant car models are unavailable.', error);
        return false;
      },
    )
  : Promise.resolve(false);

/** Resolves to whether far versions can be built (false without WebAssembly). */
export function whenCarLodReady(): Promise<boolean> {
  return simplifierLoad;
}

export function carLodReady(): boolean {
  return simplifierReady;
}

interface BucketData {
  positions: number[];
  colors: number[];
  indices: number[];
  doubleSided: boolean;
}

type TextureSampler = (uv: THREE.Vector2, target: THREE.Color) => void;
const samplers = new WeakMap<THREE.Texture, TextureSampler | null>();

/**
 * Builds a distant stand-in for a car prototype: each bucket is flattened
 * into prototype space, coloured from its materials and textures, and
 * simplified. The result has one mesh per bucket and no textures.
 */
export function buildCarLod(prototype: THREE.Object3D, options: CarLodOptions): CarLodParts {
  if (!simplifierReady) throw new Error('The mesh simplifier is not ready.');
  prototype.updateMatrixWorld(true);
  const buckets = new Map<CarLodBucket, BucketData>();
  const position = new THREE.Vector3();
  const uv = new THREE.Vector2();
  const color = new THREE.Color();
  const texel = new THREE.Color();

  prototype.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return;
    const geometry = object.geometry as THREE.BufferGeometry;
    const positions = geometry.getAttribute('position');
    if (!positions) return;
    const uvs = geometry.getAttribute('uv');
    const vertexColors = geometry.getAttribute('color');
    const index = geometry.getIndex();
    const indexCount = index ? index.count : positions.count;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const ranges =
      Array.isArray(object.material) && geometry.groups.length > 0
        ? geometry.groups.map((group) => ({
            start: group.start,
            count: group.count,
            material: materials[group.materialIndex ?? 0],
          }))
        : [{ start: 0, count: indexCount, material: materials[0] }];

    for (const range of ranges) {
      const material = range.material;
      if (!material) continue;
      const bucketName = options.classify(material);
      let bucket = buckets.get(bucketName);
      if (!bucket) {
        bucket = { positions: [], colors: [], indices: [], doubleSided: false };
        buckets.set(bucketName, bucket);
      }
      if (material.side === THREE.DoubleSide) bucket.doubleSided = true;

      const standard = material as THREE.MeshStandardMaterial;
      const map = bucketName !== 'paint' || options.paintTexture ? standard.map : null;
      const sampler = map && uvs ? textureSampler(map) : null;
      // Paint takes its colour from the per-car material instead.
      const tint = bucketName === 'paint' || !standard.color ? null : standard.color;
      const seeThrough = material.transparent && material.opacity < 0.99 ? material.opacity : 1;
      const useVertexColors = standard.vertexColors && vertexColors;

      const base = bucket.positions.length / 3;
      for (let vertex = 0; vertex < positions.count; vertex += 1) {
        position.fromBufferAttribute(positions, vertex).applyMatrix4(object.matrixWorld);
        bucket.positions.push(position.x, position.y, position.z);
        color.setRGB(1, 1, 1);
        if (tint) color.multiply(tint);
        if (useVertexColors) {
          texel.setRGB(
            vertexColors.getX(vertex),
            vertexColors.getY(vertex),
            vertexColors.getZ(vertex),
          );
          color.multiply(texel);
        }
        if (sampler && uvs) {
          sampler(uv.set(uvs.getX(vertex), uvs.getY(vertex)), texel);
          color.multiply(texel);
        }
        if (seeThrough < 1) color.lerpColors(CABIN_COLOR, color, seeThrough);
        bucket.colors.push(color.r, color.g, color.b);
      }
      // Group counts may be Infinity ("to the end"), so clamp to the index.
      const end = Math.min(range.start + range.count, indexCount);
      for (let offset = range.start; offset < end; offset += 1) {
        bucket.indices.push(base + (index ? index.getX(offset) : offset));
      }
    }
  });

  const parts: CarLodParts = {};
  for (const [name, bucket] of buckets) {
    const geometry = simplifyBucket(bucket, options);
    if (geometry) parts[name] = { geometry, doubleSided: bucket.doubleSided };
  }
  return parts;
}

function simplifyBucket(bucket: BucketData, options: CarLodOptions): THREE.BufferGeometry | null {
  if (bucket.indices.length < 3) return null;
  const source = new THREE.BufferGeometry();
  source.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
  source.setAttribute('color', new THREE.Float32BufferAttribute(bucket.colors, 3));
  source.setIndex(bucket.indices);
  // Welding shared corners lets the simplifier see the surface topology.
  const welded = mergeVertices(source, 1e-4);
  source.dispose();

  const positions = welded.getAttribute('position').array as Float32Array;
  const colors = welded.getAttribute('color').array as Float32Array;
  const indices = Uint32Array.from(welded.getIndex()!.array);
  const target = Math.max(3, Math.floor((indices.length * options.ratio) / 3) * 3);
  const [simplified] = MeshoptSimplifier.simplifyWithAttributes(
    indices,
    positions,
    3,
    colors,
    3,
    [COLOR_WEIGHT, COLOR_WEIGHT, COLOR_WEIGHT],
    null,
    target,
    options.error,
    ['Prune'],
  );
  if (simplified.length < 3) {
    welded.dispose();
    return null;
  }
  welded.setIndex(new THREE.BufferAttribute(simplified, 1));
  // Smooth shading on panels, hard edges where the body creases.
  const result = toCreasedNormals(welded, CREASE_ANGLE);
  welded.dispose();
  result.computeBoundingBox();
  result.computeBoundingSphere();
  return result;
}

/**
 * Reads a colour texture through a small downsampled copy, so a vertex picks
 * up the average colour of the texture region around its UV.
 */
function textureSampler(texture: THREE.Texture): TextureSampler | null {
  const cached = samplers.get(texture);
  if (cached !== undefined) return cached;
  let sampler: TextureSampler | null = null;
  const image = texture.image as (CanvasImageSource & { width?: number }) | undefined;
  if (typeof document !== 'undefined' && image && image.width) {
    try {
      const size = TEXTURE_SAMPLE_SIZE;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context) {
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, size, size);
        const pixels = context.getImageData(0, 0, size, size).data;
        const colorSpace =
          texture.colorSpace === THREE.SRGBColorSpace
            ? THREE.SRGBColorSpace
            : THREE.LinearSRGBColorSpace;
        if (texture.matrixAutoUpdate) texture.updateMatrix();
        sampler = (uv, target) => {
          texture.transformUv(uv);
          const x = Math.min(size - 1, Math.max(0, Math.floor(uv.x * size)));
          const y = Math.min(size - 1, Math.max(0, Math.floor(uv.y * size)));
          const offset = (y * size + x) * 4;
          target.setRGB(
            pixels[offset] / 255,
            pixels[offset + 1] / 255,
            pixels[offset + 2] / 255,
            colorSpace,
          );
        };
      }
    } catch (error) {
      console.warn('Could not sample a car texture for the distant model.', error);
    }
  }
  samplers.set(texture, sampler);
  return sampler;
}
