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

});
