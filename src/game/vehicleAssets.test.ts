import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { describe, expect, it } from 'vitest';
import { GAME } from './config';
import { whenCarLodReady } from './rendering/carLod';
import {
  CAR_MODEL_OPTIONS,
  CAR_MODEL_VARIETY_OPTIONS,
  carModelSource,
  findLampAnchor,
  selectCarModelIds,
  VehicleAssets,
} from './vehicleAssets';
import type { CarModelId } from './vehicleAssets';

describe('Vehicle model roster', () => {
  it('offers the Audi, nine branded cars and ten generic cars', () => {
    const ids = CAR_MODEL_OPTIONS.map(({ id }) => id);
    expect(ids).toHaveLength(20);
    expect(ids[0]).toBe('luxury-concept');
    expect(new Set(ids).size).toBe(ids.length);
    expect(CAR_MODEL_OPTIONS.filter(({ group }) => group === 'Generic cars')).toHaveLength(10);
    expect(CAR_MODEL_VARIETY_OPTIONS).toEqual([1, 2, 3, 4, 6, 8]);
  });

  it('loads the driver model first and limits model variety', () => {
    expect(selectCarModelIds('peugeot-3008', 1)).toEqual(['peugeot-3008']);
    expect(selectCarModelIds('luxury-concept', 3)).toEqual([
      'luxury-concept',
      'volvo-v60-polestar',
      'jaguar-xj-sport',
    ]);
    // The list wraps around after the last car.
    expect(selectCarModelIds('generic-pickup', 2)).toEqual(['generic-pickup', 'luxury-concept']);
    expect(selectCarModelIds('bmw-i8', 99)).toHaveLength(20);
    expect(selectCarModelIds('bmw-i8', Number.NaN)).toEqual(['bmw-i8']);
  });
});

/**
 * Loads a GLB from public/ without its images, which need a browser to decode;
 * geometry, nodes and material names are all the car pipeline reads.
 */
async function loadGlbWithoutTextures(publicPath: string): Promise<THREE.Group> {
  // tsconfig has no Node types, so reach the file system through an untyped import.
  const fsModule = 'node:fs/promises';
  const { readFile } = (await import(/* @vite-ignore */ fsModule)) as {
    readFile: (path: URL) => Promise<Uint8Array>;
  };
  const glb = await readFile(new URL(`../../public/${publicPath}`, import.meta.url));
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength))) as {
    textures?: unknown;
    images?: unknown;
    samplers?: unknown;
    materials?: unknown[];
  };
  delete json.textures;
  delete json.images;
  delete json.samplers;
  // Every texture slot, including those inside material extensions.
  const dropTextures = (value: unknown): void => {
    if (typeof value !== 'object' || value === null) return;
    for (const [key, child] of Object.entries(value)) {
      if (/Texture$/.test(key)) delete (value as Record<string, unknown>)[key];
      else dropTextures(child);
    }
  };
  dropTextures(json.materials);
  let text = JSON.stringify(json);
  text += ' '.repeat((4 - (text.length % 4)) % 4);
  const jsonBytes = new TextEncoder().encode(text);
  const binaryChunk = glb.subarray(20 + jsonLength);
  const rebuilt = new Uint8Array(20 + jsonBytes.byteLength + binaryChunk.byteLength);
  const header = new DataView(rebuilt.buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, rebuilt.byteLength, true);
  header.setUint32(12, jsonBytes.byteLength, true);
  header.setUint32(16, 0x4e4f534a, true);
  rebuilt.set(jsonBytes, 20);
  rebuilt.set(binaryChunk, 20 + jsonBytes.byteLength);
  const gltf = await new GLTFLoader().parseAsync(rebuilt.buffer, '');
  return gltf.scene;
}

