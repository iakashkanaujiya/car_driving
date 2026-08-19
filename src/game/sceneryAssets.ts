import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

interface NatureModelOptions {
  kind: 'pine-tree';
  path: string;
  targetHeight: number;
  castShadow: boolean;
}

export const PINE_TREE_MODEL_PATH = 'tree/pine_tree_1.glb';

export class SceneryAssets {
  private pineTreePrototype?: THREE.Group;
  private greatMountainPrototype?: THREE.Group;

  constructor(private readonly rockMaterial: THREE.MeshStandardMaterial) {}

  createTree(): THREE.Group {
    const group = new THREE.Group();
    group.userData.kind = 'pine-tree';
    if (this.pineTreePrototype) group.add(this.pineTreePrototype.clone(true));
    return group;
  }

  createRock(): THREE.Group {
    const group = new THREE.Group();
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.25, 0), this.rockMaterial);
    rock.scale.set(1.2, 0.7, 0.9);
    rock.position.y = 0.7;
    rock.castShadow = true;
    group.add(rock);
    return group;
  }

  createMountain(): THREE.Group {
    const group = new THREE.Group();
    if (this.greatMountainPrototype) group.add(this.greatMountainPrototype.clone(true));
    return group;
  }

  loadNature(targets: readonly THREE.Group[]): void {
    this.loadNatureModel(targets, {
      kind: 'pine-tree',
      path: PINE_TREE_MODEL_PATH,
      targetHeight: 11,
      castShadow: true,
    });
  }

  private loadNatureModel(
    targets: readonly THREE.Group[],
    options: NatureModelOptions,
  ): void {
    const loader = new GLTFLoader();
    loader.load(
      `${import.meta.env.BASE_URL}${options.path}`,
      (gltf) => {
        try {
          const prototype = this.prepareNatureModel(gltf.scene, options);
          if (options.kind === 'pine-tree') this.pineTreePrototype = prototype;

          for (const object of targets) {
            if (object.userData.kind === options.kind) {
              object.clear();
              object.add(prototype.clone(true));
            }
          }
        } catch (error) {
          console.error(`Could not prepare ${options.kind}.`, error);
        }
      },
      undefined,
      (error) => console.error(`Could not load ${options.kind}.`, error),
    );
  }

  private prepareNatureModel(
    source: THREE.Group,
    options: NatureModelOptions,
  ): THREE.Group {
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

  loadMountains(targets: readonly THREE.Group[]): void {
    const loader = new GLTFLoader();
    loader.load(
      `${import.meta.env.BASE_URL}great_mountain/landscape_mountain_optimized.glb`,
      (gltf) => {
        try {
          gltf.scene.updateMatrixWorld(true);
          const bounds = new THREE.Box3().setFromObject(gltf.scene);
          const size = bounds.getSize(new THREE.Vector3());
          const center = bounds.getCenter(new THREE.Vector3());
          if (!Number.isFinite(size.y) || size.y <= 0) {
            throw new Error('The mountain bounds could not be calculated.');
          }

          gltf.scene.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            object.castShadow = false;
            object.receiveShadow = false;
          });

          const content = new THREE.Group();
          content.position.set(-center.x, -bounds.min.y, -center.z);
          content.add(gltf.scene);

          const prototype = new THREE.Group();
          prototype.scale.setScalar(85 / size.y);
          prototype.add(content);
          this.greatMountainPrototype = prototype;

          for (const mountain of targets) {
            mountain.clear();
            mountain.add(prototype.clone(true));
          }
        } catch (error) {
          console.error('Could not prepare the great mountain model.', error);
        }
      },
      undefined,
      (error) => console.error('Could not load the great mountain model.', error),
    );
  }

}
