import type * as THREE from 'three';

const GROUND_NOISE = /* glsl */ `
varying vec3 vGroundWorld;

float groundHash( vec2 p ) {
  p = fract( p * vec2( 233.34, 851.73 ) );
  p += dot( p, p + 23.45 );
  return fract( p.x * p.y );
}

float groundNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( groundHash( i ), groundHash( i + vec2( 1.0, 0.0 ) ), u.x ),
    mix( groundHash( i + vec2( 0.0, 1.0 ) ), groundHash( i + vec2( 1.0, 1.0 ) ), u.x ),
    u.y
  );
}

float groundFbm( vec2 p ) {
  float value = 0.0;
  float amplitude = 0.5;
  for ( int octave = 0; octave < 4; octave++ ) {
    value += amplitude * groundNoise( p );
    p = p * 2.07 + 17.3;
    amplitude *= 0.5;
  }
  return value;
}
`;

/**
 * Breaks up visible texture tiling on the valley floor with world-space
 * macro variation: lush and sun-dried meadow patches, plus darker damp hollows.
 */
export function applyGroundVariation(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundWorld;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvGroundWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GROUND_NOISE}`)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
  float groundMacro = groundFbm( vGroundWorld.xz * 0.011 );
  float groundPatch = groundFbm( vGroundWorld.xz * 0.05 + 7.0 );
  vec3 lushMeadow = vec3( 0.92, 1.08, 0.78 );
  vec3 dryMeadow = vec3( 1.1, 0.98, 0.68 );
  vec3 meadow = mix( lushMeadow, dryMeadow, smoothstep( 0.4, 0.68, groundMacro ) );
  diffuseColor.rgb *= meadow * ( 0.84 + 0.32 * groundPatch );`,
      );
  };
  material.customProgramCacheKey = () => 'driftline-ground-variation';
  material.needsUpdate = true;
}
