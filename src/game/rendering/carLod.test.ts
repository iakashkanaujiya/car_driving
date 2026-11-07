import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildCarLod, whenCarLodReady } from './carLod';

const triangles = (geometry: THREE.BufferGeometry): number =>
  (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;

function createCar(): { prototype: THREE.Group; sourceTriangles: number } {
  const prototype = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ name: 'paint', color: 0x183f68 });
  const tail = new THREE.MeshStandardMaterial({ name: 'tail', color: 0xff0000 });
  const tyre = new THREE.MeshStandardMaterial({ name: 'tyre', color: 0x202020 });
  const glass = new THREE.MeshStandardMaterial({
    name: 'glass',
    color: 0xffffff,
    transparent: true,
    opacity: 0.25,
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(2, 96, 64), paint);
  shell.scale.set(1, 0.4, 2.2);
  const lens = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 0.1, 8, 4, 2), tail);
  lens.position.set(0, 0.4, 4.4);
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 48, 4), tyre);
  wheel.position.set(1.8, -0.4, 2.5);
  const window = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.6, 12, 6), glass);
  window.position.set(0, 0.8, 0);
  prototype.add(shell, lens, wheel, window);
  const sourceTriangles = [shell, lens, wheel, window].reduce(
    (sum, mesh) => sum + triangles(mesh.geometry),
    0,
  );
  return { prototype, sourceTriangles };
}

describe('distant car models', () => {
  beforeAll(async () => {
    expect(await whenCarLodReady()).toBe(true);
  });

  it('splits the car into paint, tail and body meshes with far fewer triangles', () => {
    const { prototype, sourceTriangles } = createCar();
    const parts = buildCarLod(prototype, {
      classify: (material) =>
        material.name === 'paint' ? 'paint' : material.name === 'tail' ? 'tail' : 'body',
      paintTexture: true,
      ratio: 0.1,
      error: 0.01,
    });

    expect(Object.keys(parts).sort()).toEqual(['body', 'paint', 'tail']);
    const farTriangles = Object.values(parts).reduce(
      (sum, part) => sum + triangles(part.geometry),
      0,
    );
    expect(farTriangles).toBeLessThan(sourceTriangles * 0.25);
    for (const part of Object.values(parts)) {
      expect(part.geometry.getAttribute('normal')).toBeDefined();
      expect(part.geometry.getAttribute('color')).toBeDefined();
    }
  });

  it('keeps the silhouette, moves meshes into prototype space and bakes colours', () => {
    const { prototype } = createCar();
    const parts = buildCarLod(prototype, {
      classify: (material) => (material.name === 'paint' ? 'paint' : 'body'),
      paintTexture: true,
      ratio: 0.1,
      error: 0.01,
    });

    const shell = parts.paint!.geometry;
    shell.computeBoundingBox();
    const size = shell.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(4, 1);
    expect(size.y).toBeCloseTo(1.6, 1);
    expect(size.z).toBeCloseTo(8.8, 1);
    // Paint stays white so each car's own paint colour shows through.
    const paintColors = shell.getAttribute('color');
    expect(paintColors.getX(0)).toBeCloseTo(1);

    // Tinted glass becomes a dark opaque cabin; the tyre keeps its colour.
    const body = parts.body!.geometry;
    const colors = body.getAttribute('color');
    const positions = body.getAttribute('position');
    let glassLuminance = 0;
    let tyreLuminance = 0;
    for (let vertex = 0; vertex < positions.count; vertex += 1) {
      const luminance = colors.getX(vertex) + colors.getY(vertex) + colors.getZ(vertex);
      if (positions.getY(vertex) > 0.7) glassLuminance = Math.max(glassLuminance, luminance);
      if (positions.getX(vertex) > 1.2) tyreLuminance = Math.max(tyreLuminance, luminance);
    }
    expect(glassLuminance).toBeGreaterThan(0.1);
    expect(glassLuminance).toBeLessThan(1.5);
    expect(tyreLuminance).toBeCloseTo(new THREE.Color(0x202020).r * 3, 2);
  });
});
