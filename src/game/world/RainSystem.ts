import * as THREE from 'three';
import { mulberry32 } from './noise';

const STREAK_COUNT = 5200;
/** Volume of rain kept around the camera; streaks wrap inside it. */
const RAIN_BOX = new THREE.Vector3(64, 30, 86);
/** How far ahead of the camera the box is centred, so most streaks are in view. */
const BOX_LEAD = 30;
/** Rain falls at this velocity in world units per second, with a light crosswind. */
const FALL_VELOCITY = new THREE.Vector3(1.6, -24, 0.8);
/** Streak length is the drop's motion relative to the camera over this exposure. */
const SHUTTER_SECONDS = 0.022;
/** Drops caught in the player's headlight beam sparkle with its colour. */
const BEAM_RAIN_BRIGHTNESS = 0.012;

const RAIN_VERTEX = /* glsl */ `
attribute float aTail;
uniform vec3 uBox;
uniform vec3 uCenter;
uniform vec3 uShift;
uniform vec3 uStreak;
uniform vec3 uBeamPosition;
uniform vec3 uBeamDirection;
uniform vec2 uBeamCone;
varying float vFade;
varying float vBeam;
void main() {
  // Each drop sits on a lattice that falls with time; wrapping it into the
  // box around the camera keeps the volume full without respawning drops.
  vec3 local = mod( position * uBox + uShift, uBox ) - 0.5 * uBox;
  vec3 world = uCenter + local - uStreak * aTail;
  vec4 mvPosition = viewMatrix * vec4( world, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  vec3 edge = abs( local ) / ( 0.5 * uBox );
  float edgeFade = 1.0 - smoothstep( 0.7, 1.0, max( max( edge.x, edge.y ), edge.z ) );
  vFade = edgeFade * smoothstep( 1.5, 5.0, -mvPosition.z ) * ( 1.0 - 0.8 * aTail );
  vec3 toDrop = world - uBeamPosition;
  float beamDistance = length( toDrop );
  float beamAngle = dot( toDrop / max( beamDistance, 1e-3 ), uBeamDirection );
  vBeam = smoothstep( uBeamCone.x, uBeamCone.y, beamAngle ) / ( 1.0 + beamDistance * 0.08 );
}
`;

const RAIN_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uBeamColor;
uniform float uOpacity;
varying float vFade;
varying float vBeam;
void main() {
  gl_FragColor = vec4( uColor + uBeamColor * vBeam, uOpacity * vFade );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Deterministic drop seeds in the unit cube, two vertices (head, tail) per streak. */
export function createRainGeometry(count = STREAK_COUNT, seed = 7): THREE.BufferGeometry {
  const random = mulberry32(seed);
  const positions = new Float32Array(count * 6);
  const tails = new Float32Array(count * 2);
  for (let streak = 0; streak < count; streak += 1) {
    const x = random();
    const y = random();
    const z = random();
    positions.set([x, y, z, x, y, z], streak * 6);
    tails[streak * 2 + 1] = 1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aTail', new THREE.BufferAttribute(tails, 1));
  return geometry;
}

/**
 * Falling rain as one draw call of line streaks animated on the GPU. Streaks
 * stretch along the drops' motion relative to the moving camera, so they slant
 * toward the windscreen at speed.
 */
export class RainSystem {
  readonly mesh: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly lastCamera = new THREE.Vector3();
  private readonly cameraVelocity = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly fallOffset = new THREE.Vector3();
  private hasLastCamera = false;

  constructor(private readonly scene: THREE.Scene) {
    const material = new THREE.ShaderMaterial({
      name: 'DriftlineRain',
      uniforms: {
        uBox: { value: RAIN_BOX.clone() },
        uCenter: { value: new THREE.Vector3() },
        uShift: { value: new THREE.Vector3() },
        uStreak: { value: new THREE.Vector3() },
        uColor: { value: new THREE.Color() },
        uOpacity: { value: 0 },
        uBeamPosition: { value: new THREE.Vector3() },
        uBeamDirection: { value: new THREE.Vector3(0, 0, -1) },
        uBeamCone: { value: new THREE.Vector2(1, 1) },
        uBeamColor: { value: new THREE.Color(0, 0, 0) },
      },
      vertexShader: RAIN_VERTEX,
      fragmentShader: RAIN_FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.LineSegments(createRainGeometry(), material);
    this.mesh.name = 'rain';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
  }

  /** Sets rainfall (0 hides the rain) and the colour of lit drops. */
  setRain(intensity: number, color: THREE.Color): void {
    const amount = THREE.MathUtils.clamp(intensity, 0, 1);
    this.mesh.visible = amount > 0;
    this.mesh.geometry.setDrawRange(0, Math.round(STREAK_COUNT * amount) * 2);
    this.mesh.material.uniforms.uOpacity.value = 0.2 * Math.sqrt(amount);
    this.mesh.material.uniforms.uColor.value.copy(color);
    this.hasLastCamera = false;
  }

  update(camera: THREE.Camera, dt: number, beam?: THREE.SpotLight): void {
    if (!this.mesh.visible) return;
    const uniforms = this.mesh.material.uniforms;
    this.updateBeam(beam);
    if (this.hasLastCamera && dt > 0) {
      const velocity = this.lastCamera.sub(camera.position).multiplyScalar(-1 / dt);
      this.cameraVelocity.lerp(velocity, 1 - Math.exp(-8 * dt));
    } else {
      this.cameraVelocity.set(0, 0, 0);
    }
    this.lastCamera.copy(camera.position);
    this.hasLastCamera = true;

    camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    this.forward.normalize();
    const center = uniforms.uCenter.value as THREE.Vector3;
    center.copy(camera.position).addScaledVector(this.forward, BOX_LEAD);
    center.y = RAIN_BOX.y * 0.5 - 2;

    // Wrap the fall offset in double precision so the shader never sees large numbers.
    this.fallOffset.addScaledVector(FALL_VELOCITY, dt);
    const shift = uniforms.uShift.value as THREE.Vector3;
    for (const axis of ['x', 'y', 'z'] as const) {
      this.fallOffset[axis] = THREE.MathUtils.euclideanModulo(
        this.fallOffset[axis],
        RAIN_BOX[axis],
      );
      shift[axis] = THREE.MathUtils.euclideanModulo(
        this.fallOffset[axis] - center[axis] + RAIN_BOX[axis] * 0.5,
        RAIN_BOX[axis],
      );
    }
    (uniforms.uStreak.value as THREE.Vector3)
      .copy(FALL_VELOCITY)
      .sub(this.cameraVelocity)
      .multiplyScalar(SHUTTER_SECONDS);
  }

  private updateBeam(beam?: THREE.SpotLight): void {
    const uniforms = this.mesh.material.uniforms;
    const color = uniforms.uBeamColor.value as THREE.Color;
    if (!beam?.visible || beam.intensity <= 0) {
      color.setRGB(0, 0, 0);
      return;
    }
    (uniforms.uBeamPosition.value as THREE.Vector3).copy(beam.position);
    (uniforms.uBeamDirection.value as THREE.Vector3)
      .subVectors(beam.target.position, beam.position)
      .normalize();
    (uniforms.uBeamCone.value as THREE.Vector2).set(
      Math.cos(beam.angle),
      Math.cos(beam.angle * (1 - beam.penumbra)),
    );
    color.copy(beam.color).multiplyScalar(beam.intensity * BEAM_RAIN_BRIGHTNESS);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
