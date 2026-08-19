import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { SceneLighting } from './sceneAssets';
import { updateSceneShadow } from './sceneAssets';

describe('scene shadow tracking', () => {
  it('moves the light and target with the active road area', () => {
    const sun = new THREE.DirectionalLight();
    const target = new THREE.Object3D();
    const lighting: SceneLighting = {
      sun,
      target,
      visual: new THREE.Group(),
    };

    updateSceneShadow(lighting, new THREE.Vector3(10, 0, -20));

    expect(target.position.toArray()).toEqual([10, 0, -20]);
    expect(sun.position.toArray()).toEqual([-35, 75, 10]);
  });
});
