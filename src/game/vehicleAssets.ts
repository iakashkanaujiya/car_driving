import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GAME } from './config';
import { selectCarModelIds } from './vehicleCatalog';
import type { CarModelId } from './vehicleCatalog';

export {
  CAR_MODEL_OPTIONS,
  CAR_MODEL_VARIETY_OPTIONS,
  DEFAULT_CAR_MODEL_ID,
  selectCarModelIds,
} from './vehicleCatalog';
export type { CarModelId } from './vehicleCatalog';
export type VehicleModelId = CarModelId;

interface CarModelSpec {
  id: VehicleModelId;
  path: string;
  rotationY: number;
  displayScale: number;
  paintMaterials: readonly string[];
  rimMaterials?: readonly string[];
  wheelMaterials?: readonly string[];
  /** Node names that form the four wheel assemblies. */
  wheelNodes?: readonly string[];
  tailMaterials?: readonly string[];
  tailLightProfile?: Omit<ModelBrakeLight, 'material'>;
  preserveTailColor?: boolean;
  removePaintTexture?: boolean;
  /** Centre-to-centre collision envelope in world units. */
  collision?: CollisionSize;
}

export interface CollisionSize {
  length: number;
  width: number;
}

interface SuspensionState {
  body: THREE.Object3D;
  roll: number;
  pitch: number;
}

interface AnimatedWheel {
  steeringPivot: THREE.Object3D;
  roller: THREE.Object3D;
  radius: number;
  front: boolean;
  rollAxis: 'x' | 'y';
  baseRoll: number;
  baseSteering: number;
  rollAngle: number;
}

interface WheelAssembly {
  parts: THREE.Object3D[];
  front: boolean;
}

interface ModelBrakeLight {
  material: THREE.MeshStandardMaterial;
  restColor: number;
  restEmissive: number;
  restIntensity: number;
  brakingColor: number;
  brakingEmissive: number;
  brakingIntensity: number;
}

export interface LoadedCarModel {
  id: VehicleModelId;
  trafficPrototype: THREE.Group;
  playerPrototype?: THREE.Group;
}

const CAR_COLORS = [
  0xf2f1ea, // Pearl white
  0xb8bec4, // Metallic silver
  0x353a40, // Graphite grey
  0x183f68, // Midnight blue
  0x7a1f2b, // Burgundy red
  0x254c3b, // Forest green
  0x9a5131, // Copper bronze
];
const DRIVER_CAR_COLOR = 0xf5f7f4;
const REAL_CAR_SCALE = 2;
const CONCEPT_CAR_SCALE = 2;
const MAX_BODY_ROLL = 0.045;
const MAX_BODY_PITCH = 0.03;
const BASE_MODEL_SPECS: readonly CarModelSpec[] = [
  {
    id: 'ford-f150-raptor',
    path: 'models/2017_ford_f-150_raptor.glb',
    rotationY: Math.PI,
    displayScale: 2.1,
    paintMaterials: ['RaptorM_CarPaint_Max1'],
    tailMaterials: ['RaptorM_LightGlass_Red_Low1'],
    wheelNodes: ['WHEEL_RF', 'WHEEL_RR', 'WHEEL_LF', 'WHEEL_LR'],
  },
  {
    id: 'ford-everest-sport',
    path: 'models/ford_everest_sport_2023.glb',
    rotationY: Math.PI,
    displayScale: 2.2,
    paintMaterials: ['carpaint'],
    tailMaterials: ['redglass'],
    wheelNodes: ['WHEEL_RF', 'WHEEL_RR', 'WHEEL_LF', 'WHEEL_LR'],
  },
  {
    id: 'ioniq-5',
    path: 'models/hyundai_ioniq_5_-_lowpoly.glb',
    rotationY: Math.PI,
    displayScale: 1.9,
    paintMaterials: ['M_Gravity_Gold_Matte'],
    tailMaterials: ['M_Emission'],
    preserveTailColor: true,
    wheelNodes: ['SM_Wheel_BL_0', 'SM_Wheel_BR_1', 'SM_Wheel_FL_2', 'SM_Wheel_FR_3'],
  },
];
const AUDI_ETRON_MODEL_SPEC: CarModelSpec = {
  id: 'luxury-concept',
  path: 'models/2018_audi_e-tron_gt_concept.glb',
  rotationY: Math.PI,
  displayScale: CONCEPT_CAR_SCALE,
  paintMaterials: ['CarPaint'],
  rimMaterials: ['gtVehicle_Exterior_mm_wheel_009'],
  wheelMaterials: [
    'gtVehicle_Exterior_mm_rotor_009',
    'gtVehicle_Exterior_mm_wheel_009',
    'gtVehicle_Exterior_mm_tyre_009',
  ],
  tailMaterials: ['Emiss'],
  collision: { length: GAME.conceptCollisionLength, width: GAME.conceptCollisionWidth },
  tailLightProfile: {
    restColor: 0xa80000,
    restEmissive: 0x400000,
    restIntensity: 1.2,
    brakingColor: 0xff0000,
    brakingEmissive: 0xff0000,
    brakingIntensity: 8.5,
  },
};
const CAR_MODEL_SPECS: readonly CarModelSpec[] = [...BASE_MODEL_SPECS, AUDI_ETRON_MODEL_SPEC];

