import * as THREE from 'three';

/**
 * How much of the key light's (sun or moon) mirror-like reflection to remove.
 * Moonlight is exaggerated so the valley stays readable at night, but a real
 * moon barely glints on car paint, so its specular term is dimmed on its own.
 * A vec2 because three.js shares array-valued uniforms by reference (scalars
 * are copied per material); only x is read.
 */
const keyLightSpecularDim = new Float32Array(2);

const DIRECTIONAL_LIGHTS = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
const LOOP_END = '#pragma unroll_loop_end';

const BEFORE_DIRECTIONAL = /* glsl */ `
vec3 keyLightSpecularBefore = reflectedLight.directSpecular;
#ifdef USE_CLEARCOAT
  vec3 keyLightClearcoatBefore = clearcoatSpecularDirect;
#endif
#ifdef USE_SHEEN
  vec3 keyLightSheenBefore = sheenSpecularDirect;
#endif
`;

const AFTER_DIRECTIONAL = /* glsl */ `
reflectedLight.directSpecular = mix( reflectedLight.directSpecular, keyLightSpecularBefore, keyLightSpecularDim.x );
#ifdef USE_CLEARCOAT
  clearcoatSpecularDirect = mix( clearcoatSpecularDirect, keyLightClearcoatBefore, keyLightSpecularDim.x );
#endif
#ifdef USE_SHEEN
  sheenSpecularDirect = mix( sheenSpecularDirect, keyLightSheenBefore, keyLightSpecularDim.x );
#endif
`;

/**
 * Wraps the directional-light loop of `lights_fragment_begin` so the specular
 * it adds can be scaled back, leaving diffuse light and the point and spot
 * lights (the player's headlights) untouched.
 */
export function createKeyLightGlintChunk(source: string): string {
  const start = source.indexOf(DIRECTIONAL_LIGHTS);
  const loopEnd = start < 0 ? -1 : source.indexOf(LOOP_END, start);
  const blockEnd = loopEnd < 0 ? -1 : source.indexOf('#endif', loopEnd);
  if (blockEnd < 0) throw new Error('The directional light shader chunk could not be extended.');
  const end = blockEnd + '#endif'.length;
  return (
    source.slice(0, start) +
    BEFORE_DIRECTIONAL +
    source.slice(start, end) +
    AFTER_DIRECTIONAL +
    source.slice(end)
  );
}

let installed = false;

/** Lets `setKeyLightGlint` dim the key light's reflection on every lit material. Idempotent. */
export function installKeyLightGlintControl(): void {
  if (installed) return;
  THREE.ShaderChunk.lights_fragment_begin = createKeyLightGlintChunk(
    THREE.ShaderChunk.lights_fragment_begin,
  );
  THREE.ShaderChunk.lights_pars_begin = `uniform vec2 keyLightSpecularDim;\n${THREE.ShaderChunk.lights_pars_begin}`;
  for (const shader of Object.values(THREE.ShaderLib)) {
    if (!('directionalLights' in shader.uniforms)) continue;
    shader.uniforms.keyLightSpecularDim = { value: keyLightSpecularDim };
  }
  installed = true;
}

/** Keeps `glint` (0 to 1) of the key light's specular reflection; 1 is physically unaltered. */
export function setKeyLightGlint(glint: number): void {
  keyLightSpecularDim[0] = 1 - THREE.MathUtils.clamp(glint, 0, 1);
}
