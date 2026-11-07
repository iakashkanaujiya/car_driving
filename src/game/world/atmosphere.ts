import * as THREE from 'three';

/**
 * Clear-day look-development constants for the sky, sun light and haze. Other
 * times of day and weather derive from them in `conditions.ts`; the visible
 * sun, the shadow direction, the reflections and the fog always share one
 * light direction.
 */
export const ATMOSPHERE = {
  /** Unit vector pointing from the scene toward the sun (late afternoon, low left). */
  sunDirection: new THREE.Vector3(-0.8, 0.42, -0.43).normalize(),
  sunColor: new THREE.Color(0xffe0b8),
  sunIntensity: 4.4,
  /** Haze colour away from the sun; matched by the sky shader at the horizon. */
  fogColor: new THREE.Color(0x92b0cf),
  /** Haze colour looking into the sun (forward scattering). */
  sunScatterColor: new THREE.Color(0xf0d6b0),
  /** Ground-level extinction per world unit. */
  fogDensity: 0.00105,
  /** Fog thins exponentially with altitude at this rate per world unit. */
  heightFalloff: 0.0068,
  /** Colour reflected from below the horizon in the environment map. */
  groundColor: new THREE.Color(0x3b4733),
} as const;

const glslFloat = (value: number): string => {
  const text = value.toFixed(6);
  return text.includes('.') ? text : `${text}.0`;
};

/**
 * Storage for the fog's sun-scatter terms. three.js copies vector and colour
 * uniforms into every material but keeps typed arrays by reference, so all
 * materials read these two arrays and one write retints the whole scene.
 */
const fogScatterDirection = new Float32Array(3);
const fogScatterColor = new Float32Array(3);

/**
 * Builds the GLSL that replaces three.js' uniform fog with aerial perspective:
 * exponential height fog integrated along the view ray, tinted toward the sun.
 * Exported separately so the maths can be unit tested without WebGL.
 */
export function createAtmosphericFogChunks(): Record<
  'fog_pars_vertex' | 'fog_vertex' | 'fog_pars_fragment' | 'fog_fragment',
  string
> {
  return {
    fog_pars_vertex: /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogViewPosition;
#endif
`,
    fog_vertex: /* glsl */ `
#ifdef USE_FOG
  vFogViewPosition = mvPosition.xyz;
#endif
`,
    fog_pars_fragment: /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform vec3 fogScatterDirection;
  uniform vec3 fogScatterColor;
  varying vec3 vFogViewPosition;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif
`,
    fog_fragment: /* glsl */ `
#ifdef USE_FOG
  float fogDistance = length( vFogViewPosition );
  // Rotate the view-space ray back to world space (viewMatrix is orthonormal).
  vec3 fogRay = normalize( ( vec4( vFogViewPosition, 0.0 ) * viewMatrix ).xyz );
  #ifdef FOG_EXP2
    float fogHeightB = ${glslFloat(ATMOSPHERE.heightFalloff)};
    float fogOptical = fogDensity * exp( -max( cameraPosition.y, 0.0 ) * fogHeightB ) * fogDistance;
    float fogClimb = fogDistance * fogRay.y * fogHeightB;
    if ( abs( fogClimb ) > 1e-4 ) fogOptical *= ( 1.0 - exp( -fogClimb ) ) / fogClimb;
    float fogFactor = 1.0 - exp( -fogOptical );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, fogDistance );
  #endif
  float fogSun = pow( max( dot( fogRay, fogScatterDirection ), 0.0 ), 7.0 );
  vec3 fogTint = mix( fogColor, fogScatterColor, fogSun );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint, fogFactor );
#endif
`,
  };
}

let installed = false;

/** Installs the aerial-perspective fog for every built-in material. Idempotent. */
export function installAtmosphericFog(): void {
  if (installed) return;
  Object.assign(THREE.ShaderChunk, createAtmosphericFogChunks());
  for (const shader of Object.values(THREE.ShaderLib)) {
    if (!('fogColor' in shader.uniforms)) continue;
    shader.uniforms.fogScatterDirection = { value: fogScatterDirection };
    shader.uniforms.fogScatterColor = { value: fogScatterColor };
  }
  setAtmosphericScattering(ATMOSPHERE.sunDirection, ATMOSPHERE.sunScatterColor);
  installed = true;
}

/** Points the fog's forward scattering at the key light (sun or moon) and tints it. */
export function setAtmosphericScattering(direction: THREE.Vector3, color: THREE.Color): void {
  direction.toArray(fogScatterDirection);
  color.toArray(fogScatterColor);
}

/** CPU mirror of the shader's fog factor, used by tests and tuning tools. */
export function atmosphericFogFactor(
  distance: number,
  rayY: number,
  cameraHeight: number,
  density: number = ATMOSPHERE.fogDensity,
): number {
  const b = ATMOSPHERE.heightFalloff;
  let optical = density * Math.exp(-Math.max(cameraHeight, 0) * b) * distance;
  const climb = distance * rayY * b;
  if (Math.abs(climb) > 1e-4) optical *= (1 - Math.exp(-climb)) / climb;
  return 1 - Math.exp(-optical);
}
