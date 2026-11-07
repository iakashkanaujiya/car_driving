import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GAME } from '../config';
import { roadCenter, roadHeading, roadWindowStart, wrapIntoWindow } from '../math';
import type { EnvironmentLook } from './conditions';
import { createLampGlowMaterial } from './lampGlow';

/** Lamps on one side of the road are this far apart (60 m); the sides are staggered. */
export const STREET_LIGHT_SPACING = 120;
const LAMPS_PER_SIDE = 6;
/** Poles stand just outside the fence, clear of the roadside trees. */
export const POLE_OFFSET = GAME.roadWidth / 2 + 3.2;
/** The arm reaches in over the outer lane. */
export const ARM_REACH = 8;
export const POLE_HEIGHT = 20;
const LAMP_HEAD_HEIGHT = 19.5;
/** Kept built behind the view; the rest of the ring lies ahead. */
const KEEP_BEHIND = 80;
const LAMP_COLOR = new THREE.Color(1, 0.84, 0.62);
/** Peak glow and pool brightness in full darkness (HDR, feeds the bloom). */
const GLOW_BRIGHTNESS = 1.4;
const GLOW_SIZE = 2.4;
/** Wide, soft pools that start to blend from one lamp to the next. */
const POOL_SIZE = 56;
const POOL_BRIGHTNESS = 0.16;
/** Lower falloff exponents spread a pool's light more evenly toward its edge. */
const POOL_FALLOFF = 1.4;
/**
 * One real light rides on the lamp nearest the player, so the car, road and
 * verge brighten as each lamp passes overhead. It fades out well before the
 * next lamp takes over, so the hand-over never shows.
 */
const PASSING_LIGHT_CANDELA = 12;
/** A gentle distance decay spreads the passing light across the road and verge. */
const PASSING_LIGHT_DECAY = 1.2;
const PASSING_LIGHT_FADE = { near: 10, far: 32 } as const;

interface LampSlot {
  distance: number;
  side: -1 | 1;
}

/** Pole, arm and lamp housing in one geometry; +X points in over the road. */
export function createStreetLightGeometry(): {
  structure: THREE.BufferGeometry;
  lens: THREE.BufferGeometry;
} {
  const pole = new THREE.CylinderGeometry(0.18, 0.26, POLE_HEIGHT, 10, 1);
  pole.translate(0, POLE_HEIGHT / 2, 0);
  const arm = new THREE.CylinderGeometry(0.1, 0.12, ARM_REACH + 0.4, 6, 1);
  arm.rotateZ(Math.PI / 2 - 0.05);
  arm.translate(ARM_REACH / 2, POLE_HEIGHT - 0.4, 0);
  const housing = new THREE.BoxGeometry(2.4, 0.38, 0.95);
  housing.translate(ARM_REACH, LAMP_HEAD_HEIGHT + 0.15, 0);
  const structure = mergeGeometries(
    [pole, arm, housing].map((part) => part.toNonIndexed()),
    false,
  );
  [pole, arm, housing].forEach((part) => part.dispose());
  const lens = new THREE.BoxGeometry(2.1, 0.08, 0.75);
  lens.translate(ARM_REACH, LAMP_HEAD_HEIGHT - 0.06, 0);
  if (!structure) throw new Error('The street light geometry could not be built.');
  return { structure, lens };
}