let contactShadowResources:
  { geometry: THREE.PlaneGeometry; material: THREE.MeshBasicMaterial } | undefined;

/**
 * A soft rounded-rectangle occlusion blob that grounds every car, independent
 * of shadow-map resolution. Built from a DataTexture so it needs no DOM.
 */
function getContactShadowResources(): {
  geometry: THREE.PlaneGeometry;
  material: THREE.MeshBasicMaterial;
} {
  if (contactShadowResources) return contactShadowResources;
  const width = 64;
  const height = 128;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = Math.abs((x + 0.5) / width - 0.5) * 2;
      const v = Math.abs((y + 0.5) / height - 0.5) * 2;
      // Superellipse distance keeps the blob boxy like a car footprint.
      const d = Math.pow(Math.pow(u, 4) + Math.pow(v, 4), 0.25);
      const alpha = Math.pow(THREE.MathUtils.clamp((1 - d) / 0.42, 0, 1), 1.6);
      const index = (y * width + x) * 4;
      data[index + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000,
    alphaMap: texture,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  material.userData.sharedResource = true;
  material.alphaMap!.userData.sharedResource = true;
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.userData.sharedResource = true;
  contactShadowResources = { geometry, material };
  return contactShadowResources;
}

const CAR_BODY_NAME = 'car-body';

export class VehicleAssets {
  randomColor(): number {
    return CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
  }

  collisionSize(modelId: VehicleModelId): CollisionSize {
    const spec = CAR_MODEL_SPECS.find((candidate) => candidate.id === modelId);
    return spec?.collision ?? { length: GAME.collisionLength, width: GAME.collisionWidth };
  }

  /**
   * Tilts only the sprung body so the tyres stay planted. Positive roll lifts
   * the car's right side (the body leans left), positive pitch lifts the nose.
   */
  updateSuspension(car: THREE.Group, roll: number, pitch: number, dt: number): void {
    const suspension = car.userData.suspension as SuspensionState | undefined;
    if (!suspension) return;
    suspension.roll = THREE.MathUtils.damp(
      suspension.roll,
      THREE.MathUtils.clamp(roll, -MAX_BODY_ROLL, MAX_BODY_ROLL),
      7,
      dt,
    );
    suspension.pitch = THREE.MathUtils.damp(
      suspension.pitch,
      THREE.MathUtils.clamp(pitch, -MAX_BODY_PITCH, MAX_BODY_PITCH),
      6,
      dt,
    );
    suspension.body.rotation.set(suspension.pitch, 0, suspension.roll);
  }

  async loadCarModels(playerModelId: CarModelId, modelCount = 1): Promise<LoadedCarModel[]> {
    const loader = new GLTFLoader();
    const selectedIds = selectCarModelIds(playerModelId, modelCount);
    const selectedSpecs = selectedIds.map((id) => {
      const spec = CAR_MODEL_SPECS.find((candidate) => candidate.id === id);
      if (!spec) throw new Error(`Missing specification for car model: ${id}`);
      return spec;
    });
    const loadedModels = await Promise.all(
      selectedSpecs.map(async (spec): Promise<LoadedCarModel | null> => {
        try {
          const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}${spec.path}`);
          const trafficPrototype = this.prepareCarModel(gltf.scene, spec.rotationY, true, spec.id);
          return {
            id: spec.id,
            trafficPrototype,
            playerPrototype: spec.id === playerModelId ? trafficPrototype : undefined,
          };
        } catch (error) {
          console.error(`Could not load the ${spec.id} car model.`, error);
          return null;
        }
      }),
    );
    return loadedModels.filter((model): model is LoadedCarModel => model !== null);
  }

  replaceVisual(
    car: THREE.Group,
    prototype: THREE.Group,
    player: boolean,
    modelId: VehicleModelId,
  ): void {
    const oldGeometries = new Set<THREE.BufferGeometry>();
    const oldMaterials = new Set<THREE.Material>();
    car.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.geometry.userData.sharedResource !== true) oldGeometries.add(object.geometry);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (material.userData.sharedResource !== true) oldMaterials.add(material);
      });
    });
    car.clear();
    oldGeometries.forEach((geometry) => geometry.dispose());
    oldMaterials.forEach((material) => material.dispose());

    const instance = prototype.clone(true);
    const modelSpec = CAR_MODEL_SPECS.find((spec) => spec.id === modelId);
    const color = player ? DRIVER_CAR_COLOR : this.randomColor();
    this.applyCarColor(instance, modelId, color, player);
    const modelBrakeLights = this.prepareModelBrakeLights(instance, modelId);
    car.add(instance);
    car.scale.setScalar(modelSpec?.displayScale ?? REAL_CAR_SCALE);
    car.userData.modelId = modelId;
    car.userData.frontWheels = [];
    car.userData.animatedWheels = [];
    car.userData.tailMaterial = undefined;
    car.userData.modelBrakeLights = modelBrakeLights;
    car.userData.brakeGlow = undefined;
    car.userData.highBrakeOnly = false;
    const shadowMeshes: THREE.Mesh[] = [];
    car.traverse((object) => {
      if (object instanceof THREE.Mesh) shadowMeshes.push(object);
    });
    car.userData.shadowMeshes = shadowMeshes;
    car.userData.castsShadow = true;

    const sprungBody = instance.getObjectByName(CAR_BODY_NAME);
    car.userData.suspension = sprungBody
      ? ({ body: sprungBody, roll: 0, pitch: 0 } satisfies SuspensionState)
      : undefined;

    const footprint = prototype.userData.footprint as { width: number; length: number } | undefined;
    if (footprint) {
      const { geometry, material } = getContactShadowResources();
      const contactShadow = new THREE.Mesh(geometry, material);
      contactShadow.name = 'contact-shadow';
      contactShadow.scale.set(footprint.width * 1.28, 1, footprint.length * 1.12);
      contactShadow.position.y = 0.012;
      contactShadow.renderOrder = 1;
      contactShadow.castShadow = false;
      contactShadow.receiveShadow = false;
      car.add(contactShadow);
    }

    const animatedWheels: AnimatedWheel[] = [];
    instance.traverse((object) => {
      if (object.userData.isWheelPivot !== true) return;
      const roller = object.children.find((child) => child.userData.isWheelRoller === true);
      if (!roller) return;
      const radius = (object.userData.wheelRadius as number) * car.scale.x;
      animatedWheels.push({
        steeringPivot: object,
        roller,
        radius: Math.max(0.1, radius),
        front: object.userData.frontWheel === true,
        rollAxis: 'x',
        baseRoll: roller.rotation.x,
        baseSteering: object.rotation.y,
        rollAngle: 0,
      });
    });
    car.userData.animatedWheels = animatedWheels;
    car.userData.frontWheels = animatedWheels
      .filter((wheel) => wheel.front)
      .map((wheel) => wheel.steeringPivot);
  }

  setBrakeLights(car: THREE.Group, braking: boolean): void {
    const modelBrakeLights = car.userData.modelBrakeLights as ModelBrakeLight[] | undefined;
    for (const light of modelBrakeLights ?? []) {
      light.material.color.setHex(braking ? light.brakingColor : light.restColor);
      light.material.emissive.setHex(braking ? light.brakingEmissive : light.restEmissive);
      light.material.emissiveIntensity = braking ? light.brakingIntensity : light.restIntensity;
    }

    const material = car.userData.tailMaterial as THREE.MeshStandardMaterial | undefined;
    if (material) {
      const highBrakeOnly = car.userData.highBrakeOnly === true;
      material.color.setHex(braking ? 0xff1d29 : highBrakeOnly ? 0x260205 : 0x681015);
      material.emissive.setHex(braking ? 0xff0712 : highBrakeOnly ? 0x000000 : 0x240003);
      material.emissiveIntensity = braking ? 4.5 : highBrakeOnly ? 0 : 0.7;
    }
    const glow = car.userData.brakeGlow as THREE.PointLight | undefined;
    if (glow) glow.intensity = braking ? 4.2 : 0;
  }

  updateWheelAnimation(
    car: THREE.Group,
    distanceMoved: number,
    steering: number,
    dt: number,
  ): void {
    const wheels = car.userData.animatedWheels as AnimatedWheel[] | undefined;
    if (!wheels) return;

    for (const wheel of wheels) {
      wheel.rollAngle = (wheel.rollAngle - distanceMoved / wheel.radius) % (Math.PI * 2);
      wheel.roller.rotation[wheel.rollAxis] = wheel.baseRoll + wheel.rollAngle;
      if (wheel.front) {
        wheel.steeringPivot.rotation.y = THREE.MathUtils.damp(
          wheel.steeringPivot.rotation.y,
          wheel.baseSteering - steering * 0.48,
          14,
          dt,
        );
      }
    }
  }

  setShadowCasting(car: THREE.Group, enabled: boolean): void {
    if (car.userData.castsShadow === enabled) return;
    const meshes = car.userData.shadowMeshes as THREE.Mesh[] | undefined;
    for (const mesh of meshes ?? []) mesh.castShadow = enabled;
    car.userData.castsShadow = enabled;
  }

  private prepareCarModel(
    source: THREE.Group,
    rotationY: number,
    optimize: boolean,
    modelId: VehicleModelId,
  ): THREE.Group {
    const content = source.clone(true);
    this.removeDisabledModelParts(content, modelId);
    const orientation = new THREE.Group();
    orientation.rotation.y = rotationY;
    orientation.add(content);
    orientation.updateMatrixWorld(true);

    const wheelPivots = this.extractWheelPivots(orientation, modelId);

    const modelRoot = optimize ? this.mergeStaticCarMeshes(orientation) : orientation;
    if (optimize) this.createSprungBody(modelRoot, wheelPivots);
    for (const pivot of wheelPivots) {
      if (optimize) modelRoot.add(pivot);
      else orientation.attach(pivot);
    }
    const prototype = new THREE.Group();
    prototype.add(modelRoot);
    prototype.updateMatrixWorld(true);

    let bounds = new THREE.Box3().setFromObject(prototype);
    const size = bounds.getSize(new THREE.Vector3());
    const horizontalLength = Math.max(size.x, size.z);
    if (!Number.isFinite(horizontalLength) || horizontalLength <= 0) {
      throw new Error('The car model has invalid bounds.');
    }

    modelRoot.scale.setScalar(4.6 / horizontalLength);
    prototype.updateMatrixWorld(true);
    bounds = new THREE.Box3().setFromObject(prototype);
    const center = bounds.getCenter(new THREE.Vector3());
    modelRoot.position.set(-center.x, -bounds.min.y, -center.z);
    prototype.updateMatrixWorld(true);
    prototype.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    prototype.updateMatrixWorld(true);
    for (const pivot of wheelPivots) {
      const wheelSize = new THREE.Box3().setFromObject(pivot, true).getSize(new THREE.Vector3());
      pivot.userData.wheelRadius = Math.max(0.1, wheelSize.y * 0.5);
    }
    const footprint = new THREE.Box3().setFromObject(prototype).getSize(new THREE.Vector3());
    prototype.userData.footprint = { width: footprint.x, length: footprint.z };
    return prototype;
  }

  /**
   * Groups the merged static meshes under a pivot at axle height so body roll
   * and pitch never lift the wheels off the road.
   */
  private createSprungBody(modelRoot: THREE.Group, wheelPivots: readonly THREE.Group[]): void {
    const meshes = [...modelRoot.children];
    if (meshes.length === 0) return;
    const bounds = new THREE.Box3().setFromObject(modelRoot);
    const center = bounds.getCenter(new THREE.Vector3());
    const axleHeight =
      wheelPivots.length > 0
        ? wheelPivots.reduce((sum, pivot) => sum + pivot.position.y, 0) / wheelPivots.length
        : bounds.min.y + (bounds.max.y - bounds.min.y) * 0.25;
    const body = new THREE.Group();
    body.name = CAR_BODY_NAME;
    body.position.set(center.x, axleHeight, center.z);
    for (const mesh of meshes) {
      mesh.position.sub(body.position);
      body.add(mesh);
    }
    modelRoot.add(body);
  }

  private extractWheelPivots(root: THREE.Group, modelId: VehicleModelId): THREE.Group[] {
    const assemblies = this.findWheelAssemblies(root, modelId);
    root.updateMatrixWorld(true);

    return assemblies.map((assembly, index) => {
      const bounds = new THREE.Box3();
      for (const part of assembly.parts) bounds.expandByObject(part, true);
      const pivot = new THREE.Group();
      pivot.name = `driving-wheel-${index}`;
      pivot.position.copy(bounds.getCenter(new THREE.Vector3()));
      pivot.userData.isWheelPivot = true;
      pivot.userData.frontWheel = assembly.front;
      const roller = new THREE.Group();
      roller.name = `driving-wheel-roller-${index}`;
      roller.userData.isWheelRoller = true;
      pivot.add(roller);
      pivot.updateMatrixWorld(true);
      for (const part of assembly.parts) roller.attach(part);
      this.mergeWheelMeshes(roller);
      return pivot;
    });
  }

  private mergeWheelMeshes(pivot: THREE.Group): void {
    pivot.updateMatrixWorld(true);
    const inversePivot = pivot.matrixWorld.clone().invert();
    const buckets = new Map<
      string,
      { material: THREE.Material; geometries: THREE.BufferGeometry[] }
    >();

    pivot.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
      const geometry = object.geometry.clone();
      geometry.applyMatrix4(object.matrixWorld);
      geometry.applyMatrix4(inversePivot);
      const attributeSignature = Object.keys(geometry.attributes).sort().join(',');
      const key = `${object.material.uuid}|${attributeSignature}|${
        geometry.index ? 'indexed' : 'plain'
      }`;
      const bucket = buckets.get(key);
      if (bucket) bucket.geometries.push(geometry);
      else
        buckets.set(key, {
          material: object.material,
          geometries: [geometry],
        });
    });

    const optimizedMeshes: THREE.Mesh[] = [];
    for (const bucket of buckets.values()) {
      const merged =
        bucket.geometries.length === 1
          ? bucket.geometries[0]
          : mergeGeometries(bucket.geometries, false);
      if (merged) {
        optimizedMeshes.push(new THREE.Mesh(merged, bucket.material));
        continue;
      }
      for (const geometry of bucket.geometries) {
        optimizedMeshes.push(new THREE.Mesh(geometry, bucket.material));
      }
    }

    if (optimizedMeshes.length === 0) return;
    pivot.clear();
    for (const mesh of optimizedMeshes) pivot.add(mesh);
  }

  private findWheelAssemblies(root: THREE.Group, modelId: VehicleModelId): WheelAssembly[] {
    const exact = (names: readonly string[]): WheelAssembly[] =>
      this.groupWheelPartsByPosition(
        root,
        names.flatMap((name) => {
          const part = root.getObjectByName(name);
          return part ? [part] : [];
        }),
      );

    const modelSpec = CAR_MODEL_SPECS.find((spec) => spec.id === modelId);
    const wheelMaterialNames = new Set(modelSpec?.wheelMaterials ?? []);
    if (wheelMaterialNames.size > 0) {
      const parts: THREE.Object3D[] = [];
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.some((material) => wheelMaterialNames.has(material.name))) {
          parts.push(object);
        }
      });
      return this.groupWheelPartsByPosition(root, parts);
    }

    return modelSpec?.wheelNodes ? exact(modelSpec.wheelNodes) : [];
  }

  private removeDisabledModelParts(root: THREE.Group, modelId: VehicleModelId): void {
    if (modelId !== 'luxury-concept') return;

    const highBrakeLights: THREE.Object3D[] = [];
    root.traverse((object) => {
      if (
        object instanceof THREE.Mesh &&
        object.name.includes('LOD_A_BRAKES_mm_lights') &&
        !object.name.includes('BRAKES_LEFT') &&
        !object.name.includes('BRAKES_RIGHT')
      ) {
        highBrakeLights.push(object);
      }
    });
    highBrakeLights.forEach((light) => light.removeFromParent());
  }

  private groupWheelPartsByPosition(
    root: THREE.Group,
    parts: readonly THREE.Object3D[],
  ): WheelAssembly[] {
    if (parts.length === 0) return [];
    root.updateMatrixWorld(true);
    const modelCenter = new THREE.Box3().setFromObject(root, true).getCenter(new THREE.Vector3());
    const groups = new Map<string, WheelAssembly>();

    for (const part of new Set(parts)) {
      const bounds = new THREE.Box3().setFromObject(part, true);
      if (bounds.isEmpty()) continue;
      const center = bounds.getCenter(new THREE.Vector3());
      const front = center.z < modelCenter.z;
      const key = `${center.x < modelCenter.x ? 'left' : 'right'}-${front ? 'front' : 'rear'}`;
      const assembly = groups.get(key);
      if (assembly) assembly.parts.push(part);
      else groups.set(key, { parts: [part], front });
    }

    return [...groups.values()];
  }

  private mergeStaticCarMeshes(root: THREE.Group): THREE.Group {
    const buckets = new Map<
      string,
      { material: THREE.Material; geometries: THREE.BufferGeometry[] }
    >();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
      const geometry = object.geometry.clone();
      geometry.applyMatrix4(object.matrixWorld);
      const attributeSignature = Object.keys(geometry.attributes).sort().join(',');
      const key = `${object.material.uuid}|${attributeSignature}|${geometry.index ? 'indexed' : 'plain'}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { material: object.material, geometries: [] };
        buckets.set(key, bucket);
      }
      bucket.geometries.push(geometry);
    });

    const mergedRoot = new THREE.Group();
    for (const bucket of buckets.values()) {
      const merged = mergeGeometries(bucket.geometries, false);
      bucket.geometries.forEach((geometry) => geometry.dispose());
      if (!merged) continue;
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      mergedRoot.add(new THREE.Mesh(merged, bucket.material));
    }
    if (mergedRoot.children.length === 0)
      throw new Error('The car geometry could not be optimized.');
    return mergedRoot;
  }

  private applyCarColor(
    car: THREE.Group,
    modelId: VehicleModelId,
    color: number,
    metallicFinish = false,
  ): void {
    const modelSpec = CAR_MODEL_SPECS.find((spec) => spec.id === modelId);
    if (!modelSpec) return;
    const paintNames = new Set(modelSpec.paintMaterials);
    const rimNames = new Set(modelSpec.rimMaterials ?? []);
    const materialClones = new Map<THREE.Material, THREE.Material>();
    const tintMaterial = (source: THREE.Material): THREE.Material => {
      const isPaint = paintNames.has(source.name);
      const isRim = rimNames.has(source.name);
      if (!isPaint && !isRim) return source;
      const existing = materialClones.get(source);
      if (existing) return existing;
      const material = source.clone();
      if (material instanceof THREE.MeshStandardMaterial) {
        material.color.setHex(isRim ? 0xffffff : color);
        material.emissive.setHex(0x000000);
        material.emissiveMap = null;
        if (isRim) {
          material.map = null;
          material.metalnessMap = null;
          material.roughnessMap = null;
          material.metalness = 0.7;
          material.roughness = 0.2;
          material.envMapIntensity = 1.4;
        } else {
          if (modelSpec.removePaintTexture) material.map = null;
          material.metalness = metallicFinish ? 0.78 : Math.max(material.metalness, 0.48);
          material.roughness = metallicFinish ? 0.18 : Math.min(material.roughness, 0.32);
          material.envMapIntensity = metallicFinish ? 1.35 : material.envMapIntensity;
        }
        material.needsUpdate = true;
      }
      materialClones.set(source, material);
      return material;
    };

    car.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.material = Array.isArray(object.material)
        ? object.material.map(tintMaterial)
        : tintMaterial(object.material);
    });
  }

  private prepareModelBrakeLights(car: THREE.Group, modelId: VehicleModelId): ModelBrakeLight[] {
    const modelSpec = CAR_MODEL_SPECS.find((spec) => spec.id === modelId);
    const tailNames = new Set(modelSpec?.tailMaterials ?? []);
    if (tailNames.size === 0) return [];

    const materialClones = new Map<THREE.MeshStandardMaterial, ModelBrakeLight>();
    const prepareMaterial = (source: THREE.Material): THREE.Material => {
      if (!(source instanceof THREE.MeshStandardMaterial) || !tailNames.has(source.name)) {
        return source;
      }
      const existing = materialClones.get(source);
      if (existing) return existing.material;

      const material = source.clone();
      const preserveColor = modelSpec?.preserveTailColor === true;
      const defaultProfile: Omit<ModelBrakeLight, 'material'> = {
        restColor: preserveColor ? source.color.getHex() : 0x8f1118,
        restEmissive: preserveColor ? source.emissive.getHex() : 0x320003,
        restIntensity: preserveColor ? source.emissiveIntensity : 0.85,
        brakingColor: preserveColor ? source.color.getHex() : 0xff2732,
        brakingEmissive: preserveColor ? source.emissive.getHex() : 0xff0712,
        brakingIntensity: preserveColor ? 3.2 : 5.2,
      };
      const light: ModelBrakeLight = {
        material,
        ...(modelSpec?.tailLightProfile ?? defaultProfile),
      };
      material.color.setHex(light.restColor);
      material.emissive.setHex(light.restEmissive);
      material.emissiveIntensity = light.restIntensity;
      material.needsUpdate = true;
      materialClones.set(source, light);
      return material;
    };

    car.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.material = Array.isArray(object.material)
        ? object.material.map(prepareMaterial)
        : prepareMaterial(object.material);
    });
    return [...materialClones.values()];
  }
}
