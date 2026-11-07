import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GAME } from '../config';
import { roadCenter, roadHeading } from '../math';
import { createEnvironmentLook } from './conditions';
import {
  ARM_REACH,
  createStreetLightGeometry,
  createStreetPoolTexture,
  POLE_HEIGHT,
  POLE_OFFSET,
  STREET_LIGHT_SPACING,
  StreetLightSystem,
} from './StreetLightSystem';

const camera = (z: number) => {
  const view = new THREE.PerspectiveCamera();
  view.position.set(roadCenter(-z), 5, z);
  return view;
};

/** Distance along the road and signed lateral offset of each pole base. */
function poles(scene: THREE.Scene): { distance: number; lateral: number }[] {
  const mesh = scene.getObjectByName('street-light-poles') as THREE.InstancedMesh;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  return Array.from({ length: mesh.count }, (_, index) => {
    mesh.getMatrixAt(index, matrix);
    position.setFromMatrixPosition(matrix);
    // Invert x = centre(d) + cos(h)·lateral, z = -d - sin(h)·lateral by iteration.
    let distance = -position.z;
    let lateral = 0;
    for (let step = 0; step < 8; step += 1) {
      const heading = roadHeading(distance);
      lateral = (position.x - roadCenter(distance)) / Math.cos(heading);
      distance = -position.z - Math.sin(heading) * lateral;
    }
    return { distance, lateral };
  });
}

describe('street lights', () => {
  it('builds a pole whose arm reaches in over the road', () => {
    const { structure, lens } = createStreetLightGeometry();
    structure.computeBoundingBox();
    lens.computeBoundingBox();
    expect(structure.boundingBox!.max.y).toBeGreaterThan(POLE_HEIGHT - 0.5);
    expect(structure.boundingBox!.min.y).toBeCloseTo(0, 6);
    expect(structure.boundingBox!.max.x).toBeGreaterThan(ARM_REACH);
    expect(lens.boundingBox!.getCenter(new THREE.Vector3()).x).toBeCloseTo(ARM_REACH, 6);
    // Lamps hang over the outer lanes, inside the road edge.
    expect(POLE_OFFSET - ARM_REACH).toBeLessThan(GAME.roadWidth / 2);
    expect(POLE_OFFSET).toBeGreaterThan(GAME.roadWidth / 2);
  });

  it('paints a round pool that fades to nothing at its edge', () => {
    const texture = createStreetPoolTexture(32);
    const data = texture.image.data as Uint8Array;
    const at = (x: number, y: number) => data[(y * 32 + x) * 4 + 1];
    expect(at(16, 16)).toBeGreaterThan(240);
    expect(at(16, 16)).toBeGreaterThan(at(16, 26));
    expect(at(0, 0)).toBe(0);
    expect(at(16, 4)).toBeCloseTo(at(4, 16), -1);
  });

  it('staggers lamps along both verges and keeps them around the view', () => {
    const scene = new THREE.Scene();
    const lights = new StreetLightSystem(scene);
    lights.update(1000, 1, camera(-1000), 900, new THREE.Vector3());
    const ahead = poles(scene);
    const left = ahead
      .filter((pole) => pole.lateral < 0)
      .map((pole) => pole.distance)
      .sort((a, b) => a - b);
    const right = ahead
      .filter((pole) => pole.lateral > 0)
      .map((pole) => pole.distance)
      .sort((a, b) => a - b);
    expect(left).toHaveLength(right.length);
    for (const pole of ahead) expect(Math.abs(pole.lateral)).toBeCloseTo(POLE_OFFSET, 3);
    expect(left[1] - left[0]).toBeCloseTo(STREET_LIGHT_SPACING, 3);
    expect(Math.abs(right[0] - left[0]) % STREET_LIGHT_SPACING).toBeCloseTo(
      STREET_LIGHT_SPACING / 2,
      3,
    );
    expect(Math.min(...ahead.map((pole) => pole.distance))).toBeGreaterThan(1000 - 80 - 1);

    // Turned around, the lamps move to the stretch of road now ahead.
    lights.update(1000, -1, camera(-1000), 900, new THREE.Vector3());
    expect(Math.max(...poles(scene).map((pole) => pole.distance))).toBeLessThan(1000 + 80 + 1);
    lights.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('switches its lamps on after dark and off by day', () => {
    const scene = new THREE.Scene();
    const lights = new StreetLightSystem(scene);
    const pools = () => scene.getObjectByName('street-light-pools')!;
    const glows = () => scene.getObjectByName('street-light-glows')!;
    lights.setLook(createEnvironmentLook({ timeOfDay: 'day', weather: 'clear' }));
    expect(pools().visible).toBe(false);
    expect(glows().visible).toBe(false);
    expect(lights.passingLight.visible).toBe(false);

    lights.setLook(createEnvironmentLook({ timeOfDay: 'night', weather: 'clear' }));
    expect(pools().visible).toBe(true);
    // Driving right under a lamp lights the car; between lamps the light fades.
    const lamp = poles(scene)[0];
    const heading = roadHeading(lamp.distance);
    const headLateral = Math.sign(lamp.lateral) * (POLE_OFFSET - ARM_REACH);
    const underLamp = new THREE.Vector3(
      roadCenter(lamp.distance) + Math.cos(heading) * headLateral,
      0,
      -lamp.distance - Math.sin(heading) * headLateral,
    );
    lights.update(lamp.distance, 1, camera(-lamp.distance), 900, underLamp);
    const overhead = lights.passingLight.intensity;
    expect(overhead).toBeGreaterThan(0);
    const between = underLamp.clone().setZ(underLamp.z - STREET_LIGHT_SPACING / 4);
    between.x = roadCenter(-between.z);
    lights.update(lamp.distance, 1, camera(-lamp.distance), 900, between);
    expect(lights.passingLight.intensity).toBeLessThan(overhead * 0.05);
    lights.dispose();
  });
});
