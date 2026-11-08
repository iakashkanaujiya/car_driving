import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  deinterleaveGeometry,
  mergeGeometries,
} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GAME, WORLD_UNITS_PER_METER } from './config';
import { separateWheels, splitLampsByEnd } from './carParts';
import { buildCarLod, carLodReady, whenCarLodReady } from './rendering/carLod';
import type { CarLodParts } from './rendering/carLod';
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
  /** Turns the model so its nose points along -Z once loaded. */
  rotationY: number;
  displayScale: number;
  paintMaterials: readonly string[];
  rimMaterials?: readonly string[];
  /**
   * Materials of the four tyres. Each tyre's cylinder marks out a wheel, so
   * tyres that share one mesh are separated by corner.
   */
  tyreMaterials?: readonly string[];
  /**
   * Rim, hub and brake-disc materials. With `tyreMaterials`, only the parts
   * inside a tyre's cylinder turn with it; the same material elsewhere (trim,
   * badges) stays on the body.
   */
  wheelMaterials?: readonly string[];
  /** Node names that form the four wheel assemblies. */
  wheelNodes?: readonly string[];
  /**
   * Lamp materials that cover both ends of the car. Each is split into
   * `<name>#front` and `<name>#rear`, which the lamp lists can then name.
   */
  splitLampMaterials?: readonly string[];
  tailMaterials?: readonly string[];
  /** Headlamp lens materials; only their geometry at the front of the car is used. */
  headlampMaterials?: readonly string[];
  tailLightProfile?: Omit<ModelBrakeLight, 'material'>;
  /** Centre-to-centre collision envelope in world units. */
  collision?: CollisionSize;
}

export interface CollisionSize {
  length: number;
  width: number;
}

/** A lamp's centre on the car's right side, in car-local units (forward is -Z). */
export interface LampAnchor {
  x: number;
  y: number;
  z: number;
}

/** Where a car's lamps sit, in world units relative to the car. */
export interface VehicleLightRig {
  /** Bumper-to-bumper length. */
  length: number;
  headlamp: LampAnchor;
  taillamp: LampAnchor;
}

interface Footprint {
  width: number;
  length: number;
  height: number;
}

interface ModelLamps {
  head?: LampAnchor;
  tail?: LampAnchor;
}

/**
 * Finds the centre of one side's lamp cluster from the lens geometry itself.
 * Some lens materials cover both ends of a car, so only vertices more than
 * `minDepth` toward the requested end count. The anchor sits halfway between
 * the cluster's mean and outer edge, on the lens surface at that width: lamps
 * that wrap around a corner sit well forward of a centre light bar.
 */
export function findLampAnchor(
  root: THREE.Object3D,
  materialNames: ReadonlySet<string>,
  end: 'front' | 'rear',
  minDepth: number,
): LampAnchor | undefined {
  if (materialNames.size === 0) return undefined;
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4();
  const inverseRoot = root.matrixWorld.clone().invert();
  const vertex = new THREE.Vector3();
  // Mirrored onto the right side: |x|, y and depth toward the requested end.
  const lens: number[] = [];
  let sumX = 0;
  let outerX = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    if (!materialNames.has(object.material.name)) return;
    toRoot.multiplyMatrices(inverseRoot, object.matrixWorld);
    const positions = object.geometry.getAttribute('position');
    for (let index = 0; index < positions.count; index += 1) {
      vertex.fromBufferAttribute(positions, index).applyMatrix4(toRoot);
      const depth = end === 'front' ? -vertex.z : vertex.z;
      if (depth < minDepth) continue;
      const x = Math.abs(vertex.x);
      lens.push(x, vertex.y, depth);
      sumX += x;
      outerX = Math.max(outerX, x);
    }
  });
  const count = lens.length / 3;
  if (count === 0) return undefined;
  const anchorX = (sumX / count + outerX) / 2;
  // Outboard of the anchor the surface only recedes, so its furthest point
  // toward the end is the lens face at the anchor's own width.
  let sumY = 0;
  let outboard = 0;
  let surface = 0;
  for (let index = 0; index < lens.length; index += 3) {
    if (lens[index] < anchorX) continue;
    sumY += lens[index + 1];
    surface = Math.max(surface, lens[index + 2]);
    outboard += 1;
  }
  return {
    x: anchorX,
    y: sumY / outboard,
    z: end === 'front' ? -surface : surface,
  };
}

