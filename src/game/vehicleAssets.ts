import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type CarModelId = "ford-everest-sport" | "ioniq-5";
export type VehicleModelId = CarModelId | "luxury-concept";

export const DEFAULT_CAR_MODEL_ID: CarModelId = "ioniq-5";

export const CAR_MODEL_OPTIONS: readonly { id: CarModelId; label: string }[] = [
  { id: "ford-everest-sport", label: "2023 Ford Everest Sport" },
  { id: "ioniq-5", label: "Hyundai Ioniq 5" },
];

interface CarModelSpec {
  id: VehicleModelId;
  path: string;
  rotationY: number;
  displayScale: number;
  paintMaterials: readonly string[];
  rimMaterials?: readonly string[];
  removePaintTexture?: boolean;
}

interface AnimatedWheel {
  steeringPivot: THREE.Object3D;
  roller: THREE.Object3D;
  radius: number;
  front: boolean;
  rollAxis: "x" | "y";
  baseRoll: number;
  baseSteering: number;
  rollAngle: number;
}

interface WheelAssembly {
  parts: THREE.Object3D[];
  front: boolean;
}

interface CarLoftStation {
  z: number;
  halfWidth: number;
  bottom: number;
  top: number;
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
const PROCEDURAL_CAR_SCALE = 1.55;
const CONCEPT_CAR_SCALE = 1.55;
const REAL_MODEL_SPECS: readonly CarModelSpec[] = [
  {
    id: "ford-everest-sport",
    path: "models/ford_everest_sport_2023.glb",
    rotationY: Math.PI,
    displayScale: 2.05,
    paintMaterials: ["carpaint"],
  },
  {
    id: "ioniq-5",
    path: "models/hyundai_ioniq_5_-_lowpoly.glb",
    rotationY: Math.PI,
    displayScale: 1.9,
    paintMaterials: ["M_Gravity_Gold_Matte"],
  },
];
const CONCEPT_MODEL_SPEC: CarModelSpec = {
  id: "luxury-concept",
  path: "models/luxury_concept_car.glb",
  rotationY: Math.PI,
  displayScale: CONCEPT_CAR_SCALE,
  paintMaterials: ["Material.003"],
  rimMaterials: ["Material.001"],
};
const MODEL_SPECS: readonly CarModelSpec[] = [
  ...REAL_MODEL_SPECS,
  CONCEPT_MODEL_SPEC,
];

export class VehicleAssets {
  randomColor(): number {
    return CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
  }

