import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { describe, expect, it } from 'vitest';
import { separateWheels, splitLampsByEnd } from './carParts';

const named = (name: string) => new THREE.MeshStandardMaterial({ name });

function meshesNamed(root: THREE.Object3D, material: string): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && (object.material as THREE.Material).name === material) {
      found.push(object);
    }
  });
  return found;
}

describe('separateWheels', () => {
  it('splits merged tyres by corner and keeps trim that shares a rim material', () => {
    const root = new THREE.Group();
    // A car facing -Z: a body, one mesh for all four tyres, one for hub caps and trim.
    root.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4.6).translate(0, 1, 0), named('Paint')));
    const tyres: THREE.BufferGeometry[] = [];
    const chrome: THREE.BufferGeometry[] = [];
    for (const x of [-0.9, 0.9]) {
      for (const z of [-1.5, 1.5]) {
        tyres.push(
          new THREE.CylinderGeometry(0.35, 0.35, 0.22, 16)
            .rotateZ(Math.PI / 2)
            .translate(x, 0.35, z),
        );
        chrome.push(
          new THREE.CylinderGeometry(0.15, 0.15, 0.24, 8)
            .rotateZ(Math.PI / 2)
            .translate(x, 0.35, z),
        );
      }
    }
    chrome.push(new THREE.BoxGeometry(0.05, 0.05, 3).translate(1.02, 1.3, 0));
    root.add(new THREE.Mesh(mergeGeometries(tyres), named('Tyre')));
    root.add(new THREE.Mesh(mergeGeometries(chrome), named('Chrome')));

    const parts = separateWheels(root, new Set(['Tyre']), new Set(['Chrome']));

    // Four tyres and four hub caps, one of each per corner.
    expect(parts).toHaveLength(8);
    const corners = new Set(parts.map((part) => part.name.split('-').slice(-2).join('-')));
    expect(corners).toEqual(new Set(['left-front', 'right-front', 'left-rear', 'right-rear']));
    for (const part of parts) {
      const box = new THREE.Box3().setFromObject(part);
      expect(box.max.y).toBeLessThan(0.75);
    }
    // The trim strip stays on the body as the only chrome mesh left over.
    const trim = meshesNamed(root, 'Chrome').filter((mesh) => !parts.includes(mesh));
    expect(trim).toHaveLength(1);
    expect(new THREE.Box3().setFromObject(trim[0]).min.y).toBeGreaterThan(1.2);
  });

  it('straightens a tyre the model left steered and leaves calipers behind', () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4.6).translate(0, 1, 0), named('Paint')));
    const tyres: THREE.BufferGeometry[] = [];
    const rims: THREE.BufferGeometry[] = [];
    for (const x of [-0.9, 0.9]) {
      for (const z of [-1.5, 1.5]) {
        // The left front wheel is posed turned by 0.3 rad, as some exports leave it.
        const steer = x < 0 && z < 0 ? 0.3 : 0;
        const pose = (geometry: THREE.BufferGeometry) =>
          geometry
            .rotateZ(Math.PI / 2)
            .rotateY(steer)
            .translate(x, 0.35, z);
        tyres.push(pose(new THREE.CylinderGeometry(0.35, 0.35, 0.22, 24)));
        // A spoke from beside the hub out to the rim, and a caliper part-way out.
        rims.push(pose(new THREE.BoxGeometry(0.04, 0.04, 0.24).translate(0, 0, 0.15)));
        rims.push(
          new THREE.BoxGeometry(0.06, 0.12, 0.08).translate(x * 0.92, 0.35 + 0.2, z + 0.05),
        );
      }
    }
    root.add(new THREE.Mesh(mergeGeometries(tyres), named('Tyre')));
    root.add(new THREE.Mesh(mergeGeometries(rims), named('Rim')));

    const parts = separateWheels(root, new Set(['Tyre']), new Set(['Rim']));

    const tyre = parts.find(
      (part) =>
        part.name.endsWith('left-front') && (part.material as THREE.Material).name === 'Tyre',
    );
    const size = new THREE.Box3().setFromObject(tyre!).getSize(new THREE.Vector3());
    // Straightened, the tyre is as long as it is tall and only as wide as its tread.
    expect(size.z).toBeCloseTo(size.y, 2);
    expect(size.x).toBeCloseTo(0.22, 2);
    // Spokes join the wheels; the calipers stay on the body.
    const rimParts = parts.filter((part) => (part.material as THREE.Material).name === 'Rim');
    expect(rimParts).toHaveLength(4);
    const leftOver = meshesNamed(root, 'Rim').filter((mesh) => !parts.includes(mesh));
    expect(leftOver).toHaveLength(1);
    expect(leftOver[0].geometry.getIndex()!.count / 3).toBe(4 * 12);
  });

  it('gives up when four tyres cannot be found', () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4.6), named('Paint')));
    expect(separateWheels(root, new Set(['Tyre']), new Set())).toEqual([]);
  });
});

describe('splitLampsByEnd', () => {
  it('splits one lamp material into front and rear halves', () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4.6), named('Paint')));
    const lamps = mergeGeometries([
      new THREE.BoxGeometry(0.3, 0.1, 0.05).translate(0.7, 0.3, -2.3),
      new THREE.BoxGeometry(0.3, 0.1, 0.05).translate(0.7, 0.3, 2.3),
    ]);
    root.add(new THREE.Mesh(lamps, named('Lights')));

    splitLampsByEnd(root, new Set(['Lights']));

    const front = meshesNamed(root, 'Lights#front');
    const rear = meshesNamed(root, 'Lights#rear');
    expect(meshesNamed(root, 'Lights')).toHaveLength(0);
    expect(front).toHaveLength(1);
    expect(rear).toHaveLength(1);
    expect(new THREE.Box3().setFromObject(front[0]).max.z).toBeLessThan(0);
    expect(new THREE.Box3().setFromObject(rear[0]).min.z).toBeGreaterThan(0);
  });
});
