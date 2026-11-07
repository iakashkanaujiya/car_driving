import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { whenCarLodReady } from './rendering/carLod';
import {
  CAR_MODEL_OPTIONS,
  CAR_MODEL_VARIETY_OPTIONS,
  findLampAnchor,
  selectCarModelIds,
  VehicleAssets,
} from './vehicleAssets';

describe('Vehicle model roster', () => {
  it('offers every GLB car in the unified selector', () => {
    expect(CAR_MODEL_OPTIONS.map(({ id }) => id)).toEqual([
      'ford-f150-raptor',
      'ford-everest-sport',
      'ioniq-5',
      'luxury-concept',
    ]);
    expect(CAR_MODEL_VARIETY_OPTIONS).toEqual([1, 2, 3, 4]);
  });

  it('loads the driver model first and limits model variety', () => {
    expect(selectCarModelIds('ioniq-5', 1)).toEqual(['ioniq-5']);
    expect(selectCarModelIds('luxury-concept', 3)).toEqual([
      'luxury-concept',
      'ford-f150-raptor',
      'ford-everest-sport',
    ]);
    expect(selectCarModelIds('ford-f150-raptor', 99)).toHaveLength(4);
    expect(selectCarModelIds('ford-f150-raptor', Number.NaN)).toEqual(['ford-f150-raptor']);
  });
});

