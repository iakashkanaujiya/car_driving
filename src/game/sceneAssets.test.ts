import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addSceneLighting, applySceneLighting, updateSceneShadow } from './sceneAssets';
import { ATMOSPHERE } from './world/atmosphere';
import { createEnvironmentLook } from './world/conditions';

describe('scene shadow tracking', () => {
  it('moves the light and target with the active road area', () => {
    const lighting = addSceneLighting(new THREE.Scene());

    updateSceneShadow(lighting, new THREE.Vector3(10, 0, -20));

    expect(lighting.target.position.toArray()).toEqual([10, 0, -20]);
    const expected = new THREE.Vector3(10, 0, -20).add(lighting.shadowOffset);
    expect(lighting.sun.position.distanceTo(expected)).toBeLessThan(1e-9);
  });

  it('casts shadows from the same direction as the visible sun', () => {
    const lighting = addSceneLighting(new THREE.Scene());
    const direction = lighting.shadowOffset.clone().normalize();
    expect(direction.angleTo(ATMOSPHERE.sunDirection)).toBeLessThan(1e-6);
    expect(ATMOSPHERE.sunDirection.y).toBeGreaterThan(0.2);
  });

  it('follows the moon at night and keeps the shadow centre', () => {
    const lighting = addSceneLighting(new THREE.Scene());
    updateSceneShadow(lighting, new THREE.Vector3(4, 0, -90));
    const night = createEnvironmentLook({ timeOfDay: 'night', weather: 'clear' });

    applySceneLighting(lighting, night);

    expect(lighting.target.position.toArray()).toEqual([4, 0, -90]);
    const direction = lighting.sun.position.clone().sub(lighting.target.position).normalize();
    expect(direction.angleTo(night.lightDirection)).toBeLessThan(1e-6);
    expect(lighting.sun.intensity).toBe(night.lightIntensity);
    expect(lighting.hemisphere.color.getHex()).toBe(night.hemisphereSkyColor.getHex());
  });
});
