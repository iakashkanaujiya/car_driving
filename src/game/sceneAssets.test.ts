import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { SceneLighting } from './sceneAssets';
import { SUN_SHADOW_OFFSET, updateSceneShadow } from './sceneAssets';
import { ATMOSPHERE } from './world/atmosphere';

describe('scene shadow tracking', () => {
  it('moves the light and target with the active road area', () => {
    const sun = new THREE.DirectionalLight();
    const target = new THREE.Object3D();
    const lighting: SceneLighting = { sun, target };

    updateSceneShadow(lighting, new THREE.Vector3(10, 0, -20));

    expect(target.position.toArray()).toEqual([10, 0, -20]);
    const expected = new THREE.Vector3(10, 0, -20).add(SUN_SHADOW_OFFSET);
    expect(sun.position.distanceTo(expected)).toBeLessThan(1e-9);
  });

  it('casts shadows from the same direction as the visible sun', () => {
    const direction = SUN_SHADOW_OFFSET.clone().normalize();
    expect(direction.angleTo(ATMOSPHERE.sunDirection)).toBeLessThan(1e-6);
    expect(ATMOSPHERE.sunDirection.y).toBeGreaterThan(0.2);
  });
});
