import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CAR_MODEL_OPTIONS,
  CAR_MODEL_VARIETY_OPTIONS,
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
