import * as THREE from 'three';

/**
 * The game's tone mapping: the ACES filmic curve, then colour won back.
 * ACES rolls bright colours off toward grey, which leaves meadows, sky and
 * car paint looking washed out. Saturation lifts every colour; vibrance lifts
 * dull colours most and already vivid ones least, so nothing clips.
 */
export const TONE_SATURATION = 1.12;
export const TONE_VIBRANCE = 0.32;

const PLACEHOLDER = 'vec3 CustomToneMapping( vec3 color ) { return color; }';

const glslFloat = (value: number): string => {
  const text = value.toFixed(4);
  return text.includes('.') ? text : `${text}.0`;
};

/** Replaces three.js' empty custom tone mapping with the vivid filmic curve. */
export function createVividToneMappingChunk(source: string): string {
  if (!source.includes(PLACEHOLDER)) {
    throw new Error('The tone mapping shader chunk could not be extended.');
  }
  return source.replace(
    PLACEHOLDER,
    /* glsl */ `vec3 CustomToneMapping( vec3 color ) {
  color = ACESFilmicToneMapping( color );
  float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  float chroma = max( color.r, max( color.g, color.b ) ) - min( color.r, min( color.g, color.b ) );
  float boost = ${glslFloat(TONE_SATURATION)} + ${glslFloat(TONE_VIBRANCE)} * ( 1.0 - saturate( chroma ) );
  return saturate( mix( vec3( luma ), color, boost ) );
}`,
  );
}

let installed = false;

/**
 * Installs the vivid curve as three.js' custom tone mapping. Must run before
 * any material compiles; renderers then select it with `CustomToneMapping`,
 * which both direct rendering and the post-processing output pass honour.
 * Idempotent.
 */
export function installVividToneMapping(): void {
  if (installed) return;
  THREE.ShaderChunk.tonemapping_pars_fragment = createVividToneMappingChunk(
    THREE.ShaderChunk.tonemapping_pars_fragment,
  );
  installed = true;
}

/** The tone mapping renderers should use once `installVividToneMapping` has run. */
export const VIVID_TONE_MAPPING = THREE.CustomToneMapping;
