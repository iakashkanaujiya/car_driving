import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm3 } from './world/noise';

interface NatureModelOptions {
  kind: 'pine-tree';
  path: string;
  targetHeight: number;
  castShadow: boolean;
}

export const PINE_TREE_MODEL_PATH = 'tree/pine_tree_1.glb';

/**
 * Builds a weathered boulder: an icosphere displaced by fractal noise, with
 * lichen and moss on upward faces baked into vertex colours.
 */
export function createRockGeometry(seed: number): THREE.BufferGeometry {
  // Polyhedron geometries are already non-indexed, so faces stay faceted.
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const point = new THREE.Vector3();
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    point.fromBufferAttribute(position, vertex);
    const n = fbm3(point.x * 1.3 + seed * 3.1, point.y * 1.3, point.z * 1.3 - seed, 4, seed + 3);
    const scale = 0.72 + n * 0.62;
    point.multiplyScalar(scale);
    // Flatten the base and squash the boulder so it sits naturally in the grass.
    point.y = point.y > 0 ? point.y * 0.72 : point.y * 0.35;
    position.setXYZ(vertex, point.x * 1.25, point.y + 0.35, point.z);
  }
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const stone = new THREE.Color();
  const moss = new THREE.Color(0x4d5a32);
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const tone = fbm3(position.getX(vertex) * 2.4, position.getY(vertex) * 2.4, seed, 3, 9);
    stone.setRGB(0.36 + tone * 0.2, 0.35 + tone * 0.18, 0.33 + tone * 0.16);
    stone.lerp(moss, THREE.MathUtils.smoothstep(normal.getY(vertex), 0.55, 0.9) * 0.55);
    colors[vertex * 3] = stone.r;
    colors[vertex * 3 + 1] = stone.g;
    colors[vertex * 3 + 2] = stone.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Loads and normalizes the nature models shared by the roadside and forest systems. */
export class SceneryAssets {
  private pineTreePrototype?: THREE.Group;

  /** The normalized pine model, available once loadNature() resolves. */
  getPineTreePrototype(): THREE.Group | undefined {
    return this.pineTreePrototype;
  }

  dispose(): void {
    this.pineTreePrototype?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    });
  }

  loadNature(): Promise<void> {
    return this.loadNatureModel({
      kind: 'pine-tree',
      path: PINE_TREE_MODEL_PATH,
      targetHeight: 11,
      castShadow: true,
    });
  }

  private async loadNatureModel(options: NatureModelOptions): Promise<void> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}${options.path}`);
    const prototype = this.prepareNatureModel(gltf.scene, options);
    if (options.kind === 'pine-tree') this.pineTreePrototype = prototype;
  }

  private prepareNatureModel(source: THREE.Group, options: NatureModelOptions): THREE.Group {
    source.updateMatrixWorld(true);
    const materialClones = new Map<THREE.Material, THREE.Material>();
    const buckets = new Map<
      string,
      { material: THREE.Material; geometries: THREE.BufferGeometry[] }
    >();

    source.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
      const sourceMaterial = object.material;
      const cachedMaterial = materialClones.get(sourceMaterial);
      let material: THREE.Material;
      if (cachedMaterial) {
        material = cachedMaterial;
      } else {
        const clonedMaterial = sourceMaterial.clone();
        if (clonedMaterial instanceof THREE.MeshStandardMaterial) {
          clonedMaterial.metalness = 0;
          clonedMaterial.roughness = Math.max(0.82, clonedMaterial.roughness);
          clonedMaterial.emissiveMap = null;
          clonedMaterial.emissive.setHex(0x000000);
        }
        materialClones.set(sourceMaterial, clonedMaterial);
        material = clonedMaterial;
      }

      const geometry = object.geometry.clone();
      geometry.applyMatrix4(object.matrixWorld);
      for (const attribute of Object.keys(geometry.attributes)) {
        if (!['position', 'normal', 'uv', 'uv1'].includes(attribute)) {
          geometry.deleteAttribute(attribute);
        }
      }
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      const signature = Object.keys(geometry.attributes).sort().join(',');
      const key = `${material.uuid}|${signature}|${geometry.index ? 'indexed' : 'plain'}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.geometries.push(geometry);
      else buckets.set(key, { material, geometries: [geometry] });
    });

    const content = new THREE.Group();
    for (const bucket of buckets.values()) {
      const merged = mergeGeometries(bucket.geometries, false);
      bucket.geometries.forEach((geometry) => geometry.dispose());
      if (!merged) continue;
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, bucket.material);
      mesh.castShadow = options.castShadow;
      mesh.receiveShadow = true;
      content.add(mesh);
    }

    if (content.children.length === 0) {
      throw new Error(`${options.kind} contains no usable geometry.`);
    }
    const bounds = new THREE.Box3().setFromObject(content);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y <= 0) {
      throw new Error(`${options.kind} has invalid bounds.`);
    }
    content.position.set(-center.x, -bounds.min.y, -center.z);

    const prototype = new THREE.Group();
    prototype.scale.setScalar(options.targetHeight / size.y);
    prototype.add(content);
    return prototype;
  }
}
