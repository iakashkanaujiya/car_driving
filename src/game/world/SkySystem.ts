import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { createEnvironmentLook, DEFAULT_CONDITIONS } from './conditions';
import type { EnvironmentLook } from './conditions';

const CLOUD_GLSL = /* glsl */ `
uniform float cloudTime;
uniform float cloudCoverage;
uniform float cloudOpacity;
uniform vec3 cloudLitColor;
uniform vec3 cloudShadeColor;
uniform float skyExposure;
uniform float environmentMode;
uniform float discVisibility;
uniform vec3 sunGlowColor;
uniform vec3 lightDirection;
uniform vec3 hazeColor;
uniform vec3 hazeSunColor;
uniform float hazeHeight;
uniform float hazeStrength;
uniform vec3 groundColor;
uniform float nightAmount;
uniform float starAmount;
uniform vec3 nightZenithColor;
uniform vec3 nightHorizonColor;

float skyHash( vec2 p ) {
  p = fract( p * vec2( 123.34, 456.21 ) );
  p += dot( p, p + 45.32 );
  return fract( p.x * p.y );
}

float starHash( vec3 p ) {
  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yxz + 33.33 );
  return fract( ( p.x + p.y ) * p.z );
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
  float lightCos = dot( direction, lightDirection );
  float liveSky = 1.0 - environmentMode;

  // Soft glow around the solar disc (removed from the reflection bake).
  skyColor += sunGlowColor * pow( max( sunCos, 0.0 ), 180.0 ) * 1.6 * discVisibility * liveSky;

  if ( nightAmount > 0.0 ) {
    float altitude = max( direction.y, 0.0 );
    skyColor += mix( nightHorizonColor, nightZenithColor, sqrt( altitude ) ) * nightAmount;

    // Stars: at most one per cell of a lattice wrapped around the view sphere.
    vec3 starPoint = direction * 280.0;
    vec3 starCell = floor( starPoint );
    float starSeed = starHash( starCell );
    if ( starSeed > 0.986 && direction.y > 0.0 ) {
      vec3 starJitter = vec3( starHash( starCell + 17.0 ), starHash( starCell + 31.0 ), starHash( starCell + 47.0 ) );
      float starDistance = length( starPoint - starCell - 0.25 - starJitter * 0.5 );
      float starBrightness = ( starSeed - 0.986 ) / 0.014;
      float twinkle = 0.75 + 0.25 * sin( cloudTime * ( 1.5 + starSeed * 3.0 ) + starBrightness * 40.0 );
      skyColor += vec3( 0.86, 0.9, 1.0 ) * smoothstep( 0.34, 0.0, starDistance ) *
        ( 0.3 + 2.4 * starBrightness * starBrightness ) * twinkle * starAmount * liveSky *
        smoothstep( 0.02, 0.15, direction.y );
    }

    // The moon: a mottled disc with a soft halo, drawn where the key light is.
    float moonDistance = length( direction - lightDirection );
    float moonDisc = 1.0 - smoothstep( 0.0125, 0.0145, moonDistance );
    float maria = skyFbm( ( direction.xz - lightDirection.xz ) * 170.0 + 4.0 );
    vec3 moonColor = vec3( 1.0, 0.96, 0.88 ) * mix( 0.6, 1.0, smoothstep( 0.35, 0.65, maria ) ) * 2.6;
    skyColor = mix( skyColor, moonColor, moonDisc * discVisibility * nightAmount * liveSky );
    // The tight glow stays out of the reflection bake so paint does not mirror
    // a bright moon; the wide halo still tints reflections.
    float moonCos = max( lightCos, 0.0 );
    skyColor += vec3( 0.55, 0.62, 0.8 ) * ( pow( moonCos, 2200.0 ) * 0.5 * liveSky + pow( moonCos, 60.0 ) * 0.06 ) *
      discVisibility * nightAmount;
  }

  // Drifting cumulus layer projected onto a virtual plane above the camera.
  if ( direction.y > 0.0 ) {
    vec2 cloudUv = direction.xz / ( direction.y + 0.09 ) * 0.62;
    cloudUv += vec2( cloudTime * 0.0045, cloudTime * 0.0018 );
    float shape = skyFbm( cloudUv * 1.9 );
    float detail = skyFbm( cloudUv * 5.3 + 3.7 );
    // Fractal noise averages ~0.5 with a small spread, so a threshold just
    // above the mean and a narrow edge yield distinct fair-weather cumulus;
    // a low threshold closes the gaps into an overcast deck.
    float density = smoothstep( cloudCoverage, cloudCoverage + 0.11, shape * 0.8 + detail * 0.26 );
    float horizonFade = smoothstep( 0.01, 0.12, direction.y );
    // Thicker cores are darker underneath; edges facing the light glow.
    float thickness = smoothstep( cloudCoverage - 0.05, cloudCoverage + 0.2, shape );
    float silver = pow( max( lightCos, 0.0 ), 6.0 ) * discVisibility;
    vec3 cloudLit = cloudLitColor * ( 0.92 + 0.75 * silver );
    vec3 cloudColor = mix( cloudLit, cloudShadeColor, thickness * 0.75 ) * mix( 0.72, 1.05, detail );
    skyColor = mix( skyColor, cloudColor * 0.92, density * horizonFade * cloudOpacity );
  }

  // Horizon haze matches the aerial-perspective fog so terrain melts into the sky.
  float haze = 1.0 - smoothstep( -0.01, hazeHeight, direction.y );
  vec3 hazeTint = mix( hazeColor, hazeSunColor, pow( max( lightCos, 0.0 ), 7.0 ) );
  skyColor = mix( skyColor, hazeTint, haze * hazeStrength );

  // Below the horizon the environment map sees the valley floor.
  skyColor = mix( skyColor, groundColor, smoothstep( 0.0, -0.1, direction.y ) * environmentMode );

  gl_FragColor = vec4( skyColor, 1.0 );
`;