/** Scales measured lamp anchors to world units, estimating any the model lacks. */
function createLightRig(footprint: Footprint, lamps: ModelLamps, scale: number): VehicleLightRig {
  const { width, length, height } = footprint;
  const head = lamps.head ?? { x: width * 0.31, y: height * 0.4, z: -length / 2 };
  const tail = lamps.tail ?? { x: width * 0.34, y: height * 0.55, z: length / 2 };
  const scaled = (anchor: LampAnchor): LampAnchor => ({
    x: anchor.x * scale,
    y: anchor.y * scale,
    z: anchor.z * scale,
  });
  return { length: length * scale, headlamp: scaled(head), taillamp: scaled(tail) };
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

interface LodState {
  detailed: THREE.Object3D;
  simplified: THREE.Object3D;
  far: boolean;
}

interface FarModel {
  parts: CarLodParts;
  /** Shared by every car of the model; paint and tail lights are per car. */
  bodyMaterial: THREE.MeshStandardMaterial;
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
/** Traffic beyond this many metres switches to the simplified far model... */
const FAR_MODEL_DISTANCE = 85;
/** ...and returns to full detail inside this distance, so cars never flicker. */
const DETAILED_MODEL_DISTANCE = 75;
const FAR_MODEL_RATIO = 0.1;
const FAR_MODEL_ERROR = 0.01;
const FAR_MODEL_NAME = 'car-far-model';
/** Real-world size of a car, from which its display scale and collision box follow. */
interface CarSize {
  /** Bumper to bumper, in metres. */
  length: number;
  /** Body width without mirrors, in metres. */
  width: number;
}

/** Every model is normalised to this many units long before `displayScale`. */
const NORMALISED_MODEL_LENGTH = 4.6;

/** Display scale and collision box that draw a car at its real size. */
function trueToScale({ length, width }: CarSize): Pick<CarModelSpec, 'displayScale' | 'collision'> {
  return {
    displayScale: (length * WORLD_UNITS_PER_METER) / NORMALISED_MODEL_LENGTH,
    collision: { length: length * WORLD_UNITS_PER_METER, width: width * WORLD_UNITS_PER_METER },
  };
}

/** Rotations that bring a model's nose to -Z. */
const NOSE_TOWARD_PLUS_Z = Math.PI;
const NOSE_TOWARD_MINUS_Z = 0;
const NOSE_TOWARD_PLUS_X = Math.PI / 2;
const NOSE_TOWARD_MINUS_X = -Math.PI / 2;

/**
 * Textured lamp lenses keep their own look at rest and glow red when braking,
 * rather than being tinted dark red.
 */
const TEXTURED_TAIL_LIGHTS: Omit<ModelBrakeLight, 'material'> = {
  restColor: 0xffffff,
  restEmissive: 0x3a0204,
  restIntensity: 0.8,
  brakingColor: 0xff5050,
  brakingEmissive: 0xff0712,
  brakingIntensity: 5.2,
};

const AUDI_ETRON_MODEL_SPEC: CarModelSpec = {
  id: 'luxury-concept',
  path: 'models/cars/audi_e-tron_gt_concept.glb',
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
  headlampMaterials: ['Glass_light'],
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

/**
 * The cars below are prepared from their Sketchfab downloads by
 * scripts/prepare-car-models.mjs; material names are the authors' own.
 */
const SKETCHFAB_MODEL_SPECS: readonly CarModelSpec[] = [
  {
    id: 'volvo-v60-polestar',
    path: 'models/cars/volvo_v60_polestar.glb',
    rotationY: NOSE_TOWARD_MINUS_Z,
    ...trueToScale({ length: 4.64, width: 1.87 }),
    paintMaterials: ['body_paint'],
    tyreMaterials: ['wheel_tire'],
    wheelMaterials: [
      'wheel_disk',
      'wheel_black',
      'wheel_metal',
      'disk_brake',
      'disk_brake_tr.',
      'volvo_logo.tex',
    ],
    tailMaterials: ['headlight_backglass'],
    headlampMaterials: ['hl_front'],
  },
  {
    id: 'jaguar-xj-sport',
    path: 'models/cars/jaguar_xj_sport.glb',
    rotationY: NOSE_TOWARD_PLUS_Z,
    ...trueToScale({ length: 5.02, width: 1.8 }),
    paintMaterials: ['Paint'],
    tyreMaterials: ['Tire'],
    wheelMaterials: ['material', 'Chrome', 'Badging', 'brakes'],
    splitLampMaterials: ['Lights'],
    tailMaterials: ['Lights#rear'],
    headlampMaterials: ['Lens'],
    tailLightProfile: TEXTURED_TAIL_LIGHTS,
  },
  {
    id: 'peugeot-3008',
    path: 'models/cars/peugeot_3008.glb',
    rotationY: NOSE_TOWARD_PLUS_Z,
    ...trueToScale({ length: 4.45, width: 1.84 }),
    paintMaterials: ['CarPaint_Flip1'],
    tyreMaterials: ['wheel.001'],
    wheelMaterials: [
      'rims_black.001',
      'Chrome.001',
      'material_1.001',
      'Material.001',
      'Material.002',
    ],
    tailMaterials: ['Material.lar', 'Material.021'],
    headlampMaterials: ['Material.phare.001'],
  },
  {
    id: 'nissan-z-proto',
    path: 'models/cars/nissan_z_proto.glb',
    rotationY: NOSE_TOWARD_PLUS_Z,
    ...trueToScale({ length: 4.38, width: 1.85 }),
    paintMaterials: ['Material.001'],
    tyreMaterials: ['Material.002'],
    wheelMaterials: ['Material.004', 'Material.003'],
    // The red lamp sits under a dark smoked cover, which must glow with it.
    tailMaterials: ['Material.012', 'Material.011'],
    headlampMaterials: ['Material.009'],
  },
  {
    id: 'nissan-skyline-r34',
    path: 'models/cars/nissan_skyline_r34.glb',
    rotationY: NOSE_TOWARD_PLUS_Z,
    ...trueToScale({ length: 4.6, width: 1.79 }),
    paintMaterials: ['Material.001'],
    tyreMaterials: ['Material.010'],
    wheelMaterials: ['Material.012'],
    tailMaterials: ['Material.009'],
    headlampMaterials: ['Material'],
    tailLightProfile: TEXTURED_TAIL_LIGHTS,
  },
  {
    id: 'mercedes-c63-amg',
    path: 'models/cars/mercedes_c63_amg.glb',
    rotationY: NOSE_TOWARD_PLUS_X,
    ...trueToScale({ length: 4.73, width: 1.8 }),
    paintMaterials: ['CAR_BODY_PAINT'],
    tyreMaterials: ['TARMAC_TYRE_TREAD', 'TARMAC_TYRE_WALL'],
    wheelMaterials: ['TARMAC_WHEEL', 'DISCS'],
    splitLampMaterials: ['LIGHTS_GLASS', 'LIGHTS_POD'],
    tailMaterials: ['LIGHTS_GLASS#rear', 'LIGHTS_POD#rear'],
    headlampMaterials: ['LIGHTS_GLASS#front'],
    tailLightProfile: TEXTURED_TAIL_LIGHTS,
  },
  {
    id: 'bmw-7-series',
    path: 'models/cars/bmw_7_series.glb',
    rotationY: NOSE_TOWARD_MINUS_X,
    ...trueToScale({ length: 5.07, width: 1.9 }),
    paintMaterials: ['Body_Color'],
    tyreMaterials: ['Mold-Tech-11160'],
    wheelMaterials: ['M_0131_Silver', 'M_0132_LightGray', 'M_0133_Gray', 'M_0134_DimGray'],
    tailMaterials: ['Taillight_Glass'],
    headlampMaterials: ['Translucent_Angel_Eyes'],
  },
  {
    id: 'bmw-i8',
    path: 'models/cars/bmw_i8.glb',
    rotationY: NOSE_TOWARD_PLUS_Z,
    ...trueToScale({ length: 4.69, width: 1.94 }),
    paintMaterials: ['paint'],
    tyreMaterials: ['tire'],
    wheelMaterials: ['bhrome_d', 'bhrome', 'chrome', 'disc'],
    tailMaterials: ['glass-red'],
    headlampMaterials: ['light_e'],
  },
  {
    id: 'maybach-vision-6',
    path: 'models/cars/maybach_vision_6.glb',
    rotationY: NOSE_TOWARD_PLUS_Z,
    ...trueToScale({ length: 5.7, width: 2.1 }),
    paintMaterials: ['maybachv6_body'],
    tyreMaterials: ['maybachv6_tire'],
    wheelMaterials: ['maybachv6_rim', 'maybachv6_details', 'maybachv6_black_details'],
    splitLampMaterials: ['maybachv6_light'],
    tailMaterials: ['maybachv6_light#rear'],
    headlampMaterials: ['maybachv6_light#front'],
    tailLightProfile: TEXTURED_TAIL_LIGHTS,
  },
];

/**
 * Unbranded cars from the generic passenger car pack. Their colour is painted
 * into the texture, so they keep it instead of taking a random paint.
 */
function genericCar(
  id: CarModelId,
  file: string,
  materialSuffix: string,
  wheelMaterial: string,
  size: CarSize,
  rotationY = NOSE_TOWARD_MINUS_Z,
): CarModelSpec {
  const optics = `Optics${materialSuffix}`;
  return {
    id,
    path: `models/cars/${file}`,
    rotationY,
    ...trueToScale(size),
    paintMaterials: [],
    tyreMaterials: [wheelMaterial],
    splitLampMaterials: [optics],
    tailMaterials: [`${optics}#rear`],
    headlampMaterials: [`${optics}#front`],
    tailLightProfile: TEXTURED_TAIL_LIGHTS,
  };
}

const GENERIC_MODEL_SPECS: readonly CarModelSpec[] = [
  genericCar('generic-sedan', 'generic_sedan.glb', '_5', 'Wheel_4', { length: 4.36, width: 1.8 }),
  genericCar('generic-wagon', 'generic_wagon.glb', '_8', 'Wheel_7', { length: 4.38, width: 1.8 }),
  genericCar('generic-hatchback', 'generic_hatchback.glb', '_1', 'Wheek', {
    length: 3.96,
    width: 1.72,
  }),
  genericCar('generic-compact', 'generic_compact.glb', '', 'Wheel', { length: 3.26, width: 1.6 }),
  genericCar(
    'generic-coupe',
    'generic_coupe.glb',
    '_0',
    'Wheel_0',
    { length: 4.24, width: 1.82 },
    NOSE_TOWARD_PLUS_Z,
  ),
  genericCar('generic-sport', 'generic_sport.glb', '_6', 'Wheel_5', { length: 3.91, width: 1.77 }),
  genericCar('generic-minivan', 'generic_minivan.glb', '_2', 'Wheel_1', {
    length: 4.61,
    width: 1.87,
  }),
  genericCar('generic-suv', 'generic_suv.glb', '_7', 'Wheel_6', { length: 4.61, width: 1.95 }),
  genericCar('generic-offroad', 'generic_offroad.glb', '_3', 'Wheel_2', {
    length: 3.94,
    width: 1.85,
  }),
  genericCar('generic-pickup', 'generic_pickup.glb', '_4', 'Wheel_3', {
    length: 5.18,
    width: 1.95,
  }),
];

const CAR_MODEL_SPECS: readonly CarModelSpec[] = [
  AUDI_ETRON_MODEL_SPEC,
  ...SKETCHFAB_MODEL_SPECS,
  ...GENERIC_MODEL_SPECS,
];

/** Where a car's file lives and how it is turned to face -Z; exposed for tests. */
export function carModelSource(id: CarModelId): { path: string; rotationY: number } {
  const spec = CAR_MODEL_SPECS.find((candidate) => candidate.id === id);
  if (!spec) throw new Error(`Missing specification for car model: ${id}`);
  return { path: spec.path, rotationY: spec.rotationY };
}

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

/**
 * Any transmissive material makes three.js re-render every opaque object into
 * a mipmapped refraction target each frame. The car glass is authored as
 * alpha-blended tint as well, so blending alone looks nearly identical.
 */
function disableTransmission(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshPhysicalMaterial)) continue;
      if (material.transmission === 0) continue;
      material.transmission = 0;
      if (!material.transparent) {
        // Glass authored without its own blend keeps a light see-through tint.
        material.transparent = true;
        material.opacity = Math.min(material.opacity, 0.35);
        material.depthWrite = false;
      }
    }
  });
}

function createFarMesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  // Far cars sit outside the shadow camera, so they neither cast nor receive.
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

export class VehicleAssets {
  private readonly farModels = new WeakMap<THREE.Group, FarModel | null>();
  /** Multiplies resting tail-light emission while vehicles drive with lights on. */
  private tailLightBoost = 1;

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
    // Far models are built lazily per traffic car, so the simplifier must be
    // ready by the time the models are; it loads alongside them.
    const farModelsReady = whenCarLodReady();
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
    await farModelsReady;
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
    car.userData.lod = undefined;
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

    const footprint = prototype.userData.footprint as Footprint | undefined;
    const lamps = (prototype.userData.lamps ?? {}) as ModelLamps;
    car.userData.lightRig = footprint ? createLightRig(footprint, lamps, car.scale.x) : undefined;
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
    if (!player && modelSpec) {
      this.attachFarModel(car, prototype, modelSpec, instance, modelBrakeLights);
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

  /** Swaps a traffic car between full detail and its far model by road distance. */
  setDetail(car: THREE.Group, distance: number): void {
    const lod = car.userData.lod as LodState | undefined;
    if (!lod) return;
    const far = distance > (lod.far ? DETAILED_MODEL_DISTANCE : FAR_MODEL_DISTANCE);
    if (far === lod.far) return;
    lod.far = far;
    lod.detailed.visible = !far;
    lod.simplified.visible = far;
  }

  /** Brightens resting tail lights by `level` (0 = daytime, 1 = full darkness). */
  setRunningLights(level: number): void {
    this.tailLightBoost = 1 + THREE.MathUtils.clamp(level, 0, 1) * 2.2;
  }

  lightRig(car: THREE.Group): VehicleLightRig | undefined {
    return car.userData.lightRig as VehicleLightRig | undefined;
  }

  isBraking(car: THREE.Group): boolean {
    return car.userData.braking === true;
  }

  setBrakeLights(car: THREE.Group, braking: boolean): void {
    car.userData.braking = braking;
    const boost = this.tailLightBoost;
    const modelBrakeLights = car.userData.modelBrakeLights as ModelBrakeLight[] | undefined;
    for (const light of modelBrakeLights ?? []) {
      light.material.color.setHex(braking ? light.brakingColor : light.restColor);
      light.material.emissive.setHex(braking ? light.brakingEmissive : light.restEmissive);
      light.material.emissiveIntensity = braking
        ? light.brakingIntensity
        : light.restIntensity * boost;
    }

    const material = car.userData.tailMaterial as THREE.MeshStandardMaterial | undefined;
    if (material) {
      const highBrakeOnly = car.userData.highBrakeOnly === true;
      material.color.setHex(braking ? 0xff1d29 : highBrakeOnly ? 0x260205 : 0x681015);
      material.emissive.setHex(braking ? 0xff0712 : highBrakeOnly ? 0x000000 : 0x240003);
      material.emissiveIntensity = braking ? 4.5 : highBrakeOnly ? 0 : 0.7 * boost;
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

  /**
   * Builds (once per model) a simplified, texture-free stand-in with one mesh
   * each for the body, the paint and the tail lights.
   */
  private farModel(prototype: THREE.Group, modelSpec: CarModelSpec): FarModel | null {
    const cached = this.farModels.get(prototype);
    if (cached !== undefined) return cached;
    let model: FarModel | null = null;
    if (carLodReady()) {
      try {
        const paintNames = new Set(modelSpec.paintMaterials);
        const tailNames = new Set(modelSpec.tailMaterials ?? []);
        const parts = buildCarLod(prototype, {
          classify: (material) =>
            paintNames.has(material.name)
              ? 'paint'
              : tailNames.has(material.name)
                ? 'tail'
                : 'body',
          paintTexture: true,
          ratio: FAR_MODEL_RATIO,
          error: FAR_MODEL_ERROR,
        });
        for (const part of Object.values(parts)) part.geometry.userData.sharedResource = true;
        const bodyMaterial = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.5,
          metalness: 0.2,
          side: parts.body?.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
        });
        bodyMaterial.userData.sharedResource = true;
        model = { parts, bodyMaterial };
      } catch (error) {
        console.warn(`Could not build the far model for ${modelSpec.id}.`, error);
      }
    }
    this.farModels.set(prototype, model);
    return model;
  }

  private attachFarModel(
    car: THREE.Group,
    prototype: THREE.Group,
    modelSpec: CarModelSpec,
    detailed: THREE.Group,
    modelBrakeLights: ModelBrakeLight[],
  ): void {
    const model = this.farModel(prototype, modelSpec);
    if (!model) return;
    const { body, paint, tail } = model.parts;
    const simplified = new THREE.Group();
    simplified.name = FAR_MODEL_NAME;
    simplified.visible = false;
    if (body) simplified.add(createFarMesh(body.geometry, model.bodyMaterial));

    if (paint) {
      const paintNames = new Set(modelSpec.paintMaterials);
      let source: THREE.MeshStandardMaterial | undefined;
      detailed.traverse((object) => {
        if (source || !(object instanceof THREE.Mesh)) return;
        const material = object.material as THREE.Material;
        if (material instanceof THREE.MeshStandardMaterial && paintNames.has(material.name)) {
          source = material;
        }
      });
      const material = new THREE.MeshStandardMaterial({
        color: source?.color ?? 0xffffff,
        vertexColors: true,
        metalness: source?.metalness ?? 0.5,
        roughness: source?.roughness ?? 0.3,
        envMapIntensity: source?.envMapIntensity ?? 1,
        side: paint.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      });
      simplified.add(createFarMesh(paint.geometry, material));
    }

    if (tail) {
      const nearLight = modelBrakeLights[0];
      if (nearLight) {
        // Register the far lens as another brake light with the same profile.
        const material = new THREE.MeshStandardMaterial({
          roughness: 0.3,
          metalness: 0,
          side: tail.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
        });
        const light: ModelBrakeLight = { ...nearLight, material };
        material.color.setHex(light.restColor);
        material.emissive.setHex(light.restEmissive);
        material.emissiveIntensity = light.restIntensity;
        modelBrakeLights.push(light);
        simplified.add(createFarMesh(tail.geometry, material));
      } else {
        simplified.add(createFarMesh(tail.geometry, model.bodyMaterial));
      }
    }

    car.add(simplified);
    car.userData.lod = { detailed, simplified, far: false } satisfies LodState;
  }

  private prepareCarModel(
    source: THREE.Group,
    rotationY: number,
    optimize: boolean,
    modelId: VehicleModelId,
  ): THREE.Group {
    const content = source.clone(true);
    this.removeDisabledModelParts(content, modelId);
    disableTransmission(content);
    const orientation = new THREE.Group();
    orientation.rotation.y = rotationY;
    orientation.add(content);
    orientation.updateMatrixWorld(true);
    const spec = CAR_MODEL_SPECS.find((candidate) => candidate.id === modelId);
    splitLampsByEnd(orientation, new Set(spec?.splitLampMaterials));

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
    prototype.userData.footprint = {
      width: footprint.x,
      length: footprint.z,
      height: footprint.y,
    } satisfies Footprint;
    const minDepth = footprint.z * 0.25;
    prototype.userData.lamps = {
      head: findLampAnchor(prototype, new Set(spec?.headlampMaterials), 'front', minDepth),
      tail: findLampAnchor(prototype, new Set(spec?.tailMaterials), 'rear', minDepth),
    } satisfies ModelLamps;
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
    if (modelSpec?.tyreMaterials) {
      const parts = separateWheels(root, new Set(modelSpec.tyreMaterials), wheelMaterialNames);
      if (parts.length === 0) console.warn(`Could not find the four tyres of ${modelId}.`);
      return this.groupWheelPartsByPosition(root, parts);
    }
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
      // Models mix interleaved and plain vertex buffers, and three.js cannot
      // merge the two kinds, so convert every part to plain attributes first.
      deinterleaveGeometry(geometry);
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
      if (!merged) {
        // Keep parts that still cannot be combined rather than losing them.
        for (const geometry of bucket.geometries) {
          mergedRoot.add(new THREE.Mesh(geometry, bucket.material));
        }
        continue;
      }
      bucket.geometries.forEach((geometry) => geometry.dispose());
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
      const defaultProfile: Omit<ModelBrakeLight, 'material'> = {
        restColor: 0x8f1118,
        restEmissive: 0x320003,
        restIntensity: 0.85,
        brakingColor: 0xff2732,
        brakingEmissive: 0xff0712,
        brakingIntensity: 5.2,
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
