import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp } from './math';
import type { ForestTextureStore } from './sceneAssets';

export class SceneryAssets {
  private mapleTreePrototype?: THREE.Group;
  private greatMountainPrototype?: THREE.Group;

  constructor(
    private readonly textures: ForestTextureStore,
    private readonly rockMaterial: THREE.MeshStandardMaterial,
  ) {}

  createTree(): THREE.Group {
    const group = new THREE.Group();
    group.userData.kind = 'maple-tree';
    if (this.mapleTreePrototype) group.add(this.mapleTreePrototype.clone(true));
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

  loadTrees(targets: readonly THREE.Group[]): void {
    const loader = new GLTFLoader();
    loader.load(
      `${import.meta.env.BASE_URL}maple_tree/scene.gltf`,
      (gltf) => {
        try {
          const sourceTree = gltf.scene.getObjectByName('instance_0');
          if (!sourceTree) throw new Error('The maple tree root node was not found.');

          gltf.scene.updateMatrixWorld(true);
          const buckets = new Map<string, {
            material: THREE.MeshStandardMaterial;
            geometries: THREE.BufferGeometry[];
          }>();

          sourceTree.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            const sourceMaterial = Array.isArray(object.material) ? object.material[0] : object.material;
            const key = sourceMaterial.name || `material-${sourceMaterial.id}`;
            let bucket = buckets.get(key);

            if (!bucket) {
              const material = sourceMaterial.clone() as THREE.MeshStandardMaterial;
              material.metalness = 0;
              material.roughness = key.includes('leaf') ? 0.88 : 0.96;
              material.aoMap = null;
              material.emissiveMap = null;
              material.emissive?.set(0x000000);
              if (key.includes('leaf')) {
                material.side = THREE.DoubleSide;
                material.map = material.map ? this.createCleanLeafTexture(material.map) : null;
                material.alphaMap = null;
                material.color.set(0x9ab08f);
                material.alphaTest = 0.38;
                material.transparent = false;
                material.depthWrite = true;
              }
              bucket = { material, geometries: [] };
              buckets.set(key, bucket);
            }

            const transformed = object.geometry.clone();
            transformed.applyMatrix4(object.matrixWorld);
            let geometry = transformed;
            if (transformed.index) {
              geometry = transformed.toNonIndexed();
              transformed.dispose();
            }
            for (const attribute of Object.keys(geometry.attributes)) {
              if (!['position', 'normal', 'uv'].includes(attribute)) geometry.deleteAttribute(attribute);
            }
            if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
            bucket.geometries.push(geometry);
          });

          const content = new THREE.Group();
          for (const bucket of buckets.values()) {
            const merged = mergeGeometries(bucket.geometries, false);
            bucket.geometries.forEach((geometry) => geometry.dispose());
            if (!merged) continue;
            merged.computeBoundingBox();
            merged.computeBoundingSphere();
            const mesh = new THREE.Mesh(merged, bucket.material);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            content.add(mesh);
          }

          if (content.children.length === 0) throw new Error('The maple tree geometry could not be merged.');
          const bounds = new THREE.Box3().setFromObject(content);
          const size = bounds.getSize(new THREE.Vector3());
          const center = bounds.getCenter(new THREE.Vector3());
          content.position.set(-center.x, -bounds.min.y, -center.z);

          const prototype = new THREE.Group();
          prototype.scale.setScalar(10 / Math.max(1, size.y));
          prototype.add(content);
          this.mapleTreePrototype = prototype;

          for (const object of targets) {
            if (object.userData.kind !== 'maple-tree') continue;
            object.clear();
            object.add(prototype.clone(true));
          }
        } catch (error) {
          console.error('Could not prepare the maple tree model.', error);
        }
      },
      undefined,
      (error) => console.error('Could not load the maple tree model.', error),
    );
  }

  loadMountains(targets: readonly THREE.Group[]): void {
    const loader = new GLTFLoader();
    loader.load(
      `${import.meta.env.BASE_URL}great_mountain/scene.gltf`,
      (gltf) => {
        try {
          gltf.scene.updateMatrixWorld(true);
          const source = gltf.scene.getObjectByName('Object_2');
          if (!(source instanceof THREE.Mesh)) throw new Error('The mountain mesh was not found.');

          const geometry = source.geometry.clone();
          geometry.applyMatrix4(source.matrixWorld);
          geometry.computeBoundingBox();
          const bounds = geometry.boundingBox;
          if (!bounds) throw new Error('The mountain bounds could not be calculated.');
          const size = bounds.getSize(new THREE.Vector3());
          const center = bounds.getCenter(new THREE.Vector3());
          geometry.translate(-center.x, -bounds.min.y, -center.z);
          geometry.computeBoundingSphere();

          const sourceMaterial = Array.isArray(source.material) ? source.material[0] : source.material;
          const material = sourceMaterial.clone() as THREE.MeshStandardMaterial;
          material.color.set(0x8999a3);
          material.metalness = 0;
          material.roughness = 1;
          material.emissiveMap = null;
          material.emissive?.set(0x000000);

          const mesh = new THREE.Mesh(geometry, material);
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          const prototype = new THREE.Group();
          prototype.scale.setScalar(52 / Math.max(1, size.y));
          prototype.add(mesh);
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

  private createCleanLeafTexture(source: THREE.Texture): THREE.CanvasTexture | null {
    const image = source.image as CanvasImageSource & { width?: number; height?: number };
    const width = image?.width ?? 0;
    const height = image?.height ?? 0;
    if (!width || !height) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;

    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const red = pixels.data[index];
      const green = pixels.data[index + 1];
      const blue = pixels.data[index + 2];
      const minimum = Math.min(red, green, blue);
      const maximum = Math.max(red, green, blue);
      const neutralBackground = minimum > 150 && maximum - minimum < 46;
      const alpha = neutralBackground ? clamp((210 - minimum) * 6, 0, 255) : 255;
      if (alpha < 255) {
        pixels.data[index] = 38;
        pixels.data[index + 1] = 66;
        pixels.data[index + 2] = 28;
      }
      pixels.data[index + 3] = alpha;
    }
    context.putImageData(pixels, 0, 0);

    const cleanTexture = new THREE.CanvasTexture(canvas);
    cleanTexture.colorSpace = source.colorSpace;
    cleanTexture.flipY = source.flipY;
    cleanTexture.wrapS = source.wrapS;
    cleanTexture.wrapT = source.wrapT;
    cleanTexture.magFilter = source.magFilter;
    cleanTexture.minFilter = source.minFilter;
    cleanTexture.anisotropy = source.anisotropy;
    cleanTexture.channel = source.channel;
    cleanTexture.needsUpdate = true;
    this.textures.track(cleanTexture);
    return cleanTexture;
  }
}