describe('VehicleAssets wheel animation', () => {
  it('changes cached shadow meshes only when the range state changes', () => {
    const assets = new VehicleAssets();
    const prototype = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4));
    mesh.castShadow = true;
    prototype.add(mesh);
    const car = new THREE.Group();
    assets.replaceVisual(car, prototype, false, 'ioniq-5');

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

    assets.replaceVisual(car, prototype, false, 'ioniq-5');
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

  it('uses all four normalized Raptor wheel groups', () => {
    const assets = new VehicleAssets();
    const source = new THREE.Group();
    source.add(new THREE.Mesh(new THREE.BoxGeometry(4, 1, 8)));
    for (const [name, x, z] of [
      ['WHEEL_LF', 2, 2.5],
      ['WHEEL_RF', -2, 2.5],
      ['WHEEL_LR', 2, -2.5],
      ['WHEEL_RR', -2, -2.5],
    ] as const) {
      const wheel = new THREE.Group();
      wheel.name = name;
      wheel.position.set(x, 0, z);
      wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.25)));
      source.add(wheel);
    }

    const prepareCarModel = (
      assets as unknown as {
        prepareCarModel: (
          source: THREE.Group,
          rotationY: number,
          optimize: boolean,
          modelId: 'ford-f150-raptor',
        ) => THREE.Group;
      }
    ).prepareCarModel.bind(assets);
    const prototype = prepareCarModel(source, Math.PI, true, 'ford-f150-raptor');
    const wheels: THREE.Object3D[] = [];
    prototype.traverse((object) => {
      if (object.userData.isWheelPivot === true) wheels.push(object);
    });

    expect(wheels).toHaveLength(4);
    expect(wheels.filter((wheel) => wheel.userData.frontWheel)).toHaveLength(2);
  });

  it('tilts only the sprung body so the wheels stay planted', () => {
    const assets = new VehicleAssets();
    const source = new THREE.Group();
    source.add(new THREE.Mesh(new THREE.BoxGeometry(4, 1, 8)));
    for (const [name, x, z] of [
      ['WHEEL_LF', 2, 2.5],
      ['WHEEL_RF', -2, 2.5],
      ['WHEEL_LR', 2, -2.5],
      ['WHEEL_RR', -2, -2.5],
    ] as const) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.25));
      wheel.name = name;
      wheel.position.set(x, 0, z);
      source.add(wheel);
    }
    const prepareCarModel = (
      assets as unknown as {
        prepareCarModel: (
          source: THREE.Group,
          rotationY: number,
          optimize: boolean,
          modelId: 'ford-f150-raptor',
        ) => THREE.Group;
      }
    ).prepareCarModel.bind(assets);
    const car = new THREE.Group();
    assets.replaceVisual(
      car,
      prepareCarModel(source, Math.PI, true, 'ford-f150-raptor'),
      false,
      'ford-f150-raptor',
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
    assets.replaceVisual(car, prototype, false, 'ioniq-5');

    const shadow = car.getObjectByName('contact-shadow') as THREE.Mesh;
    expect(shadow).toBeDefined();
    expect(shadow.castShadow).toBe(false);
    expect(car.userData.shadowMeshes as THREE.Mesh[]).not.toContain(shadow);
    // Shared GPU resources survive replacing a car's visual.
    assets.replaceVisual(car, prototype, false, 'ioniq-5');
    expect((car.getObjectByName('contact-shadow') as THREE.Mesh).material).toBe(shadow.material);
  });

  it('records lamp positions and brightens resting tail lights after dark', () => {
    const assets = new VehicleAssets();
    const prototype = new THREE.Group();
    const lensMaterial = new THREE.MeshStandardMaterial({
      name: 'M_Emission',
      emissive: 0x330000,
      emissiveIntensity: 1,
    });
    prototype.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4.6), lensMaterial));
    prototype.userData.footprint = { width: 2, length: 4.6, height: 1.6 };
    const car = new THREE.Group();
    assets.replaceVisual(car, prototype, false, 'ioniq-5');

    // Without measured lenses the lamps are estimated from the footprint.
    const rig = assets.lightRig(car)!;
    expect(rig.length).toBeCloseTo(4.6 * car.scale.x, 6);
    expect(rig.headlamp.z).toBeCloseTo(-2.3 * car.scale.x, 6);
    expect(rig.taillamp.z).toBeCloseTo(2.3 * car.scale.x, 6);
    expect(rig.taillamp.y).toBeGreaterThan(0);

    const lens = (): THREE.MeshStandardMaterial => {
      let found: THREE.MeshStandardMaterial | undefined;
      car.traverse((object) => {
        if (object instanceof THREE.Mesh && object.material.name === 'M_Emission') {
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

  it('uses the larger collision envelope only for the concept car', () => {
    const assets = new VehicleAssets();
    expect(assets.collisionSize('luxury-concept').length).toBeGreaterThan(
      assets.collisionSize('ioniq-5').length,
    );
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
          modelId: 'ford-f150-raptor',
        ) => THREE.Group;
      }
    ).prepareCarModel.bind(assets);
    const prototype = prepareCarModel(source, Math.PI, true, 'ford-f150-raptor');
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

  it('uses the Ford red-glass material as a working brake light', () => {
    const assets = new VehicleAssets();
    const car = new THREE.Group();
    const prototype = new THREE.Group();
    const tailMaterial = new THREE.MeshStandardMaterial({ color: 0x980000 });
    tailMaterial.name = 'redglass';
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 0.1), tailMaterial);
    tail.name = 'ford-tail';
    prototype.add(tail);

    assets.replaceVisual(car, prototype, true, 'ford-everest-sport');
    const preparedTail = car.getObjectByName('ford-tail') as THREE.Mesh;
    const material = preparedTail.material as THREE.MeshStandardMaterial;
    assets.setBrakeLights(car, true);

    expect(material.emissive.getHex()).toBe(0xff0712);
    expect(material.emissiveIntensity).toBe(5.2);
  });

  it('brightens the Ioniq emission mesh without adding rear-light geometry', () => {
    const assets = new VehicleAssets();
    const car = new THREE.Group();
    const prototype = new THREE.Group();
    const emission = new THREE.MeshStandardMaterial({
      emissive: 0xffffff,
      emissiveIntensity: 1,
    });
    emission.name = 'M_Emission';
    const emissionMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4), emission);
    emissionMesh.name = 'ioniq-emission';
    prototype.add(emissionMesh);

    assets.replaceVisual(car, prototype, false, 'ioniq-5');
    const preparedEmission = car.getObjectByName('ioniq-emission') as THREE.Mesh;
    const preparedMaterial = preparedEmission.material as THREE.MeshStandardMaterial;
    assets.setBrakeLights(car, true);

    expect(preparedMaterial.emissive.getHex()).toBe(0xffffff);
    expect(preparedMaterial.emissiveIntensity).toBe(3.2);
    expect(car.getObjectByName('ioniq-rear-brake-light-left')).toBeUndefined();
    expect(car.getObjectByName('high-mounted-brake-light')).toBeUndefined();
    expect(emission.emissive.getHex()).toBe(0xffffff);
    expect(emission.emissiveIntensity).toBe(1);
  });
});