/** Copies one look into a sky material's uniforms. */
function applyLookUniforms(material: THREE.ShaderMaterial, look: EnvironmentLook): void {
  const uniforms = material.uniforms;
  const { sky } = look;
  uniforms.turbidity.value = sky.turbidity;
  uniforms.rayleigh.value = sky.rayleigh;
  uniforms.mieCoefficient.value = sky.mieCoefficient;
  uniforms.mieDirectionalG.value = sky.mieDirectionalG;
  uniforms.sunPosition.value.copy(sky.sunDirection);
  uniforms.skyExposure.value = sky.exposure;
  uniforms.discVisibility.value = sky.discVisibility;
  uniforms.sunGlowColor.value.copy(sky.sunGlowColor);
  uniforms.lightDirection.value.copy(look.lightDirection);
  uniforms.cloudCoverage.value = sky.cloudCoverage;
  uniforms.cloudOpacity.value = sky.cloudOpacity;
  uniforms.cloudLitColor.value.copy(sky.cloudLitColor);
  uniforms.cloudShadeColor.value.copy(sky.cloudShadeColor);
  uniforms.hazeColor.value.copy(look.fogColor);
  uniforms.hazeSunColor.value.copy(look.scatterColor);
  uniforms.hazeHeight.value = sky.hazeHeight;
  uniforms.hazeStrength.value = sky.hazeStrength;
  uniforms.groundColor.value.copy(look.groundColor);
  uniforms.nightAmount.value = sky.night;
  uniforms.starAmount.value = sky.stars;
  uniforms.nightZenithColor.value.copy(sky.nightZenithColor);
  uniforms.nightHorizonColor.value.copy(sky.nightHorizonColor);
}

/**
 * A physically based (Preetham) sky extended with procedural clouds, a night
 * sky with stars and a moon, and a horizon haze band. It renders as the
 * backdrop and bakes the PMREM environment that lights and reflects every
 * PBR material.
 */
export class SkySystem {
  readonly mesh: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>;
  private environmentTarget?: THREE.WebGLRenderTarget;
  private look = createEnvironmentLook(DEFAULT_CONDITIONS);

  constructor() {
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), SkySystem.createMaterial(0));
    applyLookUniforms(this.mesh.material, this.look);
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
        cloudCoverage: { value: 0 },
        cloudOpacity: { value: 0 },
        cloudLitColor: { value: new THREE.Color() },
        cloudShadeColor: { value: new THREE.Color() },
        skyExposure: { value: 0 },
        environmentMode: { value: environmentMode },
        discVisibility: { value: 1 },
        sunGlowColor: { value: new THREE.Color() },
        lightDirection: { value: new THREE.Vector3(0, 1, 0) },
        hazeColor: { value: new THREE.Color() },
        hazeSunColor: { value: new THREE.Color() },
        hazeHeight: { value: 0.085 },
        hazeStrength: { value: 0 },
        groundColor: { value: new THREE.Color() },
        nightAmount: { value: 0 },
        starAmount: { value: 0 },
        nightZenithColor: { value: new THREE.Color() },
        nightHorizonColor: { value: new THREE.Color() },
      },
    ]);

    const sunDisc = 'L0 += ( vSunE * 19000.0 * Fex ) * sundisk;';
    const fragmentShader = shader.fragmentShader
      .replace('uniform vec3 up;', `uniform vec3 up;\n${CLOUD_GLSL}`)
      .replace(sunDisc, 'L0 += ( vSunE * 19000.0 * Fex ) * sundisk * discVisibility;')
      .replace('gl_FragColor = vec4( retColor, 1.0 );', SKY_COMPOSITE);
    if (
      !fragmentShader.includes('cloudCoverage, cloudCoverage') ||
      !fragmentShader.includes('sundisk * discVisibility')
    ) {
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

  /** Switches the sky to a new time of day and weather. Re-bake the environment afterwards. */
  setLook(look: EnvironmentLook): void {
    this.look = look;
    applyLookUniforms(this.mesh.material, look);
  }

  /** Bakes the sky (without the sun disc or stars) into a prefiltered environment map. */
  createEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(this.mesh.geometry, SkySystem.createMaterial(1));
    applyLookUniforms(envSky.material, this.look);
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
