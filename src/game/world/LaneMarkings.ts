import * as THREE from 'three';
import { laneDividerOffsets } from '../config';
import { createRoadStrip, updateRoadStrip } from '../roadSurface';

const SEGMENTS = 320;
const LINE_WIDTH = 0.32;
/** One painted dash plus the gap after it, in metres along the road. */
export const DASH_PERIOD = 18;
export const DASH_FRACTION = 1 / 3;

/**
 * A one-texel-wide alpha strip: painted for the first third of each period.
 * Mipmaps let distant dashes blend into a faint continuous line.
 */
export function createDashTexture(height = 64): THREE.DataTexture {
  const data = new Uint8Array(height * 4);
  for (let row = 0; row < height; row += 1) {
    const paint = (row + 0.5) / height < DASH_FRACTION ? 255 : 0;
    data.set([paint, paint, paint, 255], row * 4);
  }
  const texture = new THREE.DataTexture(data, 1, height, THREE.RGBAFormat);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Dashed white dividers between the two lanes on each side of the double
 * yellow line. They follow the road ribbon and stay fixed in world space.
 */
export class LaneMarkings {
  private readonly texture = createDashTexture();
  private readonly material = new THREE.MeshStandardMaterial({
    color: 0xdcd8cb,
    roughness: 0.62,
    metalness: 0,
    alphaMap: this.texture,
    transparent: true,
    depthWrite: false,
    // Painted on the asphalt, so pull it toward the camera instead of lifting it.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  private readonly meshes: THREE.Mesh[];

  constructor(private readonly scene: THREE.Scene) {
    this.meshes = laneDividerOffsets.map((offset) => {
      const geometry = createRoadStrip(LINE_WIDTH, SEGMENTS, offset, 1, DASH_PERIOD);
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.name = 'lane-divider';
      mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    });
  }

  update(start: number, length: number): void {
    for (const mesh of this.meshes) updateRoadStrip(mesh.geometry, start, length);
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.material.dispose();
    this.texture.dispose();
  }
}
