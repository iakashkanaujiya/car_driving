import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VehicleAssets } from './vehicleAssets';

describe('VehicleAssets wheel animation', () => {
  it('rolls a wheel from distance travelled and steers front wheels', () => {
    const car = new THREE.Group();
    const steeringPivot = new THREE.Group();
    const roller = new THREE.Group();
    steeringPivot.add(roller);
    car.add(steeringPivot);
    car.userData.animatedWheels = [{
      steeringPivot,
      roller,
      radius: 0.5,
      front: true,
      rollAxis: 'y',
      baseRoll: 0,
      baseSteering: 0,
      rollAngle: 0,
    }];

    new VehicleAssets().updateWheelAnimation(car, Math.PI * 0.5, 0.5, 1 / 60);

    expect(roller.rotation.y).toBeCloseTo(-Math.PI);
    expect(steeringPivot.rotation.y).toBeLessThan(0);
  });

  it('builds cartoon wheels that roll around their horizontal axles', () => {
    const assets = new VehicleAssets();
    const car = assets.createCartoonCar(0xffffff, true);
    const wheels = car.userData.animatedWheels as Array<{
      roller: THREE.Group;
      rollAxis: 'x' | 'y';
      front: boolean;
    }>;

    expect(wheels).toHaveLength(4);
    expect(wheels.every((wheel) => wheel.rollAxis === 'x')).toBe(true);
    expect(wheels.filter((wheel) => wheel.front)).toHaveLength(2);

    assets.updateWheelAnimation(car, 1, 0, 1 / 60);

    expect(wheels.every((wheel) => wheel.roller.rotation.x < 0)).toBe(true);
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

  it('brightens and restores the concept car rear lights', () => {
    const assets = new VehicleAssets();
    const car = new THREE.Group();
    const prototype = new THREE.Group();
    const tailMaterial = new THREE.MeshStandardMaterial({ color: 0xe70001 });
    tailMaterial.name = 'Material.010';
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 0.1), tailMaterial);
    tail.name = 'concept-tail';
    prototype.add(tail);

    assets.replaceVisual(car, prototype, true, 'luxury-concept');
    const preparedTail = car.getObjectByName('concept-tail') as THREE.Mesh;
    const material = preparedTail.material as THREE.MeshStandardMaterial;
    const restingIntensity = material.emissiveIntensity;

    assets.setBrakeLights(car, true);
    expect(material.emissiveIntensity).toBeGreaterThan(restingIntensity);
    expect(material.emissive.getHex()).toBe(0xff0712);

    assets.setBrakeLights(car, false);
    expect(material.emissiveIntensity).toBeCloseTo(restingIntensity);
    expect(material.emissive.getHex()).toBe(0x320003);
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
    const emissionMesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 1, 4),
      emission,
    );
    emissionMesh.name = 'ioniq-emission';
    prototype.add(emissionMesh);

    assets.replaceVisual(car, prototype, false, 'ioniq-5');
    const preparedEmission = car.getObjectByName('ioniq-emission') as THREE.Mesh;
    const preparedMaterial =
      preparedEmission.material as THREE.MeshStandardMaterial;
    assets.setBrakeLights(car, true);

    expect(preparedMaterial.emissive.getHex()).toBe(0xffffff);
    expect(preparedMaterial.emissiveIntensity).toBe(3.2);
    expect(car.getObjectByName('ioniq-rear-brake-light-left')).toBeUndefined();
    expect(car.getObjectByName('high-mounted-brake-light')).toBeUndefined();
    expect(emission.emissive.getHex()).toBe(0xffffff);
    expect(emission.emissiveIntensity).toBe(1);
  });

});