  createCartoonCar(color: number, player: boolean): THREE.Group {
    const group = new THREE.Group();
    const paint = new THREE.MeshPhysicalMaterial({
      color: player ? DRIVER_CAR_COLOR : color,
      roughness: 0.18,
      metalness: 0.38,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      side: THREE.DoubleSide,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x0a0d11,
      roughness: 0.48,
      metalness: 0.32,
    });
    const rubber = new THREE.MeshStandardMaterial({
      color: 0x08090a,
      roughness: 0.88,
      metalness: 0.02,
    });
    const carbon = new THREE.MeshStandardMaterial({
      color: 0x151a1f,
      roughness: 0.32,
      metalness: 0.62,
    });
    const glass = new THREE.MeshPhysicalMaterial({
      color: player ? 0x183649 : 0x233f4c,
      roughness: 0.12,
      metalness: 0.08,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      transparent: true,
      opacity: 0.94,
      side: THREE.DoubleSide,
    });
    const chrome = new THREE.MeshStandardMaterial({
      color: 0xb9c4c7,
      roughness: 0.22,
      metalness: 0.9,
    });
    const createRearPanel = (
      points: Array<[number, number]>,
      material: THREE.Material,
      z: number,
    ): THREE.Mesh => {
      const shape = new THREE.Shape();
      shape.moveTo(points[0][0], points[0][1]);
      for (let index = 1; index < points.length; index += 1)
        shape.lineTo(points[index][0], points[index][1]);
      shape.closePath();
      const panel = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
      panel.position.z = z;
      return panel;
    };

    const body = new THREE.Mesh(
      this.createCarLoftGeometry([
        { z: -2.34, halfWidth: 0.9, bottom: 0.32, top: 0.68 },
        { z: -2.08, halfWidth: 1.03, bottom: 0.28, top: 0.86 },
        { z: -1.63, halfWidth: 1.09, bottom: 0.25, top: 1.0 },
        { z: -0.82, halfWidth: 1.11, bottom: 0.24, top: 1.07 },
        { z: 0.12, halfWidth: 1.12, bottom: 0.24, top: 1.08 },
        { z: 0.95, halfWidth: 1.11, bottom: 0.25, top: 1.03 },
        { z: 1.64, halfWidth: 1.08, bottom: 0.27, top: 0.92 },
        { z: 2.12, halfWidth: 1.02, bottom: 0.29, top: 0.78 },
        { z: 2.34, halfWidth: 0.94, bottom: 0.33, top: 0.68 },
      ]),
      paint,
    );
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const canopy = new THREE.Mesh(
      this.createCarLoftGeometry([
        { z: -1.12, halfWidth: 0.55, bottom: 1.01, top: 1.08 },
        { z: -0.83, halfWidth: 0.69, bottom: 1.01, top: 1.44 },
        { z: -0.46, halfWidth: 0.75, bottom: 1.01, top: 1.65 },
        { z: 0.34, halfWidth: 0.75, bottom: 1.01, top: 1.67 },
        { z: 0.72, halfWidth: 0.69, bottom: 1.01, top: 1.49 },
        { z: 1.04, halfWidth: 0.54, bottom: 1.01, top: 1.08 },
      ]),
      glass,
    );
    canopy.castShadow = true;
    group.add(canopy);

    const roofGeometry = new THREE.CapsuleGeometry(0.3, 0.54, 4, 14);
    roofGeometry.rotateX(Math.PI / 2);
    const roof = new THREE.Mesh(roofGeometry, carbon);
    roof.scale.set(2.15, 0.18, 1);
    roof.position.set(0, 1.68, 0.02);
    roof.castShadow = true;
    group.add(roof);

    const frontPillar = new THREE.Mesh(
      new THREE.BoxGeometry(1.58, 0.075, 0.1),
      carbon,
    );
    frontPillar.position.set(0, 1.36, -0.75);
    frontPillar.rotation.x = -0.55;
    group.add(frontPillar);
    const rearPillar = frontPillar.clone();
    rearPillar.position.set(0, 1.35, 0.73);
    rearPillar.rotation.x = 0.72;
    group.add(rearPillar);

    const rearWindowBorder = createRearPanel(
      [
        [-0.93, 1.06],
        [0.93, 1.06],
        [0.7, 1.61],
        [-0.7, 1.61],
      ],
      carbon,
      1.075,
    );
    group.add(rearWindowBorder);
    const rearWindow = createRearPanel(
      [
        [-0.84, 1.12],
        [0.84, 1.12],
        [0.63, 1.54],
        [-0.63, 1.54],
      ],
      glass,
      1.082,
    );
    group.add(rearWindow);

    for (const x of [-0.48, 0.48]) {
      const deckAccent = new THREE.Mesh(
        new THREE.BoxGeometry(0.045, 0.035, 0.68),
        carbon,
      );
      deckAccent.position.set(x, 1.035, 1.47);
      deckAccent.rotation.x = -0.07;
      group.add(deckAccent);
    }

    for (const x of [-1.02, 1.02]) {
      const skirt = new THREE.Mesh(
        new THREE.BoxGeometry(0.13, 0.17, 3.35),
        carbon,
      );
      skirt.position.set(x, 0.43, 0.02);
      skirt.castShadow = true;
      group.add(skirt);

      const mirror = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 10, 6),
        paint,
      );
      mirror.scale.set(0.9, 0.45, 0.62);
      mirror.position.set(x * 1.05, 1.28, -0.43);
      mirror.castShadow = true;
      group.add(mirror);
    }