/** Round, soft-edged pool of light for the road surface under a lamp. */
export function createStreetPoolTexture(size = 64): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = ((x + 0.5) / size) * 2 - 1;
      const v = ((y + 0.5) / size) * 2 - 1;
      const radius = Math.min(1, Math.hypot(u, v));
      const value = Math.round(Math.pow(1 - radius * radius, POOL_FALLOFF) * 255);
      data.set([value, value, value, value], (y * size + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Street lights along both verges, staggered so a lamp passes every 30 m.
 * By day they are poles that cast shadows; after dark the lenses glow and
 * each lamp paints a pool of light on the road. Everything is instanced:
 * poles, lenses, pools and glows cost four draw calls, plus one real light
 * for the lamp the player is passing. Lamps recycle around the camera's view,
 * so they continue whichever way the player drives.
 */
export class StreetLightSystem {
  readonly passingLight: THREE.PointLight;
  private readonly slots: LampSlot[] = [];
  private readonly ringLength = LAMPS_PER_SIDE * STREET_LIGHT_SPACING;
  private readonly structureMaterial = new THREE.MeshStandardMaterial({
    color: 0x6d7378,
    roughness: 0.55,
    metalness: 0.6,
  });
  private readonly lensMaterial = new THREE.MeshStandardMaterial({
    color: 0xd9d4c8,
    roughness: 0.35,
    metalness: 0,
    emissive: LAMP_COLOR.clone(),
    emissiveIntensity: 0,
  });
  private readonly poolTexture = createStreetPoolTexture();
  private readonly poolMaterial: THREE.MeshBasicMaterial;
  private readonly glowMaterial = createLampGlowMaterial('DriftlineStreetGlow');
  private readonly structures: THREE.InstancedMesh;
  private readonly lenses: THREE.InstancedMesh;
  private readonly pools: THREE.InstancedMesh;
  private readonly glows: THREE.Points;
  private readonly glowPositions: Float32Array;
  private readonly glowColors: Float32Array;
  private readonly glowSizes: Float32Array;
  private readonly lampHeads: THREE.Vector3[] = [];
  private readonly transform = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private level = 0;
  private fogDensity = 0;
  private placed = false;

  constructor(private readonly scene: THREE.Scene) {
    for (let index = 0; index < LAMPS_PER_SIDE; index += 1) {
      const distance = -STREET_LIGHT_SPACING + index * STREET_LIGHT_SPACING;
      this.slots.push({ distance, side: -1 });
      this.slots.push({ distance: distance + STREET_LIGHT_SPACING / 2, side: 1 });
    }
    const count = this.slots.length;
    for (let index = 0; index < count; index += 1) this.lampHeads.push(new THREE.Vector3());

    const { structure, lens } = createStreetLightGeometry();
    this.structures = this.createInstanced(structure, this.structureMaterial, 'street-light-poles');
    this.structures.castShadow = true;
    this.lenses = this.createInstanced(lens, this.lensMaterial, 'street-light-lenses');

    const poolGeometry = new THREE.PlaneGeometry(1, 1);
    poolGeometry.rotateX(-Math.PI / 2);
    this.poolMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      alphaMap: this.poolTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.pools = this.createInstanced(poolGeometry, this.poolMaterial, 'street-light-pools');
    this.pools.setColorAt(0, this.color.setRGB(0, 0, 0));
    this.pools.renderOrder = 1;
    this.pools.visible = false;

    this.glowPositions = new Float32Array(count * 3);
    this.glowColors = new Float32Array(count * 3);
    this.glowSizes = new Float32Array(count).fill(GLOW_SIZE);
    const glowGeometry = new THREE.BufferGeometry();
    glowGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.glowPositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    glowGeometry.setAttribute(
      'aColor',
      new THREE.BufferAttribute(this.glowColors, 3).setUsage(THREE.DynamicDrawUsage),
    );
    glowGeometry.setAttribute('aSize', new THREE.BufferAttribute(this.glowSizes, 1));
    this.glows = new THREE.Points(glowGeometry, this.glowMaterial);
    this.glows.name = 'street-light-glows';
    this.glows.frustumCulled = false;
    this.glows.visible = false;
    this.glows.renderOrder = 2;
    scene.add(this.glows);

    this.passingLight = new THREE.PointLight(LAMP_COLOR, 0, 90, PASSING_LIGHT_DECAY);
    this.passingLight.name = 'street-light-passing';
    this.passingLight.castShadow = false;
    this.passingLight.visible = false;
    scene.add(this.passingLight);
  }

  /** Lamps come on with the cars' lights. Toggling the passing light recompiles lit materials. */
  setLook(look: EnvironmentLook): void {
    this.level = look.vehicleLights;
    this.fogDensity = look.fogDensity;
    const lit = this.level > 0;
    this.lensMaterial.emissiveIntensity = 1.8 * this.level;
    this.pools.visible = lit;
    this.glows.visible = lit;
    this.passingLight.visible = lit;
  }

  update(
    playerDistance: number,
    viewAlong: number,
    camera: THREE.Camera,
    viewportHeight: number,
    player: THREE.Vector3,
  ): void {
    const start = roadWindowStart(playerDistance, viewAlong, this.ringLength, KEEP_BEHIND);
    let moved = !this.placed;
    for (const slot of this.slots) {
      const wrapped = wrapIntoWindow(slot.distance, start, this.ringLength);
      if (wrapped === slot.distance) continue;
      slot.distance = wrapped;
      moved = true;
    }
    if (moved) this.placeLamps();
    if (this.level <= 0) return;
    this.glowMaterial.uniforms.uViewportHeight.value = viewportHeight;
    this.lightLamps(camera.position, player);
  }

  dispose(): void {
    this.scene.remove(this.structures, this.lenses, this.pools, this.glows, this.passingLight);
    for (const mesh of [this.structures, this.lenses, this.pools]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.glows.geometry.dispose();
    this.glowMaterial.dispose();
    this.structureMaterial.dispose();
    this.lensMaterial.dispose();
    this.poolMaterial.dispose();
    this.poolTexture.dispose();
    this.passingLight.dispose();
  }

  private createInstanced(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    name: string,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, this.slots.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Instances are rewritten along the road, so static bounds would be stale.
    mesh.frustumCulled = false;
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.name = name;
    this.scene.add(mesh);
    return mesh;
  }

  /** Writes pole, lens and pool transforms and the lamp head positions. */
  private placeLamps(): void {
    this.slots.forEach((slot, index) => {
      const heading = roadHeading(slot.distance);
      const center = roadCenter(slot.distance);
      const lateral = slot.side * POLE_OFFSET;
      // Local +X turns to face the centre line from either verge.
      const facing = slot.side > 0 ? heading + Math.PI : heading;
      this.transform.position.set(
        center + Math.cos(heading) * lateral,
        0,
        -slot.distance - Math.sin(heading) * lateral,
      );
      this.transform.rotation.set(0, facing, 0);
      this.transform.scale.set(1, 1, 1);
      this.transform.updateMatrix();
      this.structures.setMatrixAt(index, this.transform.matrix);
      this.lenses.setMatrixAt(index, this.transform.matrix);

      const headLateral = slot.side * (POLE_OFFSET - ARM_REACH);
      const head = this.lampHeads[index].set(
        center + Math.cos(heading) * headLateral,
        LAMP_HEAD_HEIGHT - 0.25,
        -slot.distance - Math.sin(heading) * headLateral,
      );
      head.toArray(this.glowPositions, index * 3);
      this.transform.position.set(head.x, 0.035, head.z);
      this.transform.rotation.set(0, heading, 0);
      this.transform.scale.set(POOL_SIZE, 1, POOL_SIZE);
      this.transform.updateMatrix();
      this.pools.setMatrixAt(index, this.transform.matrix);
    });
    for (const mesh of [this.structures, this.lenses, this.pools]) {
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.glows.geometry.getAttribute('position').needsUpdate = true;
    this.placed = true;
  }

  /** Fades glows and pools through the fog, and moves the passing light. */
  private lightLamps(cameraPosition: THREE.Vector3, player: THREE.Vector3): void {
    let nearest = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    this.lampHeads.forEach((head, index) => {
      const distance = head.distanceTo(cameraPosition);
      // Bright lamps punch through haze better than the scenery around them.
      const glow = GLOW_BRIGHTNESS * this.level * Math.exp(-this.fogDensity * distance * 0.6);
      this.glowColors[index * 3] = LAMP_COLOR.r * glow;
      this.glowColors[index * 3 + 1] = LAMP_COLOR.g * glow;
      this.glowColors[index * 3 + 2] = LAMP_COLOR.b * glow;
      const pool = POOL_BRIGHTNESS * this.level * Math.exp(-this.fogDensity * distance);
      this.pools.setColorAt(index, this.color.copy(LAMP_COLOR).multiplyScalar(pool));
      const fromPlayer = Math.hypot(head.x - player.x, head.z - player.z);
      if (fromPlayer < nearestDistance) {
        nearestDistance = fromPlayer;
        nearest = index;
      }
    });
    this.glows.geometry.getAttribute('aColor').needsUpdate = true;
    if (this.pools.instanceColor) this.pools.instanceColor.needsUpdate = true;
    if (nearest >= 0) {
      this.passingLight.position.copy(this.lampHeads[nearest]);
      const fade =
        1 -
        THREE.MathUtils.smoothstep(
          nearestDistance,
          PASSING_LIGHT_FADE.near,
          PASSING_LIGHT_FADE.far,
        );
      this.passingLight.intensity = PASSING_LIGHT_CANDELA * this.level * fade;
    }
  }
}
