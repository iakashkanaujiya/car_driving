import * as THREE from 'three';
import { fbm3, ridged3 } from './noise';

const INNER_RADIUS = 360;
const OUTER_RADIUS = 1550;
const ANGULAR_SEGMENTS = 512;
const RADIAL_SEGMENTS = 26;
const PEAK_HEIGHT = 330;

/**
 * Height of the alpine backdrop at a polar coordinate. Noise is sampled on a
 * circle so the ring is seamless; foothills rise from the valley floor and the
 * outer rings carry the tallest, ridged summits.
 */
export function mountainHeight(angle: number, radius: number): number {
  const ring = THREE.MathUtils.clamp((radius - INNER_RADIUS) / (OUTER_RADIUS - INNER_RADIUS), 0, 1);
  const cx = Math.cos(angle) * 3.1;
  const cz = Math.sin(angle) * 3.1;
  const depth = radius / 260;
  const ridges = ridged3(cx, depth, cz, 6, 17);
  const massif = fbm3(cx * 0.55 + 4.2, depth * 0.35, cz * 0.55 - 1.3, 4, 29);
  const foothill = THREE.MathUtils.smoothstep(ring, 0.0, 0.42);
  const range = THREE.MathUtils.smoothstep(ring, 0.18, 0.78);
  // Fine erosion detail keeps large faces from reading as flat facets.
  const erosion = fbm3(cx * 9, depth * 4.5, cz * 9, 3, 53) - 0.5;
  const height =
    foothill * (12 + fbm3(cx * 2.2, depth * 1.3, cz * 2.2, 4, 5) * 46) +
    range * PEAK_HEIGHT * Math.pow(ridges, 1.35) * (0.45 + massif * 0.95) +
    range * erosion * 34;
  return height - 3;
}

const FOREST = new THREE.Color(0x26331f);
const FOREST_DRY = new THREE.Color(0x3d4530);
const ROCK = new THREE.Color(0x5f5d5a);
const ROCK_DARK = new THREE.Color(0x3d3c3d);
const SCREE = new THREE.Color(0x7a7366);
const SNOW = new THREE.Color(0xc9d2dc);
const ROCK_MIX = new THREE.Color();

/** Ground-cover colour from altitude, slope (normal.y) and a breakup noise. */
export function mountainColor(
  height: number,
  slope: number,
  variation: number,
  target: THREE.Color,
): THREE.Color {
  const treeLine = 70 + variation * 45;
  const snowLine = 205 + (variation - 0.5) * 80;
  const rockiness = THREE.MathUtils.smoothstep(1 - slope, 0.22, 0.5);
  target.copy(FOREST).lerp(FOREST_DRY, variation * 0.6);
  const aboveTrees = THREE.MathUtils.smoothstep(height, treeLine - 18, treeLine + 22);
  const rock = ROCK_MIX.copy(SCREE).lerp(ROCK, 0.55 + variation * 0.45);
  rock.lerp(ROCK_DARK, rockiness * 0.65);
  target.lerp(rock, Math.max(aboveTrees, rockiness * 0.85));
  // Snow settles on gentler slopes above the snow line.
  const snow =
    THREE.MathUtils.smoothstep(height, snowLine - 25, snowLine + 30) *
    THREE.MathUtils.smoothstep(slope, 0.55, 0.78);
  target.lerp(SNOW, snow);
  return target;
}

/**
 * A seamless ring of procedural mountains that follows the camera. Being far
 * away, it needs no parallax and adds only a single draw call.
 */
export class MountainRange {
  readonly mesh: THREE.Mesh;

  constructor() {
    const geometry = MountainRange.createGeometry();
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.93,
      metalness: 0,
      envMapIntensity: 0.55,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'mountain-range';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
  }

  private static createGeometry(): THREE.BufferGeometry {
    const columns = ANGULAR_SEGMENTS;
    const rows = RADIAL_SEGMENTS;
    const positions = new Float32Array((columns + 1) * (rows + 1) * 3);
    const indices: number[] = [];
    for (let row = 0; row <= rows; row += 1) {
      // Denser rings near the valley, sparser toward the far summits.
      const t = row / rows;
      const radius = INNER_RADIUS + (OUTER_RADIUS - INNER_RADIUS) * Math.pow(t, 1.35);
      for (let column = 0; column <= columns; column += 1) {
        const angle = (column / columns) * Math.PI * 2;
        const index = (row * (columns + 1) + column) * 3;
        positions[index] = Math.cos(angle) * radius;
        positions[index + 1] = mountainHeight(angle, radius);
        positions[index + 2] = Math.sin(angle) * radius;
        if (row < rows && column < columns) {
          const a = row * (columns + 1) + column;
          const b = a + columns + 1;
          indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const normals = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const colors = new Float32Array(positions.length);
    const color = new THREE.Color();
    for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
      const x = positions[vertex * 3];
      const y = positions[vertex * 3 + 1];
      const z = positions[vertex * 3 + 2];
      const variation = fbm3(x * 0.006, y * 0.01, z * 0.006, 3, 41);
      mountainColor(y, normals.getY(vertex), variation, color);
      colors[vertex * 3] = color.r;
      colors[vertex * 3 + 1] = color.g;
      colors[vertex * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    return geometry;
  }

  update(center: THREE.Vector3): void {
    this.mesh.position.set(center.x, 0, center.z);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
