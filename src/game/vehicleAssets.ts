import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type CarModelId = 'camaro' | 'pontiac' | 'golf';

interface CarModelSpec {
  id: CarModelId;
  path: string;
  rotationY: number;
}

export interface LoadedCarModel {
  id: CarModelId;
  trafficPrototype: THREE.Group;
  playerPrototype?: THREE.Group;
}

const CAR_COLORS = [0xff5a5f, 0x65d1ff, 0xffcc4d, 0xa98cff, 0xf4f2e9, 0x50d890];
const REAL_CAR_SCALE = 2;
const CARTOON_CAR_SCALE = 1.55;
const MODEL_SPECS: readonly CarModelSpec[] = [
  { id: 'camaro', path: 'models/1970_chevrolet_camaro/scene.gltf', rotationY: Math.PI },
  { id: 'pontiac', path: 'models/1970_Pontiac/scene.gltf', rotationY: -Math.PI / 2 },
  { id: 'golf', path: 'models/1976_volkswagen_golf/scene.gltf', rotationY: Math.PI },
];

export class VehicleAssets {
  randomColor(): number {
    return CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
  }

  createCartoonCar(color: number, player: boolean): THREE.Group {
    const group = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.22,
      metalness: 0.68,
      side: THREE.DoubleSide,
    });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0a0d11, roughness: 0.48, metalness: 0.32 });
    const carbon = new THREE.MeshStandardMaterial({ color: 0x151a1f, roughness: 0.32, metalness: 0.62 });
    const glass = new THREE.MeshStandardMaterial({
      color: player ? 0x315f6b : 0x3b5862,
      roughness: 0.08,
      metalness: 0.42,
      side: THREE.DoubleSide,
    });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xb9c4c7, roughness: 0.22, metalness: 0.9 });

    const bodyProfile: Array<[number, number]> = [
      [-2.28, 0.35], [-2.2, 0.76], [-1.7, 0.93], [-0.9, 1.02],
      [0.9, 0.98], [1.72, 0.82], [2.3, 0.5], [2.24, 0.33],
    ];
    const body = new THREE.Mesh(this.createCarProfileGeometry(bodyProfile, 2.02, 0.09, true), paint);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const canopyProfile: Array<[number, number]> = [
      [-1.03, 1.01], [-0.72, 1.54], [-0.42, 1.69], [0.47, 1.69], [1.05, 1.01],
    ];
    const canopy = new THREE.Mesh(this.createCarProfileGeometry(canopyProfile, 1.5, 0.045), glass);
    canopy.castShadow = true;
    group.add(canopy);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.1, 0.92), carbon);
    roof.position.set(0, 1.69, 0.08);
    roof.castShadow = true;
    group.add(roof);

    const frontPillar = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.075, 0.1), carbon);
    frontPillar.position.set(0, 1.36, -0.75);
    frontPillar.rotation.x = -0.55;
    group.add(frontPillar);
    const rearPillar = frontPillar.clone();
    rearPillar.position.set(0, 1.35, 0.73);
    rearPillar.rotation.x = 0.72;
    group.add(rearPillar);

    for (const x of [-1.02, 1.02]) {
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.17, 3.35), carbon);
      skirt.position.set(x, 0.43, 0.02);
      skirt.castShadow = true;
      group.add(skirt);

      const mirror = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 6), paint);
      mirror.scale.set(0.9, 0.45, 0.62);
      mirror.position.set(x * 1.05, 1.28, -0.43);
      mirror.castShadow = true;
      group.add(mirror);
    }

    const tireGeometry = new THREE.CylinderGeometry(0.44, 0.44, 0.32, 20);
    const rimGeometry = new THREE.CylinderGeometry(0.265, 0.265, 0.345, 18);
    const frontWheels: THREE.Group[] = [];
    for (const x of [-1.04, 1.04]) {
      for (const z of [-1.43, 1.39]) {
        const steeringPivot = new THREE.Group();
        steeringPivot.position.set(x, 0.48, z);
        const wheelAssembly = new THREE.Group();
        wheelAssembly.rotation.z = Math.PI / 2;
        const tire = new THREE.Mesh(tireGeometry, dark);
        tire.castShadow = true;
        wheelAssembly.add(tire);
        wheelAssembly.add(new THREE.Mesh(rimGeometry, chrome));

        const outerFace = -Math.sign(x) * 0.19;
        for (let spokeIndex = 0; spokeIndex < 5; spokeIndex += 1) {
          const angle = (spokeIndex / 5) * Math.PI * 2;
          const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.035, 0.38), carbon);
          spoke.position.y = outerFace;
          spoke.rotation.y = angle;
          wheelAssembly.add(spoke);
        }
        wheelAssembly.add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.38, 12), carbon));
        steeringPivot.add(wheelAssembly);
        group.add(steeringPivot);
        if (z < 0) frontWheels.push(steeringPivot);
      }
    }
    group.userData.frontWheels = frontWheels;

    const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.2, 0.18), carbon);
    frontBumper.position.set(0, 0.45, -2.28);
    group.add(frontBumper);
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(2, 0.08, 0.42), carbon);
    splitter.position.set(0, 0.31, -2.18);
    group.add(splitter);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.2, 0.035), dark);
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
    const rearLightPanel = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.27, 0.045), carbon);
    rearLightPanel.position.set(0, 0.78, 2.23);
    group.add(rearLightPanel);
    for (const x of [-0.66, 0.66]) {
      const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.15, 0.055), headlightMaterial);
      headlight.position.set(x, 0.74, -2.23);
      headlight.rotation.y = x * 0.08;
      group.add(headlight);

      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.15, 0.055), tailMaterial);
      tail.position.set(x, 0.8, 2.265);
      group.add(tail);
    }
    const centerTail = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.045, 0.04), tailMaterial);
    centerTail.position.set(0, 0.8, 2.27);
    group.add(centerTail);

    const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.26, 0.18), carbon);
    rearBumper.position.set(0, 0.48, 2.22);
    group.add(rearBumper);
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.12, 0.3), dark);
    diffuser.position.set(0, 0.32, 2.2);
    group.add(diffuser);
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.19, 0.025),
      new THREE.MeshBasicMaterial({ color: 0xe8ece7 }),
    );
    plate.position.set(0, 0.63, 2.325);
    group.add(plate);

    for (const x of [-0.63, 0.63]) {
      const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.27, 12), chrome);
      exhaust.rotation.x = Math.PI / 2;
      exhaust.position.set(x, 0.32, 2.34);
      group.add(exhaust);
    }

    if (player) {
      const brakeGlow = new THREE.PointLight(0xff1824, 0, 7, 2);
      brakeGlow.position.set(0, 0.58, 2.55);
      group.userData.brakeGlow = brakeGlow;
      group.add(brakeGlow);

      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.1, 0.34), carbon);
      wing.position.set(0, 1.18, 1.78);
      wing.castShadow = true;
      group.add(wing);
      for (const x of [-0.57, 0.57]) {
        const support = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.33, 0.08), carbon);
        support.position.set(x, 1.03, 1.76);
        group.add(support);
      }
    }

    group.scale.setScalar(CARTOON_CAR_SCALE);
    return group;
  }

  async loadRealModels(): Promise<LoadedCarModel[]> {
    const loader = new GLTFLoader();
    const loadedModels = await Promise.all(MODEL_SPECS.map(async (spec): Promise<LoadedCarModel | null> => {
      try {
        const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}${spec.path}`);
        return {
          id: spec.id,
          trafficPrototype: this.prepareCarModel(gltf.scene, spec.rotationY, true),
          playerPrototype: spec.id === 'camaro'
            ? this.prepareCarModel(gltf.scene, spec.rotationY, false)
            : undefined,
        };
      } catch (error) {
        console.error(`Could not load the ${spec.id} car model.`, error);
        return null;
      }
    }));
    return loadedModels.filter((model): model is LoadedCarModel => model !== null);
  }

  replaceVisual(car: THREE.Group, prototype: THREE.Group, player: boolean, modelId: CarModelId): void {
    const oldGeometries = new Set<THREE.BufferGeometry>();
    const oldMaterials = new Set<THREE.Material>();
    car.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      oldGeometries.add(object.geometry);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => oldMaterials.add(material));
    });
    car.clear();
    oldGeometries.forEach((geometry) => geometry.dispose());
    oldMaterials.forEach((material) => material.dispose());

    const instance = prototype.clone(true);
    if (!player) this.applyTrafficCarColor(instance, modelId, this.randomColor());
    instance.updateMatrixWorld(true);
    const modelBounds = new THREE.Box3().setFromObject(instance, true);
    car.add(instance);
    car.scale.setScalar(REAL_CAR_SCALE);
    car.userData.modelId = modelId;
    car.userData.frontWheels = [];
    car.userData.tailMaterial = undefined;
    car.userData.brakeGlow = undefined;
    car.userData.highBrakeOnly = false;

    if (player && modelId === 'golf') {
      const frontWheels = ['group1', 'group2']
        .map((name) => instance.getObjectByName(name))
        .filter((wheel): wheel is THREE.Object3D => wheel !== undefined);
      for (const wheel of frontWheels) wheel.userData.baseSteeringY = wheel.rotation.y;
      car.userData.frontWheels = frontWheels;
    }

    if (player) this.addHighMountedBrakeLight(car, modelBounds);
  }

  setBrakeLights(car: THREE.Group, braking: boolean): void {
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

  private prepareCarModel(source: THREE.Group, rotationY: number, optimize: boolean): THREE.Group {
    const content = source.clone(true);
    const orientation = new THREE.Group();
    orientation.rotation.y = rotationY;
    orientation.add(content);
    orientation.updateMatrixWorld(true);

    const modelRoot = optimize ? this.mergeStaticCarMeshes(orientation) : orientation;
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
    return prototype;
  }

  private mergeStaticCarMeshes(root: THREE.Group): THREE.Group {
    const buckets = new Map<string, { material: THREE.Material; geometries: THREE.BufferGeometry[] }>();
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
    if (mergedRoot.children.length === 0) throw new Error('The car geometry could not be optimized.');
    return mergedRoot;
  }

  private applyTrafficCarColor(car: THREE.Group, modelId: CarModelId, color: number): void {
    const paintNames: Record<CarModelId, string> = {
      camaro: 'Paint6Mtl',
      pontiac: 'body',
      golf: 'vM_CarPaint_Max1',
    };
    const paintName = paintNames[modelId];
    const materialClones = new Map<THREE.Material, THREE.Material>();
    const tintMaterial = (source: THREE.Material): THREE.Material => {
      if (source.name !== paintName) return source;
      const existing = materialClones.get(source);
      if (existing) return existing;
      const material = source.clone();
      if (material instanceof THREE.MeshStandardMaterial) {
        material.color.setHex(color);
        material.emissive.setHex(0x000000);
        material.emissiveMap = null;
        if (modelId === 'camaro') material.map = null;
        material.metalness = Math.max(material.metalness, 0.48);
        material.roughness = Math.min(material.roughness, 0.32);
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
    light.position.set(0, bounds.min.y + size.y * 0.82, bounds.max.z - size.z * 0.12);
    car.userData.tailMaterial = material;
    car.userData.highBrakeOnly = true;
    car.add(light);
  }

  private createCarProfileGeometry(
    profile: Array<[number, number]>,
    width: number,
    bevel: number,
    taperEnds = false,
  ): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(profile[0][0], profile[0][1]);
    for (let index = 1; index < profile.length; index += 1) shape.lineTo(profile[index][0], profile[index][1]);
    shape.lineTo(profile[0][0], profile[0][1]);

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: width,
      steps: 1,
      curveSegments: 1,
      bevelEnabled: true,
      bevelSegments: 1,
      bevelSize: bevel,
      bevelThickness: bevel,
    });
    geometry.translate(0, 0, -width / 2);
    if (taperEnds) {
      const position = geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let index = 0; index < position.count; index += 1) {
        const profilePosition = position.getX(index);
        const taper = 1 - Math.max(0, Math.abs(profilePosition) - 1.05) * 0.11;
        position.setZ(index, position.getZ(index) * taper);
      }
      position.needsUpdate = true;
    }
    geometry.rotateY(Math.PI / 2);
    geometry.computeVertexNormals();
    return geometry;
  }
}