describe('Prepared car models', () => {
  type PrepareCarModel = (
    source: THREE.Group,
    rotationY: number,
    optimize: boolean,
    modelId: CarModelId,
  ) => THREE.Group;

  // The Audi's file is large and has its own tests; every prepared car is checked here.
  const preparedCars = CAR_MODEL_OPTIONS.map(({ id }) => id).filter(
    (id) => id !== 'luxury-concept',
  );

  it.each(preparedCars)(
    '%s rolls four wheels, steers the front pair and lights both ends',
    async (id) => {
      const assets = new VehicleAssets();
      const { path, rotationY } = carModelSource(id);
      const source = await loadGlbWithoutTextures(path);
      const prepareCarModel = (
        assets as unknown as { prepareCarModel: PrepareCarModel }
      ).prepareCarModel.bind(assets);
      const prototype = prepareCarModel(source, rotationY, true, id);

      const wheels: THREE.Object3D[] = [];
      prototype.traverse((object) => {
        if (object.userData.isWheelPivot === true) wheels.push(object);
      });
      expect(wheels).toHaveLength(4);
      const front = wheels.filter((wheel) => wheel.userData.frontWheel === true);
      expect(front).toHaveLength(2);
      for (const wheel of wheels) {
        const { x, y, z } = wheel.getWorldPosition(new THREE.Vector3());
        // The car faces -Z once loaded, so the steering pair is the one further forward.
        if (wheel.userData.frontWheel === true) expect(z).toBeLessThan(0);
        else expect(z).toBeGreaterThan(0);
        // Hubs sit at the sides at tyre height, about a tyre's radius off the road.
        expect(Math.abs(x)).toBeGreaterThan(0.6);
        expect(y).toBeCloseTo(wheel.userData.wheelRadius as number, 0);
        expect(wheel.userData.wheelRadius).toBeGreaterThan(0.2);
        expect(wheel.userData.wheelRadius).toBeLessThan(0.5);
      }

      const lamps = prototype.userData.lamps as {
        head?: { x: number; y: number; z: number };
        tail?: { x: number; y: number; z: number };
      };
      // Models are normalised to 4.6 units long, so the ends are near ±2.3.
      expect(lamps.head!.z).toBeLessThan(-1.5);
      expect(lamps.tail!.z).toBeGreaterThan(1.5);

      const car = new THREE.Group();
      assets.replaceVisual(car, prototype, false, id);
      expect(car.userData.animatedWheels as unknown[]).toHaveLength(4);
      const brakeLights = car.userData.modelBrakeLights as { material: THREE.Material }[];
      expect(brakeLights.length).toBeGreaterThan(0);
      // A lamp split by end never puts its front half on the brake lights.
      for (const { material } of brakeLights) expect(material.name).not.toMatch(/#front$/);
    },
  );
});

/**
 * A box-bodied car whose four tyres are one mesh (material `Tire`), as some
 * exports merge them; its chrome hub caps share a material with a body trim
 * strip, which must stay on the body.
 */
function carWithMergedTyres(): THREE.Group {
  const source = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(4, 1.2, 8), new THREE.MeshStandardMaterial());
  body.position.y = 1.2;
  source.add(body);
  const tyres: THREE.BufferGeometry[] = [];
  const chrome: THREE.BufferGeometry[] = [];
  for (const x of [-1.9, 1.9]) {
    for (const z of [-2.5, 2.5]) {
      tyres.push(
        new THREE.CylinderGeometry(0.5, 0.5, 0.3, 16).rotateZ(Math.PI / 2).translate(x, 0.5, z),
      );
      chrome.push(
        new THREE.CylinderGeometry(0.25, 0.25, 0.32, 8).rotateZ(Math.PI / 2).translate(x, 0.5, z),
      );
    }
  }
  // Trim along the side, high above the wheels.
  chrome.push(new THREE.BoxGeometry(0.1, 0.1, 6).translate(2.05, 1.6, 0));
  const named = (name: string) => new THREE.MeshStandardMaterial({ name });
  source.add(new THREE.Mesh(mergeGeometries(tyres), named('Tire')));
  source.add(new THREE.Mesh(mergeGeometries(chrome), named('Chrome')));
  return source;
}

