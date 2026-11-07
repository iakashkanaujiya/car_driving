import * as THREE from 'three';
import type { VehicleLightRig } from '../vehicleAssets';
import type { EnvironmentLook } from './conditions';
import { createLampGlowMaterial } from './lampGlow';

const MAX_VEHICLES = 20;
const MAX_GLOWS = MAX_VEHICLES * 4;
const GLOW_RANGE = 440;
const HEADLAMP_COLOR = new THREE.Color(1, 0.93, 0.8);
const TAIL_COLOR = new THREE.Color(1, 0.05, 0.03);
/** Peak brightness of a lamp core in full darkness (HDR, feeds the bloom). */
const HEADLAMP_GLOW = 3.2;
const TAIL_GLOW = 1.3;
const BRAKE_GLOW = 3.4;
/** Light pool painted on the road ahead of every lit traffic car. */
const POOL_WIDTH = 9.5;
const POOL_LENGTH = 28;
const POOL_BRIGHTNESS = 0.28;
/**
 * Player headlight beam at full darkness. The road is lit at grazing angles,
 * so the beam is strong, aimed far ahead and decays gently; its wide penumbra
 * keeps the patch just ahead of the bumper from blowing out.
 */
const HEADLIGHT_CANDELA = 200;
const HEADLIGHT_REACH = 60;
/** Glows sit this far outside their lens so the car body never hides them. */
const LAMP_STANDOFF = 0.15;
/**
 * Tail glows fade in from this camera distance (in world units). Up close the
 * real emissive lenses read on their own and a sprite would only float beside them.
 */
const TAIL_GLOW_FADE = { start: 14, end: 34 } as const;

