import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GAME } from '../config';
import { roadCenter, roadHeading, roadWindowStart } from '../math';
import { mulberry32 } from './noise';

const CHUNK_LENGTH = 40;
const CHUNK_COUNT = 11;
const FAR_TREES_PER_CHUNK = 54;
const NEAR_TREES_PER_CHUNK = 12;
/** The photoreal pine band sits just behind the roadside trees. */
const NEAR_BAND = { min: GAME.roadWidth / 2 + 18, max: 88 };
/** Procedural conifers fill the valley out to the foothills. */
const FAR_BAND = { min: 62, max: 300 };
const NEAR_MODEL_HEIGHT = 11;

export interface ForestTree {
  distance: number;
  offset: number;
  height: number;
  rotation: number;
  tint: number;
}

/**
 * Deterministic tree placement for one road chunk. Trees cluster toward the
 * road and thin out with distance, never encroaching on the verge.
 */
export function forestChunkTrees(
  chunkIndex: number,
  count: number,
  salt = 0,
  band: { min: number; max: number } = FAR_BAND,
): ForestTree[] {
  const random = mulberry32(chunkIndex * 7919 + 104729 + salt * 15485863);
  const trees: ForestTree[] = [];
  for (let index = 0; index < count; index += 1) {
    const side = random() < 0.5 ? -1 : 1;
    const spread = Math.pow(random(), 1.6);
    trees.push({
      distance: chunkIndex * CHUNK_LENGTH + random() * CHUNK_LENGTH,
      offset: side * (band.min + spread * (band.max - band.min)),
      height: 11 + random() * 8 + spread * 7,
      rotation: random() * Math.PI * 2,
      tint: random(),
    });
  }
  return trees;
}

/**
 * A distant conifer: seven drooping, ragged branch tiers around a thin trunk,
 * with darker undersides baked into vertex colours.
 */
export function createPineGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const random = mulberry32(911);
  const trunk = new THREE.CylinderGeometry(0.025, 0.05, 0.3, 5, 1, true);
  trunk.translate(0, 0.15, 0);
  paint(trunk, new THREE.Color(0x3b2a1e), new THREE.Color(0x2a1e15));
  parts.push(trunk);
  const tiers = 7;
  for (let tier = 0; tier < tiers; tier += 1) {
    const t = tier / (tiers - 1);
    const radius = THREE.MathUtils.lerp(0.34, 0.07, Math.pow(t, 0.85));
    const height = THREE.MathUtils.lerp(0.26, 0.17, t);
    const base = 0.1 + t * 0.74;
    const segments = 12;
    const cone = new THREE.ConeGeometry(radius, height, segments, 1, true);
    // Ragged, drooping skirt so the silhouette reads as branches, not a cone.
    const position = cone.getAttribute('position') as THREE.BufferAttribute;
    const jags = Array.from({ length: segments + 1 }, () => 0.62 + random() * 0.38);
    jags[segments] = jags[0];
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      const y = position.getY(vertex);
      if (y >= 0) continue;
      const angle = Math.atan2(position.getZ(vertex), position.getX(vertex));
      const slot = Math.round(((angle + Math.PI) / (Math.PI * 2)) * segments) % (segments + 1);
      const jag = jags[slot] * (slot % 2 === 0 ? 1 : 0.82);
      position.setX(vertex, position.getX(vertex) * jag);
      position.setZ(vertex, position.getZ(vertex) * jag);
      position.setY(vertex, y - 0.05 * jag);
    }
    cone.rotateY(random() * Math.PI);
    cone.translate(0, base + height / 2, 0);
    cone.computeVertexNormals();
    paint(cone, new THREE.Color(0x2c4627), new THREE.Color(0x0e1811));
    parts.push(cone);
  }
  const tip = new THREE.ConeGeometry(0.03, 0.14, 5, 1, true);
  tip.translate(0, 0.98, 0);
  paint(tip, new THREE.Color(0x2c4627), new THREE.Color(0x1a2b1a));
  parts.push(tip);
  const merged = mergeGeometries(
    parts.map((part) => part.toNonIndexed()),
    false,
  );
  parts.forEach((part) => part.dispose());
  if (!merged) throw new Error('Could not build the pine geometry.');
  return merged;
}

