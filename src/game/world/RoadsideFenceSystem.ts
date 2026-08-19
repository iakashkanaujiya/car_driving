import * as THREE from 'three';
import { GAME } from '../config';
import { roadCenter, roadHeading } from '../math';

interface FenceSlot {
  distance: number;
  side: -1 | 1;
}

const SEGMENT_LENGTH = 9.7;
const SEGMENT_COUNT = 36;

/**
 * Maintains a recycled ring of instanced fence geometry around the player.
 * This keeps draw calls fixed even as the simulated road distance grows.
 */
export class RoadsideFenceSystem {
  private readonly slots: FenceSlot[] = [];
  private readonly postGeometry = new THREE.BoxGeometry(0.2, 1.15, 0.2);
  private readonly railGeometry = new THREE.BoxGeometry(0.16, 0.17, SEGMENT_LENGTH);
  private readonly material = new THREE.MeshStandardMaterial({
    color: 0x514431,
    roughness: 0.96,
    metalness: 0,
  });
  private readonly transform = new THREE.Object3D();
  private readonly posts = new THREE.InstancedMesh(
    this.postGeometry,
    this.material,
    SEGMENT_COUNT * 2,
  );
  private readonly rails = new THREE.InstancedMesh(
    this.railGeometry,
    this.material,
    SEGMENT_COUNT * 2,
  );

  constructor(private readonly scene: THREE.Scene) {
    this.posts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rails.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.posts.castShadow = true;
    this.posts.receiveShadow = true;
    this.rails.castShadow = true;
    this.rails.receiveShadow = true;
    // Matrices are rewritten around the player, so static bounds are invalid.
    this.posts.frustumCulled = false;
    this.rails.frustumCulled = false;

    for (let index = 0; index < SEGMENT_COUNT; index += 1) {
      this.slots.push({
        distance: -45 + index * SEGMENT_LENGTH,
        side: Math.floor(index / 6) % 2 === 0 ? -1 : 1,
      });
    }
    this.scene.add(this.posts, this.rails);
  }

  update(playerDistance: number): void {
    const ringLength = this.slots.length * SEGMENT_LENGTH;
    let postIndex = 0;
    let railIndex = 0;

    for (const slot of this.slots) {
      if (slot.distance < playerDistance - 65) slot.distance += ringLength;
      const midpoint = slot.distance + SEGMENT_LENGTH / 2;
      this.setInstance(this.posts, postIndex, slot.distance, slot.side, 0.57);
      this.setInstance(this.posts, postIndex + 1, slot.distance + SEGMENT_LENGTH, slot.side, 0.57);
      this.setInstance(this.rails, railIndex, midpoint, slot.side, 0.48);
      this.setInstance(this.rails, railIndex + 1, midpoint, slot.side, 0.91);
      postIndex += 2;
      railIndex += 2;
    }

    this.posts.instanceMatrix.needsUpdate = true;
    this.rails.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.posts, this.rails);
    this.postGeometry.dispose();
    this.railGeometry.dispose();
    this.material.dispose();
  }

  private setInstance(
    mesh: THREE.InstancedMesh,
    index: number,
    distance: number,
    side: -1 | 1,
    height: number,
  ): void {
    const heading = roadHeading(distance);
    const offset = side * (GAME.roadWidth / 2 + 1.75);
    this.transform.position.set(
      roadCenter(distance) + Math.cos(heading) * offset,
      height,
      -distance - Math.sin(heading) * offset,
    );
    this.transform.rotation.set(0, heading, 0);
    this.transform.scale.set(1, 1, 1);
    this.transform.updateMatrix();
    mesh.setMatrixAt(index, this.transform.matrix);
  }
}
