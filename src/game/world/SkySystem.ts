import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { ATMOSPHERE } from './atmosphere';

const CLOUD_GLSL = /* glsl */ `
uniform float cloudTime;
uniform float cloudCoverage;
uniform float skyExposure;
uniform float environmentMode;
uniform vec3 hazeColor;
uniform vec3 hazeSunColor;
uniform vec3 groundColor;

float skyHash( vec2 p ) {
  p = fract( p * vec2( 123.34, 456.21 ) );
  p += dot( p, p + 45.32 );
  return fract( p.x * p.y );
}

float skyNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( skyHash( i ), skyHash( i + vec2( 1.0, 0.0 ) ), u.x ),
    mix( skyHash( i + vec2( 0.0, 1.0 ) ), skyHash( i + vec2( 1.0, 1.0 ) ), u.x ),
    u.y
  );
}

float skyFbm( vec2 p ) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 rotation = mat2( 0.8, -0.6, 0.6, 0.8 );
  for ( int octave = 0; octave < 5; octave++ ) {
    value += amplitude * skyNoise( p );
    p = rotation * p * 2.03 + 11.7;
    amplitude *= 0.5;
  }
  return value;
}
`;

const SKY_COMPOSITE = /* glsl */ `
  vec3 skyColor = retColor * skyExposure;
  float sunCos = dot( direction, vSunDirection );

  // Soft glow around the solar disc (removed from the reflection bake).
  skyColor += vec3( 1.0, 0.86, 0.66 ) * pow( max( sunCos, 0.0 ), 180.0 ) * 1.6 * ( 1.0 - environmentMode );

  // Drifting cumulus layer projected onto a virtual plane above the camera.
  if ( direction.y > 0.0 ) {
    vec2 cloudUv = direction.xz / ( direction.y + 0.09 ) * 0.62;
    cloudUv += vec2( cloudTime * 0.0045, cloudTime * 0.0018 );
    float shape = skyFbm( cloudUv * 1.9 );
    float detail = skyFbm( cloudUv * 5.3 + 3.7 );
    // Fractal noise averages ~0.5 with a small spread, so a threshold just
    // above the mean and a narrow edge yield distinct fair-weather cumulus.
    float density = smoothstep( cloudCoverage, cloudCoverage + 0.11, shape * 0.8 + detail * 0.26 );
    float horizonFade = smoothstep( 0.01, 0.12, direction.y );
    // Thicker cores are darker underneath; edges facing the sun glow.
    float thickness = smoothstep( cloudCoverage - 0.05, cloudCoverage + 0.2, shape );
    float silver = pow( max( sunCos, 0.0 ), 6.0 );
    vec3 cloudLit = vec3( 1.0, 0.97, 0.92 ) * ( 0.92 + 0.75 * silver );
    vec3 cloudShade = vec3( 0.42, 0.47, 0.56 );
    vec3 cloudColor = mix( cloudLit, cloudShade, thickness * 0.75 ) * mix( 0.72, 1.05, detail );
    skyColor = mix( skyColor, cloudColor * 0.92, density * horizonFade * 0.94 );
  }

  // Horizon haze matches the aerial-perspective fog so terrain melts into the sky.
  float haze = 1.0 - smoothstep( -0.01, 0.085, direction.y );
  vec3 hazeTint = mix( hazeColor, hazeSunColor, pow( max( sunCos, 0.0 ), 7.0 ) );
  skyColor = mix( skyColor, hazeTint, haze * 0.88 );

  // Below the horizon the environment map sees the valley floor.
  skyColor = mix( skyColor, groundColor, smoothstep( 0.0, -0.1, direction.y ) * environmentMode );

  gl_FragColor = vec4( skyColor, 1.0 );
`;

/**
 * A physically based (Preetham) sky extended with procedural clouds and a
 * horizon haze band. It renders as the backdrop and bakes the PMREM
 * environment that lights and reflects every PBR material.
 */
export class SkySystem {
  readonly mesh: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>;
  private environmentTarget?: THREE.WebGLRenderTarget;

  constructor() {
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), SkySystem.createMaterial(0));
    this.mesh.scale.setScalar(1000);
    this.mesh.frustumCulled = false;
    // The vertex shader pins the sky to the far plane. Drawing it after the
    // other opaque geometry lets the depth test skip every pixel the terrain
    // already covers, so the cloud shader runs only where sky is visible.
    this.mesh.renderOrder = 10;
    this.mesh.name = 'sky';
  }

  private static createMaterial(environmentMode: number): THREE.ShaderMaterial {
    // @types/three declares SkyShader as `object`; its runtime shape is a ShaderMaterial definition.
    const shader = Sky.SkyShader as unknown as {
      uniforms: Record<string, THREE.IUniform>;
      vertexShader: string;
      fragmentShader: string;
    };
    const uniforms = THREE.UniformsUtils.merge([
      shader.uniforms,
      {
        cloudTime: { value: 0 },
        cloudCoverage: { value: 0.545 },
        skyExposure: { value: 0.46 },
        environmentMode: { value: environmentMode },
        hazeColor: { value: ATMOSPHERE.fogColor.clone() },
        hazeSunColor: { value: ATMOSPHERE.sunScatterColor.clone() },
        groundColor: { value: ATMOSPHERE.groundColor.clone() },
      },
    ]);
    uniforms.turbidity.value = 2.4;
    uniforms.rayleigh.value = 2.3;
    uniforms.mieCoefficient.value = 0.0032;
    uniforms.mieDirectionalG.value = 0.8;
    uniforms.sunPosition.value.copy(ATMOSPHERE.sunDirection);

    const fragmentShader = shader.fragmentShader
      .replace('uniform vec3 up;', `uniform vec3 up;\n${CLOUD_GLSL}`)
      .replace('gl_FragColor = vec4( retColor, 1.0 );', SKY_COMPOSITE);
    if (!fragmentShader.includes('cloudCoverage, cloudCoverage')) {
      throw new Error('The sky shader could not be extended.');
    }
    return new THREE.ShaderMaterial({
      name: 'DriftlineSky',
      uniforms,
      vertexShader: shader.vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
    });
  }

  /** Bakes the sky (without the sun disc) into a prefiltered environment map. */
  createEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(this.mesh.geometry, SkySystem.createMaterial(1));
    envSky.scale.setScalar(100);
    envScene.add(envSky);
    this.environmentTarget?.dispose();
    this.environmentTarget = pmrem.fromScene(envScene, 0.02, 0.1, 400);
    envSky.material.dispose();
    pmrem.dispose();
    return this.environmentTarget.texture;
  }

  update(camera: THREE.Camera, elapsedSeconds: number): void {
    this.mesh.position.copy(camera.position);
    this.mesh.material.uniforms.cloudTime.value = elapsedSeconds;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.environmentTarget?.dispose();
  }
}
