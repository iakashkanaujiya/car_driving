import * as THREE from 'three';
import { roadCenter, roadHeading } from './math';

export function createRoadStrip(width: number, segments: number, centerOffset = 0): THREE.BufferGeometry {
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const uvs = new Float32Array((segments + 1) * 2 * 2);
  const indices: number[] = [];

  for (let index = 0; index <= segments; index += 1) {
    const uvOffset = index * 4;
    uvs[uvOffset] = 0;
    uvs[uvOffset + 1] = index / segments;
    uvs[uvOffset + 2] = 1;
    uvs[uvOffset + 3] = index / segments;
    if (index < segments) {
      const vertex = index * 2;
      indices.push(vertex, vertex + 1, vertex + 2, vertex + 2, vertex + 1, vertex + 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.userData.width = width;
  geometry.userData.centerOffset = centerOffset;
  geometry.userData.uvWidth = Math.max(1, width / 9);
  geometry.userData.uvMeters = 11;
  return geometry;
}

export function updateRoadStrip(geometry: THREE.BufferGeometry, start: number, length: number): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const segments = position.count / 2 - 1;
  const halfWidth = geometry.userData.width / 2;
  const centerOffset = geometry.userData.centerOffset as number;
  const uvWidth = geometry.userData.uvWidth as number;
  const uvMeters = geometry.userData.uvMeters as number;

  for (let index = 0; index <= segments; index += 1) {
    const distance = start + (index / segments) * length;
    const center = roadCenter(distance);
    const heading = roadHeading(distance);
    const sideX = Math.cos(heading);
    const sideZ = -Math.sin(heading);
    const vertex = index * 2;
    position.setXYZ(vertex, center + sideX * (centerOffset - halfWidth), 0, -distance + sideZ * (centerOffset - halfWidth));
    position.setXYZ(vertex + 1, center + sideX * (centerOffset + halfWidth), 0, -distance + sideZ * (centerOffset + halfWidth));
    uv.setXY(vertex, 0, distance / uvMeters);
    uv.setXY(vertex + 1, uvWidth, distance / uvMeters);
  }

  position.needsUpdate = true;
  uv.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}
