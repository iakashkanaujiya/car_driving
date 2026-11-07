import * as THREE from 'three';

/**
 * Additive glow sprites for lamps (car lights, street lights). Each point
 * carries an HDR colour (`aColor`) and a world-space size (`aSize`); sizes
 * shrink with distance like real objects and feed the bloom when it is on.
 */
const GLOW_VERTEX = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
uniform float uViewportHeight;
varying vec3 vColor;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  float pixels = aSize * projectionMatrix[ 1 ][ 1 ] * uViewportHeight * 0.5 / max( -mvPosition.z, 0.5 );
  gl_PointSize = clamp( pixels, 2.0, 256.0 );
  // Sub-pixel lamps keep their energy instead of shimmering in and out.
  vColor = aColor * min( 1.0, pixels / 2.0 );
}
`;

const GLOW_FRAGMENT = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 offset = gl_PointCoord * 2.0 - 1.0;
  float radius2 = dot( offset, offset );
  if ( radius2 > 1.0 ) discard;
  float core = exp( -radius2 * 26.0 );
  float halo = exp( -radius2 * 4.5 ) * 0.2 * ( 1.0 - radius2 );
  gl_FragColor = vec4( vColor * ( core + halo ), 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Material for a `THREE.Points` of lamp glows; set `uViewportHeight` each frame. */
export function createLampGlowMaterial(name: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    uniforms: { uViewportHeight: { value: 1 } },
    vertexShader: GLOW_VERTEX,
    fragmentShader: GLOW_FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}