describe('VehicleAssets wheel animation', () => {
  it('changes cached shadow meshes only when the range state changes', () => {
    const assets = new VehicleAssets();
    const prototype = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4));
    mesh.castShadow = true;
    prototype.add(mesh);
    const car = new THREE.Group();
    assets.replaceVisual(car, prototype, false, 'generic-sedan');

    assets.setShadowCasting(car, false);

    const shadowMeshes = car.userData.shadowMeshes as THREE.Mesh[];
    expect(shadowMeshes.every((part) => !part.castShadow)).toBe(true);
    expect(car.userData.castsShadow).toBe(false);
  });

  it('rolls a wheel from distance travelled and steers front wheels', () => {
    const car = new THREE.Group();
    const steeringPivot = new THREE.Group();
    const roller = new THREE.Group();
    steeringPivot.add(roller);
    car.add(steeringPivot);
    car.userData.animatedWheels = [
      {
        steeringPivot,
        roller,
        radius: 0.5,
        front: true,
        rollAxis: 'y',
        baseRoll: 0,
        baseSteering: 0,
        rollAngle: 0,
      },
    ];

    new VehicleAssets().updateWheelAnimation(car, Math.PI * 0.5, 0.5, 1 / 60);

    expect(roller.rotation.y).toBeCloseTo(-Math.PI);
    expect(steeringPivot.rotation.y).toBeLessThan(0);
  });

  it('holds the rear wheels still while the handbrake locks them', () => {
    const car = new THREE.Group();
    const wheel = (front: boolean) => ({
      steeringPivot: new THREE.Group(),
      roller: new THREE.Group(),
      radius: 0.5,
      front,
      rollAxis: 'x' as const,
      baseRoll: 0,
      baseSteering: 0,
      rollAngle: 0,
    });
    const [front, rear] = [wheel(true), wheel(false)];
    car.userData.animatedWheels = [front, rear];

    new VehicleAssets().updateWheelAnimation(car, 1, 0, 1 / 60, true);

    expect(front.roller.rotation.x).not.toBe(0);
    expect(rear.roller.rotation.x).toBe(0);
  });

  it('keeps real-car steering and rolling on separate transforms', () => {
    const assets = new VehicleAssets();
    const car = new THREE.Group();
    const prototype = new THREE.Group();
    const steeringPivot = new THREE.Group();
    steeringPivot.userData.isWheelPivot = true;
    steeringPivot.userData.frontWheel = true;
    steeringPivot.userData.wheelRadius = 0.5;
    const roller = new THREE.Group();
    roller.userData.isWheelRoller = true;
    roller.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    steeringPivot.add(roller);
    prototype.add(steeringPivot);

    assets.replaceVisual(car, prototype, false, 'generic-sedan');
    const [wheel] = car.userData.animatedWheels as Array<{
      steeringPivot: THREE.Object3D;
      roller: THREE.Object3D;
    }>;

    expect(wheel.steeringPivot).not.toBe(wheel.roller);
    expect(wheel.roller.parent).toBe(wheel.steeringPivot);
  });

  it('builds four rolling wheel assemblies from the Audi wheel materials', () => {
    const assets = new VehicleAssets();
    const source = new THREE.Group();
    source.add(new THREE.Mesh(new THREE.BoxGeometry(4, 1, 8)));
    const wheelMaterials = [
      'gtVehicle_Exterior_mm_rotor_009',
      'gtVehicle_Exterior_mm_wheel_009',
      'gtVehicle_Exterior_mm_tyre_009',
    ];

    for (const x of [-2, 2]) {
      for (const z of [-2.5, 2.5]) {
        for (const materialName of wheelMaterials) {
          const material = new THREE.MeshStandardMaterial();
          material.name = materialName;
          const part = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.25), material);
          part.position.set(x, 0, z);
          source.add(part);
        }
      }
    }

    const prepareCarModel = (
      assets as unknown as {
        prepareCarModel: (
          source: THREE.Group,
          rotationY: number,
          optimize: boolean,
          modelId: 'luxury-concept',
        ) => THREE.Group;
      }
    ).prepareCarModel.bind(assets);
    const prototype = prepareCarModel(source, Math.PI, true, 'luxury-concept');
    const wheels: THREE.Object3D[] = [];
    prototype.traverse((object) => {
      if (object.userData.isWheelPivot === true) wheels.push(object);
    });

    expect(wheels).toHaveLength(4);
    expect(wheels.filter((wheel) => wheel.userData.frontWheel)).toHaveLength(2);
  });

  it('separates four wheels from one merged tyre mesh', () => {
    const assets = new VehicleAssets();
    const prepareCarModel = (
      assets as unknown as {
        prepareCarModel: (
          source: THREE.Group,
          rotationY: number,
          optimize: boolean,
          modelId: 'jaguar-xj-sport',
        ) => THREE.Group;
      }
    ).prepareCarModel.bind(assets);
    const prototype = prepareCarModel(carWithMergedTyres(), Math.PI, true, 'jaguar-xj-sport');
    const wheels: THREE.Object3D[] = [];
    prototype.traverse((object) => {
      if (object.userData.isWheelPivot === true) wheels.push(object);
    });

    expect(wheels).toHaveLength(4);
    expect(wheels.filter((wheel) => wheel.userData.frontWheel)).toHaveLength(2);
  });

  it('tilts only the sprung body so the wheels stay planted', () => {
    const assets = new VehicleAssets();
    const prepareCarModel = (
      assets as unknown as {
        prepareCarModel: (
          source: THREE.Group,
          rotationY: number,
          optimize: boolean,
          modelId: 'jaguar-xj-sport',
        ) => THREE.Group;
      }
    ).prepareCarModel.bind(assets);
    const car = new THREE.Group();
    assets.replaceVisual(
      car,
      prepareCarModel(carWithMergedTyres(), Math.PI, true, 'jaguar-xj-sport'),
      false,
      'jaguar-xj-sport',
    );

    const body = car.getObjectByName('car-body')!;
    const wheel = (car.userData.animatedWheels as Array<{ steeringPivot: THREE.Object3D }>)[0]
      .steeringPivot;
    car.updateMatrixWorld(true);
    const wheelBefore = wheel.getWorldPosition(new THREE.Vector3());
    for (let frame = 0; frame < 120; frame += 1) {
      assets.updateSuspension(car, 0.5, -0.5, 1 / 60);
    }
    car.updateMatrixWorld(true);

    expect(body.rotation.z).toBeCloseTo(0.045, 3);
    expect(body.rotation.x).toBeCloseTo(-0.03, 3);
    expect(wheel.getWorldPosition(new THREE.Vector3()).distanceTo(wheelBefore)).toBeLessThan(1e-9);
  });

  it('grounds each car with a contact shadow that never casts shadows', () => {
    const assets = new VehicleAssets();
    const prototype = new THREE.Group();
    prototype.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4.6)));
    prototype.userData.footprint = { width: 2, length: 4.6, height: 1.6 };
    const car = new THREE.Group();
    assets.replaceVisual(car, prototype, false, 'generic-sedan');

    const shadow = car.getObjectByName('contact-shadow') as THREE.Mesh;
    expect(shadow).toBeDefined();
    expect(shadow.castShadow).toBe(false);
    expect(car.userData.shadowMeshes as THREE.Mesh[]).not.toContain(shadow);
    // Shared GPU resources survive replacing a car's visual.
    assets.replaceVisual(car, prototype, false, 'generic-sedan');
    expect((car.getObjectByName('contact-shadow') as THREE.Mesh).material).toBe(shadow.material);
  });

  it('records lamp positions and brightens resting tail lights after dark', () => {
    const assets = new VehicleAssets();
    const prototype = new THREE.Group();
    const lensMaterial = new THREE.MeshStandardMaterial({
      name: 'Taillight_Glass',
      emissive: 0x330000,
      emissiveIntensity: 1,
    });
    prototype.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4.6), lensMaterial));
    prototype.userData.footprint = { width: 2, length: 4.6, height: 1.6 };
    const car = new THREE.Group();
    assets.replaceVisual(car, prototype, false, 'bmw-7-series');

    // Without measured lenses the lamps are estimated from the footprint.
    const rig = assets.lightRig(car)!;
    expect(rig.length).toBeCloseTo(4.6 * car.scale.x, 6);
    expect(rig.headlamp.z).toBeCloseTo(-2.3 * car.scale.x, 6);
    expect(rig.taillamp.z).toBeCloseTo(2.3 * car.scale.x, 6);
    expect(rig.taillamp.y).toBeGreaterThan(0);

    const lens = (): THREE.MeshStandardMaterial => {
      let found: THREE.MeshStandardMaterial | undefined;
      car.traverse((object) => {
        if (object instanceof THREE.Mesh && object.material.name === 'Taillight_Glass') {
          found = object.material as THREE.MeshStandardMaterial;
        }
      });
      return found!;
    };
    assets.setBrakeLights(car, false);
    const daytime = lens().emissiveIntensity;
    assets.setRunningLights(1);
    assets.setBrakeLights(car, false);
    expect(lens().emissiveIntensity).toBeGreaterThan(daytime * 2);
    expect(assets.isBraking(car)).toBe(false);
    assets.setBrakeLights(car, true);
    expect(assets.isBraking(car)).toBe(true);
  });

  it('anchors lamps on the lens geometry at the requested end of the car', () => {
    const lens = new THREE.MeshStandardMaterial({ name: 'lens' });
    const root = new THREE.Group();
    // One lens material shared by a lamp at each end, as some models do.
    for (const [x, z] of [
      [-0.7, -2.2],
      [0.7, -2.2],
      [0.6, 2.2],
    ]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.1), lens);
      lamp.position.set(x, 0.8, z);
      root.add(lamp);
    }
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));

    const front = findLampAnchor(root, new Set(['lens']), 'front', 1)!;
    expect(front.z).toBeCloseTo(-2.25, 6);
    expect(front.y).toBeCloseTo(0.8, 6);
    expect(front.x).toBeGreaterThan(0.6);
    expect(front.x).toBeLessThanOrEqual(0.8);
    const rear = findLampAnchor(root, new Set(['lens']), 'rear', 1)!;
    expect(rear.z).toBeCloseTo(2.25, 6);
    expect(rear.x).toBeLessThan(front.x);
    expect(findLampAnchor(root, new Set(['missing']), 'rear', 1)).toBeUndefined();
  });

  it('puts a wrap-around lamp on its corner lens, not level with the centre bar', () => {
    const lens = new THREE.MeshStandardMaterial({ name: 'tail' });
    const root = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.1), lens);
    bar.position.set(0, 0.7, 2.3);
    root.add(bar);
    for (const side of [-1, 1]) {
      const corner = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.1), lens);
      corner.position.set(side * 0.7, 0.8, 2);
      root.add(corner);
    }
    const anchor = findLampAnchor(root, new Set(['tail']), 'rear', 1)!;
    expect(anchor.z).toBeCloseTo(2.05, 6);
    expect(anchor.y).toBeCloseTo(0.8, 6);
  });

  it('keeps every part when a model mixes interleaved and plain vertex buffers', () => {
    // GLTFLoader yields interleaved attributes for some primitives and plain
    // ones for others; three.js refuses to merge the two kinds directly.
    const material = new THREE.MeshStandardMaterial({ name: 'carpaint' });
    const interleaved = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const position = interleaved.getAttribute('position') as THREE.BufferAttribute;
    const normal = interleaved.getAttribute('normal') as THREE.BufferAttribute;
    const packed = new Float32Array(position.count * 6);
    for (let index = 0; index < position.count; index += 1) {
      packed.set([position.getX(index), position.getY(index), position.getZ(index)], index * 6);
      packed.set([normal.getX(index), normal.getY(index), normal.getZ(index)], index * 6 + 3);
    }
    const buffer = new THREE.InterleavedBuffer(packed, 6);
    const mixed = new THREE.BufferGeometry();
    mixed.setAttribute('position', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
    mixed.setAttribute('normal', new THREE.InterleavedBufferAttribute(buffer, 3, 3));
    const plain = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    plain.deleteAttribute('uv');
    const source = new THREE.Group();
    source.add(new THREE.Mesh(mixed, material), new THREE.Mesh(plain, material));
    source.children[1].position.x = 3;

    const assets = new VehicleAssets();
    const merge = (
      assets as unknown as { mergeStaticCarMeshes: (root: THREE.Group) => THREE.Group }
    ).mergeStaticCarMeshes.bind(assets);
    source.updateMatrixWorld(true);
    let vertices = 0;
    merge(source).traverse((object) => {
      if (object instanceof THREE.Mesh) vertices += object.geometry.getAttribute('position').count;
    });
    expect(vertices).toBe(position.count * 2);
  });

  it('sizes each collision box to the real car', () => {
    const assets = new VehicleAssets();
    // The 5.7 m Maybach is two units per metre long; the 3.3 m compact far shorter.
    expect(assets.collisionSize('maybach-vision-6').length).toBeCloseTo(11.4, 6);
    expect(assets.collisionSize('generic-compact').length).toBeLessThan(
      assets.collisionSize('generic-sedan').length,
    );
    expect(assets.collisionSize('luxury-concept').length).toBe(GAME.conceptCollisionLength);
  });

  it('brightens and restores the concept car rear lights', () => {
    const assets = new VehicleAssets();
    const car = new THREE.Group();
    const prototype = new THREE.Group();
    const tailMaterial = new THREE.MeshStandardMaterial({ color: 0xe70001 });
    tailMaterial.name = 'Emiss';
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 0.1), tailMaterial);
    tail.name = 'concept-tail';
    prototype.add(tail);

    assets.replaceVisual(car, prototype, true, 'luxury-concept');
    const preparedTail = car.getObjectByName('concept-tail') as THREE.Mesh;
    const material = preparedTail.material as THREE.MeshStandardMaterial;
    const restingIntensity = material.emissiveIntensity;

    assets.setBrakeLights(car, true);
    expect(material.emissiveIntensity).toBeGreaterThan(restingIntensity);
    expect(material.emissiveIntensity).toBe(8.5);
    expect(material.emissive.getHex()).toBe(0xff0000);

    assets.setBrakeLights(car, false);
    expect(material.emissiveIntensity).toBeCloseTo(restingIntensity);
    expect(material.emissive.getHex()).toBe(0x400000);
  });

  it('replaces transmissive glass with blended tint so no refraction pass runs', () => {
    const assets = new VehicleAssets();
    const source = new THREE.Group();
    const blendedGlass = new THREE.MeshPhysicalMaterial({
      transmission: 1,
      transparent: true,
      opacity: 0.25,
    });
    const opaqueGlass = new THREE.MeshPhysicalMaterial({ transmission: 1 });
    source.add(new THREE.Mesh(new THREE.BoxGeometry(4, 1, 8), blendedGlass));
    source.add(new THREE.Mesh(new THREE.BoxGeometry(4, 1, 8), opaqueGlass));

    const prepareCarModel = (
      assets as unknown as {
        prepareCarModel: (
          source: THREE.Group,
          rotationY: number,
          optimize: boolean,
          modelId: 'generic-sedan',
        ) => THREE.Group;
      }
    ).prepareCarModel.bind(assets);
    const prototype = prepareCarModel(source, Math.PI, true, 'generic-sedan');
    const materials: THREE.MeshPhysicalMaterial[] = [];
    prototype.traverse((object) => {
      if (object instanceof THREE.Mesh) materials.push(object.material);
    });

    expect(materials).toHaveLength(2);
    expect(materials.every((material) => material.transmission === 0)).toBe(true);
    expect(materials.every((material) => material.transparent)).toBe(true);
    expect(blendedGlass.opacity).toBe(0.25);
    expect(opaqueGlass.opacity).toBe(0.35);
  });

  it('gives traffic a far model with its own paint and working brake lights', async () => {
    expect(await whenCarLodReady()).toBe(true);
    const assets = new VehicleAssets();
    const prototype = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ name: 'CarPaint' });
    const tail = new THREE.MeshStandardMaterial({ name: 'Emiss' });
    prototype.add(new THREE.Mesh(new THREE.SphereGeometry(2, 48, 32), paint));
    const lens = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 0.1), tail);
    lens.position.z = 2;
    prototype.add(lens);
    const traffic = new THREE.Group();
    const player = new THREE.Group();
    assets.replaceVisual(traffic, prototype, false, 'luxury-concept');
    assets.replaceVisual(player, prototype, true, 'luxury-concept');

    const far = traffic.getObjectByName('car-far-model')!;
    const detailed = traffic.children[0];
    expect(player.getObjectByName('car-far-model')).toBeUndefined();
    expect(far.visible).toBe(false);
    const farMaterials = far.children.map((mesh) => (mesh as THREE.Mesh).material);
    const farPaint = farMaterials.find(
      (material) => (material as THREE.MeshStandardMaterial).vertexColors,
    ) as THREE.MeshStandardMaterial;
    const detailedPaint = (detailed.getObjectByProperty('isMesh', true) as THREE.Mesh)
      .material as THREE.MeshStandardMaterial;
    expect(farPaint.color.getHex()).toBe(detailedPaint.color.getHex());

    assets.setDetail(traffic, 100);
    expect([far.visible, detailed.visible]).toEqual([true, false]);
    // Hysteresis keeps the far model until the car is clearly closer.
    assets.setDetail(traffic, 80);
    expect(far.visible).toBe(true);
    assets.setDetail(traffic, 70);
    expect([far.visible, detailed.visible]).toEqual([false, true]);

    assets.setBrakeLights(traffic, true);
    const farTail = farMaterials.find(
      (material) => material !== farPaint,
    ) as THREE.MeshStandardMaterial;
    expect(farTail.emissiveIntensity).toBe(8.5);
  });

  it('uses a red-glass lens as a working brake light', () => {
    const assets = new VehicleAssets();
    const car = new THREE.Group();
    const prototype = new THREE.Group();
    const tailMaterial = new THREE.MeshStandardMaterial({ color: 0x980000 });
    tailMaterial.name = 'Taillight_Glass';
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 0.1), tailMaterial);
    tail.name = 'bmw-tail';
    prototype.add(tail);

    assets.replaceVisual(car, prototype, true, 'bmw-7-series');
    const preparedTail = car.getObjectByName('bmw-tail') as THREE.Mesh;
    const material = preparedTail.material as THREE.MeshStandardMaterial;
    assets.setBrakeLights(car, true);

    expect(material.emissive.getHex()).toBe(0xff0712);
    expect(material.emissiveIntensity).toBe(5.2);
  });
});
