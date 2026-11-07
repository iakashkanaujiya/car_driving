import * as THREE from 'three';
import { GAME } from '../config';
import { roadCenter, roadHeading } from '../math';
import { createRockGeometry } from '../sceneryAssets';

const SLOT_COUNT = 44;
const SLOT_SPACING = 12.5;
const FIRST_SLOT_DISTANCE = -45;
const RECYCLE_BEHIND = 70;
/** Every sixth slot holds a boulder cluster instead of a pine. */
const ROCK_SLOT_INTERVAL = 6;
const ROCK_VARIANTS = 4;

interface ScenerySlot {
  distance: number;
  side: -1 | 1;
  offset: number;
  rotation: number;
  scale: number;
  positioned: boolean;
  /** Instance index within the tree meshes, or -1 for a rock slot. */
  treeInstance: number;
}

interface RockPart {
  slot: number;
  variant: number;
  instance: number;
  local: THREE.Matrix4;
}

const initialDistance = (index: number): number => FIRST_SLOT_DISTANCE + index * SLOT_SPACING;

/**
 * Recycles the pines and boulder clusters that line the verge. Every tree and
 * every rock variant is a single instanced mesh, so the verge costs a handful
 * of draw calls (plus the same in the shadow pass) however many slots it has.
 */
export class RoadsideScenerySystem {
  private readonly slots: ScenerySlot[] = [];
  private readonly rockParts: RockPart[] = [];
  private readonly rockGeometries: THREE.BufferGeometry[] = [];
  private readonly rockMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    flatShading: true,
  });
  private readonly rockMeshes: THREE.InstancedMesh[] = [];
  private treeMeshes: THREE.InstancedMesh[] = [];
  /** Per-mesh transform from a tree's origin into the loaded model. */
  private treeOffsets: THREE.Matrix4[] = [];
  private readonly slotMatrix = new THREE.Matrix4();
  private readonly instanceMatrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(private readonly scene: THREE.Scene) {
    let treeCount = 0;
    let rockCount = 0;
    const rockInstances = new Array<number>(ROCK_VARIANTS).fill(0);
    for (let index = 0; index < SLOT_COUNT; index += 1) {
      const isRock = index % ROCK_SLOT_INTERVAL === 0;
      this.slots.push({
        distance: initialDistance(index),
        side: index % 2 === 0 ? -1 : 1,
        offset: GAME.roadWidth / 2 + 6 + ((index * 7) % 10),
        rotation: (index * 2.39) % (Math.PI * 2),
        scale: 0.72 + (index % 5) * 0.11,
        positioned: false,
        treeInstance: isRock ? -1 : treeCount++,
      });
      if (isRock) {
        this.addRockCluster(index, rockCount, rockInstances);
        rockCount += 1;
      }
    }

    for (let variant = 0; variant < ROCK_VARIANTS; variant += 1) {
      this.rockGeometries.push(createRockGeometry(variant + 1));
      const mesh = this.createInstancedMesh(
        this.rockGeometries[variant],
        this.rockMaterial,
        rockInstances[variant],
        `roadside-rock-${variant}`,
      );
      this.rockMeshes.push(mesh);
    }
  }

  /** Instances the loaded pine model into every tree slot. */
  setTreeModel(prototype: THREE.Object3D): void {
    if (this.treeMeshes.length > 0) return;
    const treeCount = this.slots.filter((slot) => slot.treeInstance >= 0).length;
    prototype.updateMatrixWorld(true);
    prototype.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      this.treeMeshes.push(
        this.createInstancedMesh(object.geometry, object.material, treeCount, 'roadside-pine'),
      );
      this.treeOffsets.push(object.matrixWorld.clone());
    });
    this.slots.forEach((slot, index) => {
      if (slot.treeInstance >= 0) this.writeSlot(index);
    });
    this.markDirty(this.treeMeshes);
  }

  update(playerDistance: number): void {
    let changed = false;
    this.slots.forEach((slot, index) => {
      let needsPosition = !slot.positioned;
      if (slot.distance < playerDistance - RECYCLE_BEHIND) {
        slot.distance += SLOT_COUNT * SLOT_SPACING;
        needsPosition = true;
      }
      if (!needsPosition) return;
      this.writeSlot(index);
      slot.positioned = true;
      changed = true;
    });
    if (changed) this.markDirty([...this.treeMeshes, ...this.rockMeshes]);
  }

  reset(): void {
    this.slots.forEach((slot, index) => {
      slot.distance = initialDistance(index);
      slot.positioned = false;
    });
  }

  dispose(): void {
    for (const mesh of [...this.treeMeshes, ...this.rockMeshes]) {
      this.scene.remove(mesh);
      mesh.dispose();
    }
    this.rockGeometries.forEach((geometry) => geometry.dispose());
    this.rockMaterial.dispose();
  }

  /** A boulder with two smaller stones beside it, each a rock-variant instance. */
  private addRockCluster(slot: number, cluster: number, instances: number[]): void {
    const addPart = (variant: number, x: number, y: number, z: number, scale: number): void => {
      this.rockParts.push({
        slot,
        variant,
        instance: instances[variant]++,
        local: new THREE.Matrix4().makeScale(scale, scale, scale).setPosition(x, y, z),
      });
    };
    addPart(cluster % ROCK_VARIANTS, 0, 0, 0, 1.35);
    for (let index = 0; index < 2; index += 1) {
      const angle = (cluster + 1) * 1.7 + index * 2.4;
      addPart(
        (cluster + index + 2) % ROCK_VARIANTS,
        Math.cos(angle) * 2.1,
        -0.05,
        Math.sin(angle) * 1.8,
        0.38 + index * 0.16,
      );
    }
  }

  private writeSlot(index: number): void {
    const slot = this.slots[index];
    const heading = roadHeading(slot.distance);
    const offset = slot.side * slot.offset;
    this.position.set(
      roadCenter(slot.distance) + Math.cos(heading) * offset,
      0,
      -slot.distance - Math.sin(heading) * offset,
    );
    this.rotation.setFromAxisAngle(this.up, slot.rotation);
    this.scale.setScalar(slot.scale);
    this.slotMatrix.compose(this.position, this.rotation, this.scale);

    if (slot.treeInstance >= 0) {
      this.treeMeshes.forEach((mesh, meshIndex) => {
        this.instanceMatrix.multiplyMatrices(this.slotMatrix, this.treeOffsets[meshIndex]);
        mesh.setMatrixAt(slot.treeInstance, this.instanceMatrix);
      });
      return;
    }
    for (const part of this.rockParts) {
      if (part.slot !== index) continue;
      this.instanceMatrix.multiplyMatrices(this.slotMatrix, part.local);
      this.rockMeshes[part.variant].setMatrixAt(part.instance, this.instanceMatrix);
    }
  }

  private markDirty(meshes: readonly THREE.InstancedMesh[]): void {
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
  }

  private createInstancedMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[],
    count: number,
    name: string,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Instances are rewritten along the road, so static bounds would be stale.
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = name;
    this.scene.add(mesh);
    return mesh;
  }
}