/** Bright near the car, fading toward the far end and the sides. */
export function createPoolTexture(width = 32, height = 64): THREE.DataTexture {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    // v = 0 at the car's bumper, 1 at the far end of the beam.
    const v = (y + 0.5) / height;
    const along = THREE.MathUtils.smoothstep(v, 0, 0.12) * Math.pow(1 - v, 1.5);
    for (let x = 0; x < width; x += 1) {
      const u = Math.abs((x + 0.5) / width - 0.5) * 2;
      // The beam widens with distance, like two overlapping headlamp cones.
      const spread = 0.45 + 0.55 * Math.min(1, v * 2.2);
      const across = Math.pow(Math.max(0, 1 - Math.pow(u / spread, 2)), 1.6);
      const value = Math.round(along * across * 255);
      data.set([value, value, value, value], (y * width + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Night-time vehicle lighting. The player gets a real spot light that lights
 * the road, traffic and scenery; traffic lamps are a single draw call of
 * additive glow sprites plus one instanced draw of light pools on the road,
 * so a full road of traffic costs no extra per-pixel lights.
 */
export class VehicleLightSystem {
  readonly headlight: THREE.SpotLight;
  private readonly glowGeometry = new THREE.BufferGeometry();
  private readonly glowPositions = new Float32Array(MAX_GLOWS * 3);
  private readonly glowColors = new Float32Array(MAX_GLOWS * 3);
  private readonly glowSizes = new Float32Array(MAX_GLOWS);
  private readonly glowMaterial: THREE.ShaderMaterial;
  private readonly glows: THREE.Points;
  private readonly poolTexture = createPoolTexture();
  private readonly poolMaterial: THREE.MeshBasicMaterial;
  private readonly pools: THREE.InstancedMesh;
  private readonly cameraPosition = new THREE.Vector3();
  private readonly lamp = new THREE.Vector3();
  private readonly poolTransform = new THREE.Object3D();
  private readonly poolColor = new THREE.Color();
  private level = 0;
  private fogDensity = 0;
  private glowCount = 0;
  private poolCount = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.headlight = new THREE.SpotLight(0xfff0d8, 0, 220, 0.36, 0.85, 0.6);
    this.headlight.name = 'player-headlight';
    this.headlight.castShadow = false;
    this.headlight.visible = false;
    scene.add(this.headlight, this.headlight.target);

    this.glowGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.glowPositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.glowGeometry.setAttribute(
      'aColor',
      new THREE.BufferAttribute(this.glowColors, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.glowGeometry.setAttribute(
      'aSize',
      new THREE.BufferAttribute(this.glowSizes, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.glowGeometry.setDrawRange(0, 0);
    this.glowMaterial = createLampGlowMaterial('DriftlineLampGlow');
    this.glows = new THREE.Points(this.glowGeometry, this.glowMaterial);
    this.glows.name = 'vehicle-lamp-glows';
    this.glows.frustumCulled = false;
    this.glows.visible = false;
    this.glows.renderOrder = 2;
    scene.add(this.glows);

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
    this.pools = new THREE.InstancedMesh(poolGeometry, this.poolMaterial, MAX_VEHICLES);
    this.pools.name = 'vehicle-light-pools';
    this.pools.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pools.setColorAt(0, this.poolColor.setRGB(0, 0, 0));
    this.pools.count = 0;
    this.pools.frustumCulled = false;
    this.pools.visible = false;
    this.pools.renderOrder = 1;
    scene.add(this.pools);
  }

  /** Turns lamps on or off for a look. Toggling the spot light recompiles lit materials. */
  setLook(look: EnvironmentLook): void {
    this.level = look.vehicleLights;
    this.fogDensity = look.fogDensity;
    const lit = this.level > 0;
    this.headlight.visible = look.headlightIntensity > 0;
    this.headlight.intensity = HEADLIGHT_CANDELA * look.headlightIntensity;
    this.glows.visible = lit;
    this.pools.visible = lit;
  }

  /** Starts collecting lamps for this frame. Returns false while lights are off. */
  beginFrame(camera: THREE.Camera, viewportHeight: number): boolean {
    this.glowCount = 0;
    this.poolCount = 0;
    if (this.level <= 0) return false;
    this.cameraPosition.copy(camera.position);
    this.glowMaterial.uniforms.uViewportHeight.value = viewportHeight;
    return true;
  }

  /** Aims the player's headlight beam down the road ahead of `car`. */
  placeHeadlight(car: THREE.Object3D, rig: VehicleLightRig): void {
    if (!this.headlight.visible) return;
    const heading = car.rotation.y;
    // Between the headlamps and just ahead of them, so the beam never lights the car's own body.
    const { y, z } = rig.headlamp;
    this.toWorld(car, 0, y, z - 0.3, this.headlight.position);
    this.headlight.target.position.set(
      this.headlight.position.x - Math.sin(heading) * HEADLIGHT_REACH,
      0,
      this.headlight.position.z - Math.cos(heading) * HEADLIGHT_REACH,
    );
    this.headlight.target.updateMatrixWorld();
  }

  /**
   * Adds a traffic car's lamps at its measured lens positions. Glows face
   * their lamp's direction, so oncoming headlights shine at the camera while
   * cars ahead show only tail lights. The player's own car needs none: its
   * real lenses are close enough to read on their own.
   */
  addVehicle(car: THREE.Object3D, rig: VehicleLightRig, braking: boolean): void {
    const heading = car.rotation.y;
    const forwardX = -Math.sin(heading);
    const forwardZ = -Math.cos(heading);
    const { headlamp, taillamp } = rig;
    for (let side = -1; side <= 1; side += 2) {
      this.toWorld(car, side * headlamp.x, headlamp.y, headlamp.z - LAMP_STANDOFF, this.lamp);
      this.pushGlow(forwardX, forwardZ, HEADLAMP_COLOR, HEADLAMP_GLOW, 1.5, false);
    }
    this.pushPool(car, -headlamp.z);
    const tail = braking ? BRAKE_GLOW : TAIL_GLOW;
    for (let side = -1; side <= 1; side += 2) {
      this.toWorld(car, side * taillamp.x, taillamp.y, taillamp.z + LAMP_STANDOFF, this.lamp);
      this.pushGlow(-forwardX, -forwardZ, TAIL_COLOR, tail, braking ? 1.2 : 0.9, true);
    }
  }

  endFrame(): void {
    this.glowGeometry.setDrawRange(0, this.glowCount);
    for (const name of ['position', 'aColor', 'aSize']) {
      const attribute = this.glowGeometry.getAttribute(name) as THREE.BufferAttribute;
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, this.glowCount * attribute.itemSize);
      attribute.needsUpdate = true;
    }
    this.pools.count = this.poolCount;
    this.pools.instanceMatrix.needsUpdate = true;
    if (this.pools.instanceColor) this.pools.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.headlight, this.headlight.target, this.glows, this.pools);
    this.headlight.dispose();
    this.glowGeometry.dispose();
    this.glowMaterial.dispose();
    this.pools.geometry.dispose();
    this.pools.dispose();
    this.poolMaterial.dispose();
    this.poolTexture.dispose();
  }

  /** Car-local point (forward is -Z) to world space, ignoring body roll and pitch. */
  private toWorld(
    car: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    target: THREE.Vector3,
  ): THREE.Vector3 {
    const sin = Math.sin(car.rotation.y);
    const cos = Math.cos(car.rotation.y);
    return target.set(
      car.position.x + x * cos + z * sin,
      car.position.y + y,
      car.position.z - x * sin + z * cos,
    );
  }

  /** Light reaching the camera through the fog; bright lamps punch through haze. */
  private transmittance(distance: number): number {
    return Math.exp(-this.fogDensity * distance * 0.6);
  }

  private pushGlow(
    directionX: number,
    directionZ: number,
    color: THREE.Color,
    brightness: number,
    size: number,
    fadeUpClose: boolean,
  ): void {
    if (this.glowCount >= MAX_GLOWS) return;
    const dx = this.cameraPosition.x - this.lamp.x;
    const dy = this.cameraPosition.y - this.lamp.y;
    const dz = this.cameraPosition.z - this.lamp.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance > GLOW_RANGE || distance < 0.5) return;
    const facing = (directionX * dx + directionZ * dz) / distance;
    let visibility = THREE.MathUtils.smoothstep(facing, -0.05, 0.5);
    if (fadeUpClose) {
      visibility *= THREE.MathUtils.smoothstep(distance, TAIL_GLOW_FADE.start, TAIL_GLOW_FADE.end);
    }
    if (visibility <= 0) return;
    const energy = brightness * this.level * visibility * this.transmittance(distance);
    // Fog scatters lamp light into a wider halo.
    const halo = 1 + Math.min(1.5, this.fogDensity * 160);
    const index = this.glowCount;
    this.lamp.toArray(this.glowPositions, index * 3);
    this.glowColors[index * 3] = color.r * energy;
    this.glowColors[index * 3 + 1] = color.g * energy;
    this.glowColors[index * 3 + 2] = color.b * energy;
    this.glowSizes[index] = size * halo;
    this.glowCount += 1;
  }

  private pushPool(car: THREE.Object3D, front: number): void {
    if (this.poolCount >= MAX_VEHICLES) return;
    this.toWorld(car, 0, 0, -(front + POOL_LENGTH / 2 - 0.6), this.lamp);
    const distance = this.lamp.distanceTo(this.cameraPosition);
    if (distance > GLOW_RANGE) return;
    this.poolTransform.position.set(this.lamp.x, 0.03, this.lamp.z);
    this.poolTransform.rotation.set(0, car.rotation.y, 0);
    this.poolTransform.scale.set(POOL_WIDTH, 1, POOL_LENGTH);
    this.poolTransform.updateMatrix();
    this.pools.setMatrixAt(this.poolCount, this.poolTransform.matrix);
    const energy = POOL_BRIGHTNESS * this.level * Math.exp(-this.fogDensity * distance);
    this.poolColor.setRGB(
      HEADLAMP_COLOR.r * energy,
      HEADLAMP_COLOR.g * energy,
      HEADLAMP_COLOR.b * energy,
    );
    this.pools.setColorAt(this.poolCount, this.poolColor);
    this.poolCount += 1;
  }
}