    const tireGeometry = new THREE.TorusGeometry(0.31, 0.13, 10, 28);
    tireGeometry.rotateY(Math.PI / 2);
    const rimGeometry = new THREE.TorusGeometry(0.215, 0.035, 8, 24);
    rimGeometry.rotateY(Math.PI / 2);
    const brakeDiscGeometry = new THREE.CylinderGeometry(
      0.205,
      0.205,
      0.045,
      22,
    );
    brakeDiscGeometry.rotateZ(Math.PI / 2);
    const brakeDiscMaterial = new THREE.MeshStandardMaterial({
      color: 0x6d7477,
      roughness: 0.3,
      metalness: 0.86,
    });
    const caliperMaterial = new THREE.MeshStandardMaterial({
      color: 0xb81920,
      roughness: 0.3,
      metalness: 0.45,
    });
    const frontWheels: THREE.Group[] = [];
    const animatedWheels: AnimatedWheel[] = [];
    for (const x of [-1.1, 1.1]) {
      for (const z of [-1.43, 1.39]) {
        const steeringPivot = new THREE.Group();
        steeringPivot.position.set(x, 0.48, z);
        const roller = new THREE.Group();
        const tire = new THREE.Mesh(tireGeometry, rubber);
        tire.castShadow = true;
        roller.add(tire);

        const rim = new THREE.Mesh(rimGeometry, chrome);
        rim.castShadow = true;
        roller.add(rim);

        const brakeDisc = new THREE.Mesh(brakeDiscGeometry, brakeDiscMaterial);
        roller.add(brakeDisc);
        const outerDirection = Math.sign(x);

        for (let spokeIndex = 0; spokeIndex < 6; spokeIndex += 1) {
          const angle = (spokeIndex / 6) * Math.PI * 2;
          const spoke = new THREE.Mesh(
            new THREE.BoxGeometry(0.035, 0.055, 0.33),
            chrome,
          );
          spoke.position.set(
            outerDirection * 0.135,
            Math.sin(angle) * 0.12,
            Math.cos(angle) * 0.12,
          );
          spoke.rotation.x = -angle;
          roller.add(spoke);
        }
        const hub = new THREE.Mesh(
          new THREE.CylinderGeometry(0.075, 0.075, 0.27, 16),
          chrome,
        );
        hub.geometry.rotateZ(Math.PI / 2);
        roller.add(hub);

        const caliper = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.16, 0.08),
          caliperMaterial,
        );
        caliper.position.set(-outerDirection * 0.025, 0.02, 0.17);
        steeringPivot.add(caliper);
        steeringPivot.add(roller);
        group.add(steeringPivot);
        const front = z < 0;
        if (front) frontWheels.push(steeringPivot);
        animatedWheels.push({
          steeringPivot,
          roller,
          radius: 0.44 * PROCEDURAL_CAR_SCALE,
          front,
          rollAxis: "x",
          baseRoll: roller.rotation.x,
          baseSteering: steeringPivot.rotation.y,
          rollAngle: 0,
        });
      }
    }
    group.userData.frontWheels = frontWheels;
    group.userData.animatedWheels = animatedWheels;

    const frontBumper = new THREE.Mesh(
      new THREE.BoxGeometry(1.78, 0.2, 0.18),
      carbon,
    );
    frontBumper.position.set(0, 0.45, -2.28);
    group.add(frontBumper);
    const splitter = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.08, 0.42),
      carbon,
    );
    splitter.position.set(0, 0.31, -2.18);
    group.add(splitter);
    const grille = new THREE.Mesh(
      new THREE.BoxGeometry(0.94, 0.2, 0.035),
      dark,
    );
    grille.position.set(0, 0.57, -2.385);
    group.add(grille);

    const headlightMaterial = new THREE.MeshBasicMaterial({ color: 0xd9ffff });
    const tailMaterial = new THREE.MeshStandardMaterial({
      color: 0x681015,
      emissive: 0x240003,
      emissiveIntensity: 0.7,
      roughness: 0.32,
    });
    group.userData.tailMaterial = tailMaterial;
    const rearLightPanel = createRearPanel(
      [
        [-1.01, 0.94],
        [1.01, 0.94],
        [0.94, 0.65],
        [-0.94, 0.65],
      ],
      carbon,
      2.285,
    );
    group.add(rearLightPanel);
    for (const x of [-0.66, 0.66]) {
      const headlight = new THREE.Mesh(
        new THREE.BoxGeometry(0.54, 0.15, 0.055),
        headlightMaterial,
      );
      headlight.position.set(x, 0.74, -2.23);
      headlight.rotation.y = x * 0.08;
      group.add(headlight);

      const tail = createRearPanel(
        x < 0
          ? [
              [-0.98, 0.92],
              [-0.3, 0.89],
              [-0.4, 0.7],
              [-0.91, 0.74],
            ]
          : [
              [0.3, 0.89],
              [0.98, 0.92],
              [0.91, 0.74],
              [0.4, 0.7],
            ],
        tailMaterial,
        2.292,
      );
      group.add(tail);
    }
    const centerTail = new THREE.Mesh(
      new THREE.BoxGeometry(0.68, 0.045, 0.04),
      tailMaterial,
    );
    centerTail.position.set(0, 1.13, 1.105);
    group.add(centerTail);

    const rearBumper = createRearPanel(
      [
        [-1.02, 0.62],
        [1.02, 0.62],
        [0.88, 0.38],
        [-0.88, 0.38],
      ],
      carbon,
      2.42,
    );
    group.add(rearBumper);
    const diffuser = new THREE.Mesh(
      new THREE.BoxGeometry(1.82, 0.27, 0.3),
      dark,
    );
    diffuser.position.set(0, 0.31, 2.25);
    group.add(diffuser);
    const diffuserFascia = createRearPanel(
      [
        [-1.01, 0.59],
        [1.01, 0.59],
        [0.84, 0.18],
        [-0.84, 0.18],
      ],
      dark,
      2.5,
    );
    group.add(diffuserFascia);
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.19, 0.025),
      new THREE.MeshBasicMaterial({ color: 0xe8ece7 }),
    );
    plate.position.set(0, 0.51, 2.515);
    group.add(plate);

    for (const x of [-0.7, -0.35, 0, 0.35, 0.7]) {
      const fin = new THREE.Mesh(
        new THREE.BoxGeometry(0.045, 0.17, 0.25),
        carbon,
      );
      fin.position.set(x, 0.2, 2.51);
      fin.rotation.x = -0.18;
      group.add(fin);
    }

    for (const x of [-0.63, 0.63]) {
      const exhaust = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.11, 0.27, 12),
        chrome,
      );
      exhaust.rotation.x = Math.PI / 2;
      exhaust.position.set(x, 0.37, 2.53);
      group.add(exhaust);
      const exhaustOpening = new THREE.Mesh(
        new THREE.CircleGeometry(0.065, 12),
        dark,
      );
      exhaustOpening.position.set(x, 0.37, 2.675);
      group.add(exhaustOpening);
    }

    const wingGeometry = new THREE.CapsuleGeometry(0.07, 2.05, 4, 14);
    wingGeometry.rotateZ(Math.PI / 2);
    const wing = new THREE.Mesh(wingGeometry, carbon);
    wing.scale.set(1, 0.55, 2.05);
    wing.position.set(0, 1.25, 1.74);
    wing.castShadow = true;
    group.add(wing);
    for (const x of [-0.7, 0.7]) {
      const support = new THREE.Mesh(
        new THREE.BoxGeometry(0.075, 0.35, 0.1),
        carbon,
      );
      support.position.set(x, 1.08, 1.72);
      group.add(support);
    }
    for (const x of [-1.11, 1.11]) {
      const endPlate = new THREE.Mesh(
        new THREE.BoxGeometry(0.055, 0.24, 0.43),
        carbon,
      );
      endPlate.position.set(x, 1.25, 1.74);
      group.add(endPlate);
    }

    if (player) {
      const brakeGlow = new THREE.PointLight(0xff1824, 0, 7, 2);
      brakeGlow.position.set(0, 0.58, 2.55);
      group.userData.brakeGlow = brakeGlow;
      group.add(brakeGlow);
    }

    group.scale.setScalar(PROCEDURAL_CAR_SCALE);
    return group;
  }

  async loadRealModels(playerModelId: CarModelId): Promise<LoadedCarModel[]> {
    const loader = new GLTFLoader();
    const loadedModels = await Promise.all(
      REAL_MODEL_SPECS.map(async (spec): Promise<LoadedCarModel | null> => {
        try {
          const gltf = await loader.loadAsync(
            `${import.meta.env.BASE_URL}${spec.path}`,
          );
          const trafficPrototype = this.prepareCarModel(
            gltf.scene,
            spec.rotationY,
            true,
            spec.id,
          );
          return {
            id: spec.id,
            trafficPrototype,
            playerPrototype:
              spec.id === playerModelId ? trafficPrototype : undefined,
          };
        } catch (error) {
          console.error(`Could not load the ${spec.id} car model.`, error);
          return null;
        }
      }),
    );
    return loadedModels.filter(
      (model): model is LoadedCarModel => model !== null,
    );
  }

  async loadConceptModel(): Promise<LoadedCarModel | null> {
    const loader = new GLTFLoader();
    try {
      const gltf = await loader.loadAsync(
        `${import.meta.env.BASE_URL}${CONCEPT_MODEL_SPEC.path}`,
      );
      const prototype = this.prepareCarModel(
        gltf.scene,
        CONCEPT_MODEL_SPEC.rotationY,
        true,
        CONCEPT_MODEL_SPEC.id,
      );
      return {
        id: CONCEPT_MODEL_SPEC.id,
        trafficPrototype: prototype,
        playerPrototype: prototype,
      };
    } catch (error) {
      console.error("Could not load the luxury concept car model.", error);
      return null;
    }
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
      oldGeometries.add(object.geometry);
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      materials.forEach((material) => oldMaterials.add(material));
    });
    car.clear();
    oldGeometries.forEach((geometry) => geometry.dispose());
    oldMaterials.forEach((material) => material.dispose());

    const instance = prototype.clone(true);
    this.applyCarColor(
      instance,
      modelId,
      player ? DRIVER_CAR_COLOR : this.randomColor(),
      player,
    );
    instance.updateMatrixWorld(true);
    const modelBounds = new THREE.Box3().setFromObject(instance, true);
    car.add(instance);
    const modelSpec = MODEL_SPECS.find((spec) => spec.id === modelId);
    car.scale.setScalar(modelSpec?.displayScale ?? REAL_CAR_SCALE);
    car.userData.modelId = modelId;
    car.userData.frontWheels = [];
    car.userData.animatedWheels = [];
    car.userData.tailMaterial = undefined;
    car.userData.brakeGlow = undefined;
    car.userData.highBrakeOnly = false;

    const animatedWheels: AnimatedWheel[] = [];
    instance.traverse((object) => {
      if (object.userData.isWheelPivot !== true) return;
      const roller = object.children.find(
        (child) => child.userData.isWheelRoller === true,
      );
      if (!roller) return;
      const radius = (object.userData.wheelRadius as number) * car.scale.x;
      animatedWheels.push({
        steeringPivot: object,
        roller,
        radius: Math.max(0.1, radius),
        front: object.userData.frontWheel === true,
        rollAxis: "x",
        baseRoll: roller.rotation.x,
        baseSteering: object.rotation.y,
        rollAngle: 0,
      });
    });
    car.userData.animatedWheels = animatedWheels;
    car.userData.frontWheels = animatedWheels
      .filter((wheel) => wheel.front)
      .map((wheel) => wheel.steeringPivot);

    if (player) this.addHighMountedBrakeLight(car, modelBounds);
  }

  setBrakeLights(car: THREE.Group, braking: boolean): void {
    const material = car.userData.tailMaterial as
      | THREE.MeshStandardMaterial
      | undefined;
    if (material) {
      const highBrakeOnly = car.userData.highBrakeOnly === true;
      material.color.setHex(
        braking ? 0xff1d29 : highBrakeOnly ? 0x260205 : 0x681015,
      );
      material.emissive.setHex(
        braking ? 0xff0712 : highBrakeOnly ? 0x000000 : 0x240003,
      );
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
      wheel.rollAngle =
        (wheel.rollAngle - distanceMoved / wheel.radius) % (Math.PI * 2);
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

  private prepareCarModel(
    source: THREE.Group,
    rotationY: number,
    optimize: boolean,
    modelId: VehicleModelId,
  ): THREE.Group {
    const content = source.clone(true);
    const orientation = new THREE.Group();
    orientation.rotation.y = rotationY;
    orientation.add(content);
    orientation.updateMatrixWorld(true);

    const wheelPivots = this.extractWheelPivots(orientation, modelId);

    const modelRoot = optimize
      ? this.mergeStaticCarMeshes(orientation)
      : orientation;
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
      throw new Error("The car model has invalid bounds.");
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
      const wheelSize = new THREE.Box3()
        .setFromObject(pivot, true)
        .getSize(new THREE.Vector3());
      pivot.userData.wheelRadius = Math.max(0.1, wheelSize.y * 0.5);
    }
    return prototype;
  }

  private extractWheelPivots(
    root: THREE.Group,
    modelId: VehicleModelId,
  ): THREE.Group[] {
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
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material))
        return;
      const geometry = object.geometry.clone();
      geometry.applyMatrix4(object.matrixWorld);
      geometry.applyMatrix4(inversePivot);
      const attributeSignature = Object.keys(geometry.attributes)
        .sort()
        .join(",");
      const key = `${object.material.uuid}|${attributeSignature}|${
        geometry.index ? "indexed" : "plain"
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

  private findWheelAssemblies(
    root: THREE.Group,
    modelId: VehicleModelId,
  ): WheelAssembly[] {
    const exact = (names: readonly string[]): WheelAssembly[] =>
      this.groupWheelPartsByPosition(
        root,
        names.flatMap((name) => {
          const part = root.getObjectByName(name);
          return part ? [part] : [];
        }),
      );

    if (modelId === "ford-everest-sport") {
      return exact(["WHEEL_RF", "WHEEL_RR", "WHEEL_LF", "WHEEL_LR"]);
    }
    if (modelId === "ioniq-5") {
      return exact([
        "SM_Wheel_BL_0",
        "SM_Wheel_BR_1",
        "SM_Wheel_FL_2",
        "SM_Wheel_FR_3",
      ]);
    }
    if (modelId === "luxury-concept") {
      return exact([
        "Circle002_1",
        "Shape_IndexedFaceSet_2",
        "Circle001_3",
        "Shape_IndexedFaceSet001_4",
        "Circle003_5",
        "Shape_IndexedFaceSet002_6",
        "Circle004_7",
        "Shape_IndexedFaceSet003_8",
      ]);
    }
    return [];
  }

  private groupWheelPartsByPosition(
    root: THREE.Group,
    parts: readonly THREE.Object3D[],
  ): WheelAssembly[] {
    if (parts.length === 0) return [];
    root.updateMatrixWorld(true);
    const modelCenter = new THREE.Box3()
      .setFromObject(root, true)
      .getCenter(new THREE.Vector3());
    const groups = new Map<string, WheelAssembly>();

    for (const part of new Set(parts)) {
      const bounds = new THREE.Box3().setFromObject(part, true);
      if (bounds.isEmpty()) continue;
      const center = bounds.getCenter(new THREE.Vector3());
      const front = center.z < modelCenter.z;
      const key = `${center.x < modelCenter.x ? "left" : "right"}-${
        front ? "front" : "rear"
      }`;
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
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material))
        return;
      const geometry = object.geometry.clone();
      geometry.applyMatrix4(object.matrixWorld);
      const attributeSignature = Object.keys(geometry.attributes)
        .sort()
        .join(",");
      const key = `${object.material.uuid}|${attributeSignature}|${geometry.index ? "indexed" : "plain"}`;
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
      throw new Error("The car geometry could not be optimized.");
    return mergedRoot;
  }

  private applyCarColor(
    car: THREE.Group,
    modelId: VehicleModelId,
    color: number,
    metallicFinish = false,
  ): void {
    const modelSpec = MODEL_SPECS.find((spec) => spec.id === modelId);
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
          material.metalness = 0.7;
          material.roughness = 0.2;
          material.envMapIntensity = 1.4;
        } else {
          if (modelSpec.removePaintTexture) material.map = null;
          material.metalness = metallicFinish
            ? 0.78
            : Math.max(material.metalness, 0.48);
          material.roughness = metallicFinish
            ? 0.18
            : Math.min(material.roughness, 0.32);
          material.envMapIntensity = metallicFinish
            ? 1.35
            : material.envMapIntensity;
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

  private addHighMountedBrakeLight(car: THREE.Group, bounds: THREE.Box3): void {
    const size = bounds.getSize(new THREE.Vector3());
    const material = new THREE.MeshStandardMaterial({
      color: 0x260205,
      emissive: 0x000000,
      emissiveIntensity: 0,
      roughness: 0.24,
    });
    const light = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(0.5, size.x * 0.34), 0.055, 0.045),
      material,
    );
    light.position.set(
      0,
      bounds.min.y + size.y * 0.82,
      bounds.max.z - size.z * 0.12,
    );
    car.userData.tailMaterial = material;
    car.userData.highBrakeOnly = true;
    car.add(light);
  }

  private createCarLoftGeometry(
    stations: readonly CarLoftStation[],
  ): THREE.BufferGeometry {
    const sectionProfile: ReadonlyArray<readonly [number, number]> = [
      [-0.68, 0],
      [-0.94, 0.12],
      [-1, 0.48],
      [-0.96, 0.76],
      [-0.72, 0.94],
      [0, 1],
      [0.72, 0.94],
      [0.96, 0.76],
      [1, 0.48],
      [0.94, 0.12],
      [0.68, 0],
    ];
    const vertices: number[] = [];
    const indices: number[] = [];

    for (const station of stations) {
      const height = station.top - station.bottom;
      for (const [widthRatio, heightRatio] of sectionProfile) {
        vertices.push(
          widthRatio * station.halfWidth,
          station.bottom + heightRatio * height,
          station.z,
        );
      }
    }

    const sectionSize = sectionProfile.length;
    for (let stationIndex = 0; stationIndex < stations.length - 1; stationIndex += 1) {
      const current = stationIndex * sectionSize;
      const next = current + sectionSize;
      for (let pointIndex = 0; pointIndex < sectionSize; pointIndex += 1) {
        const followingPoint = (pointIndex + 1) % sectionSize;
        const a = current + pointIndex;
        const b = next + pointIndex;
        const c = next + followingPoint;
        const d = current + followingPoint;
        indices.push(a, b, c, a, c, d);
      }
    }

    const frontCenter = vertices.length / 3;
    const frontStation = stations[0];
    vertices.push(0, (frontStation.bottom + frontStation.top) / 2, frontStation.z);
    const rearCenter = vertices.length / 3;
    const rearStation = stations[stations.length - 1];
    vertices.push(0, (rearStation.bottom + rearStation.top) / 2, rearStation.z);
    const rearStart = (stations.length - 1) * sectionSize;
    for (let pointIndex = 0; pointIndex < sectionSize; pointIndex += 1) {
      const followingPoint = (pointIndex + 1) % sectionSize;
      indices.push(frontCenter, followingPoint, pointIndex);
      indices.push(rearCenter, rearStart + pointIndex, rearStart + followingPoint);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }
}