/** Vertical gradient: the underside of each branch layer is darker. */
function paint(geometry: THREE.BufferGeometry, top: THREE.Color, bottom: THREE.Color): void {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const t = (position.getY(vertex) - box.min.y) / Math.max(1e-6, box.max.y - box.min.y);
    color.copy(bottom).lerp(top, Math.pow(t, 0.7));
    colors[vertex * 3] = color.r;
    colors[vertex * 3 + 1] = color.g;
    colors[vertex * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

interface ForestLayer {
  meshes: THREE.InstancedMesh[];
  /** Per-mesh transform from the tree's origin into the source model. */
  offsets: THREE.Matrix4[];
  perChunk: number;
  salt: number;
  band: { min: number; max: number };
  /** Scale applied to a tree's height to reach the source model's units. */
  heightScale: number;
}

/**
 * Recycles chunks of instanced conifers around the player: a near band of
 * photoreal pines (medium/high quality) and a far band of light procedural
 * trees that carry the valley to the foothills.
 */
export class ForestSystem {
  private readonly geometry = createPineGeometry();
  private readonly material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
    envMapIntensity: 0.65,
  });
  private readonly layers: ForestLayer[] = [];
  private readonly chunkIndices: number[] = [];
  private readonly transform = new THREE.Object3D();
  private readonly instanceMatrix = new THREE.Matrix4();
  private readonly tint = new THREE.Color();
  private nearLayer?: ForestLayer;
  private nearVisible = true;

  constructor(private readonly scene: THREE.Scene) {
    for (let chunk = 0; chunk < CHUNK_COUNT; chunk += 1) this.chunkIndices.push(chunk - 2);
    this.addLayer({
      meshes: [this.createInstancedMesh(this.geometry, this.material, FAR_TREES_PER_CHUNK, 'far')],
      offsets: [new THREE.Matrix4()],
      perChunk: FAR_TREES_PER_CHUNK,
      salt: 0,
      band: FAR_BAND,
      heightScale: 1,
    });
  }

  /**
   * Instances a loaded tree model (already normalized to NEAR_MODEL_HEIGHT)
   * for the near band. Shares its geometry and materials, so no extra memory.
   */
  setNearModel(prototype: THREE.Object3D): void {
    if (this.nearLayer) return;
    prototype.updateMatrixWorld(true);
    const meshes: THREE.InstancedMesh[] = [];
    const offsets: THREE.Matrix4[] = [];
    prototype.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      meshes.push(
        this.createInstancedMesh(object.geometry, object.material, NEAR_TREES_PER_CHUNK, 'near'),
      );
      offsets.push(object.matrixWorld.clone());
    });
    if (meshes.length === 0) return;
    this.nearLayer = {
      meshes,
      offsets,
      perChunk: NEAR_TREES_PER_CHUNK,
      salt: 1,
      band: NEAR_BAND,
      heightScale: 1 / NEAR_MODEL_HEIGHT,
    };
    this.addLayer(this.nearLayer);
    this.setDense(this.nearVisible);
  }

  /** The photoreal near band is the expensive layer; low quality hides it. */
  setDense(dense: boolean): void {
    this.nearVisible = dense;
    for (const mesh of this.nearLayer?.meshes ?? []) mesh.visible = dense;
  }

  update(playerDistance: number, viewAlong = 1): void {
    const start = roadWindowStart(playerDistance, viewAlong, CHUNK_COUNT * CHUNK_LENGTH, 70);
    const firstWanted = Math.floor(start / CHUNK_LENGTH);
    const lastWanted = firstWanted + CHUNK_COUNT - 1;
    const outside = (chunkIndex: number): boolean =>
      chunkIndex < firstWanted || chunkIndex > lastWanted;
    if (!this.chunkIndices.some(outside)) return;
    // Chunks are generated from their index, so reusing a slot for any missing
    // chunk keeps the forest identical whichever way the player drives.
    const missing: number[] = [];
    for (let chunkIndex = firstWanted; chunkIndex <= lastWanted; chunkIndex += 1) {
      if (!this.chunkIndices.includes(chunkIndex)) missing.push(chunkIndex);
    }
    this.chunkIndices.forEach((chunkIndex, slot) => {
      if (!outside(chunkIndex)) return;
      const next = missing.pop();
      if (next === undefined) return;
      this.chunkIndices[slot] = next;
      this.writeChunk(slot, next);
    });
    this.markDirty();
  }

  reset(): void {
    this.chunkIndices.forEach((_, slot) => {
      this.chunkIndices[slot] = slot - 2;
      this.writeChunk(slot, slot - 2);
    });
    this.markDirty();
  }

  dispose(): void {
    for (const layer of this.layers) {
      for (const mesh of layer.meshes) {
        this.scene.remove(mesh);
        mesh.dispose();
      }
    }
    this.geometry.dispose();
    this.material.dispose();
  }

  private createInstancedMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[],
    perChunk: number,
    name: string,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, perChunk * CHUNK_COUNT);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Instances are spread along the road around the player.
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = `forest-${name}`;
    this.scene.add(mesh);
    return mesh;
  }

  private addLayer(layer: ForestLayer): void {
    this.layers.push(layer);
    this.chunkIndices.forEach((chunkIndex, slot) => this.writeLayerChunk(layer, slot, chunkIndex));
    this.markDirty();
  }

  private markDirty(): void {
    for (const layer of this.layers) {
      for (const mesh of layer.meshes) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  private writeChunk(slot: number, chunkIndex: number): void {
    for (const layer of this.layers) this.writeLayerChunk(layer, slot, chunkIndex);
  }

  private writeLayerChunk(layer: ForestLayer, slot: number, chunkIndex: number): void {
    const trees = forestChunkTrees(chunkIndex, layer.perChunk, layer.salt, layer.band);
    trees.forEach((tree, index) => {
      const heading = roadHeading(tree.distance);
      const scale = tree.height * layer.heightScale;
      this.transform.position.set(
        roadCenter(tree.distance) + Math.cos(heading) * tree.offset,
        -0.2,
        -tree.distance - Math.sin(heading) * tree.offset,
      );
      this.transform.rotation.set(0, tree.rotation, 0);
      this.transform.scale.set(scale * 0.85, scale, scale * 0.85);
      this.transform.updateMatrix();
      const instance = slot * layer.perChunk + index;
      // Mix of deep spruce, blue-green fir and sun-dried pine.
      this.tint.setHSL(0.24 + tree.tint * 0.1, 0.18 + tree.tint * 0.16, 0.74 + tree.tint * 0.18);
      layer.meshes.forEach((mesh, meshIndex) => {
        this.instanceMatrix.multiplyMatrices(this.transform.matrix, layer.offsets[meshIndex]);
        mesh.setMatrixAt(instance, this.instanceMatrix);
        if (layer === this.layers[0]) mesh.setColorAt(instance, this.tint);
      });
    });
  }
}
