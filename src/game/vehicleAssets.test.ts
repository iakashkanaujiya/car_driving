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
});
