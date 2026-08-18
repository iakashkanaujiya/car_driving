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
});
