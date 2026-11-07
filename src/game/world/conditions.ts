import * as THREE from 'three';
import type { DrivingConditions, Weather } from '../conditionsCatalog';
import { ATMOSPHERE } from './atmosphere';

export {
  DEFAULT_CONDITIONS,
  isTimeOfDay,
  isWeather,
  TIME_OF_DAY_OPTIONS,
  WEATHER_OPTIONS,
} from '../conditionsCatalog';
export type { DrivingConditions, TimeOfDay, Weather } from '../conditionsCatalog';

export interface SkyLook {
  /** Direction toward the sun for the Preetham sky; below the horizon at night. */
  sunDirection: THREE.Vector3;
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  exposure: number;
  /** Visibility of the sun or moon disc and its glow; clouds hide it. */
  discVisibility: number;
  sunGlowColor: THREE.Color;
  /** Noise threshold for clouds: lower values cover more of the sky. */
  cloudCoverage: number;
  cloudOpacity: number;
  cloudLitColor: THREE.Color;
  cloudShadeColor: THREE.Color;
  /** Height (direction.y) up to which the horizon haze reaches. */
  hazeHeight: number;
  hazeStrength: number;
  /** Night gradient and moon (0 by day). */
  night: number;
  stars: number;
  nightZenithColor: THREE.Color;
  nightHorizonColor: THREE.Color;
}

/**
 * Every value the scene needs to render one time of day and weather. The sky,
 * key light, shadows and fog all read the same light direction so the moon or
 * sun always agrees with the shading.
 */
export interface EnvironmentLook {
  conditions: DrivingConditions;
  /** Toward the key light: the sun by day, the moon at night. */
  lightDirection: THREE.Vector3;
  lightColor: THREE.Color;
  lightIntensity: number;
  /** Off under a full cloud deck, where there is no direct light to cast them. */
  castShadows: boolean;
  /**
   * Share of the key light's mirror-like reflection kept on glossy surfaces.
   * Full-strength sun glints blow out on car paint under bloom, and the moon
   * lights the valley but barely glints at all.
   */
  keyLightGlint: number;
  hemisphereSkyColor: THREE.Color;
  hemisphereGroundColor: THREE.Color;
  hemisphereIntensity: number;
  environmentIntensity: number;
  exposure: number;
  fogColor: THREE.Color;
  /** Haze colour looking toward the key light. */
  scatterColor: THREE.Color;
  fogDensity: number;
  /** Colour reflected from below the horizon in the environment map. */
  groundColor: THREE.Color;
  sky: SkyLook;
  /** 0 when vehicles drive without lights, 1 in full darkness. */
  vehicleLights: number;
  /** Strength of the player's headlight beam on the road. */
  headlightIntensity: number;
  /** Rainfall, 0 to 1. */
  rain: number;
  rainColor: THREE.Color;
  /** How wet and glossy the road looks, 0 to 1. */
  wetness: number;
}

function dayLook(conditions: DrivingConditions): EnvironmentLook {
  return {
    conditions,
    lightDirection: ATMOSPHERE.sunDirection.clone(),
    lightColor: ATMOSPHERE.sunColor.clone(),
    lightIntensity: ATMOSPHERE.sunIntensity,
    castShadows: true,
    keyLightGlint: 0.45,
    hemisphereSkyColor: new THREE.Color(0xcfe3f2),
    hemisphereGroundColor: new THREE.Color(0x3c4a2e),
    hemisphereIntensity: 0.3,
    environmentIntensity: 0.75,
    exposure: 1,
    fogColor: ATMOSPHERE.fogColor.clone(),
    scatterColor: ATMOSPHERE.sunScatterColor.clone(),
    fogDensity: ATMOSPHERE.fogDensity,
    groundColor: ATMOSPHERE.groundColor.clone(),
    sky: {
      sunDirection: ATMOSPHERE.sunDirection.clone(),
      turbidity: 2.4,
      rayleigh: 2.3,
      mieCoefficient: 0.0032,
      mieDirectionalG: 0.8,
      exposure: 0.46,
      discVisibility: 1,
      sunGlowColor: new THREE.Color(1, 0.86, 0.66),
      cloudCoverage: 0.545,
      cloudOpacity: 0.94,
      cloudLitColor: new THREE.Color(1, 0.97, 0.92),
      cloudShadeColor: new THREE.Color(0.42, 0.47, 0.56),
      hazeHeight: 0.085,
      hazeStrength: 0.88,
      night: 0,
      stars: 0,
      nightZenithColor: new THREE.Color(0x000000),
      nightHorizonColor: new THREE.Color(0x000000),
    },
    vehicleLights: 0,
    headlightIntensity: 0,
    rain: 0,
    rainColor: new THREE.Color(0.72, 0.77, 0.84),
    wetness: 0,
  };
}

function eveningLook(conditions: DrivingConditions): EnvironmentLook {
  const look = dayLook(conditions);
  // A low sun ahead of the road: the player drives into the sunset.
  const sun = new THREE.Vector3(-0.36, 0.105, -0.93).normalize();
  look.lightDirection.copy(sun);
  look.lightColor.setHex(0xffa25e);
  look.lightIntensity = 3.2;
  // A low sun glints hardest: paint reflects most at grazing angles.
  look.keyLightGlint = 0.35;
  look.hemisphereSkyColor.setHex(0xb9b3d6);
  look.hemisphereGroundColor.setHex(0x3d382a);
  look.hemisphereIntensity = 0.3;
  look.environmentIntensity = 0.85;
  look.exposure = 1.05;
  look.fogColor.setHex(0x84809c);
  look.scatterColor.setHex(0xffa055);
  look.fogDensity = 0.00115;
  look.groundColor.setHex(0x3a3629);
  Object.assign(look.sky, {
    turbidity: 6,
    rayleigh: 3.1,
    mieCoefficient: 0.0052,
    mieDirectionalG: 0.86,
    exposure: 1,
    cloudCoverage: 0.565,
  });
  look.sky.sunDirection.copy(sun);
  look.sky.sunGlowColor.setRGB(1, 0.6, 0.3);
  look.sky.cloudLitColor.setRGB(1, 0.72, 0.5);
  look.sky.cloudShadeColor.setRGB(0.4, 0.34, 0.42);
  look.vehicleLights = 0.55;
  look.headlightIntensity = 0.45;
  look.rainColor.setRGB(0.66, 0.64, 0.68);
  return look;
}

function nightLook(conditions: DrivingConditions): EnvironmentLook {
  const look = dayLook(conditions);
  // A bright moon ahead and to the right, low enough to see: the valley stays
  // readable in cool moonlight and headlights add warm pools on top.
  look.lightDirection.set(0.46, 0.25, -0.85).normalize();
  look.lightColor.setHex(0xa8bcf0);
  look.lightIntensity = 1.4;
  look.keyLightGlint = 0.1;
  look.hemisphereSkyColor.setHex(0x5468a0);
  look.hemisphereGroundColor.setHex(0x1a2218);
  look.hemisphereIntensity = 0.7;
  look.environmentIntensity = 1.25;
  look.exposure = 1.32;
  look.fogColor.setHex(0x1a2740);
  look.scatterColor.setHex(0x5a6e94);
  look.fogDensity = 0.0011;
  look.groundColor.setHex(0x161c14);
  Object.assign(look.sky, {
    turbidity: 2,
    rayleigh: 1,
    mieCoefficient: 0.003,
    mieDirectionalG: 0.8,
    exposure: 0.46,
    cloudCoverage: 0.6,
    cloudOpacity: 0.9,
    hazeHeight: 0.09,
    hazeStrength: 0.9,
    night: 1,
    stars: 1,
  });
  // The sun sits far below the horizon, so the physical sky goes dark.
  look.sky.sunDirection.set(0.3, -0.35, 0.89).normalize();
  look.sky.sunGlowColor.setRGB(0, 0, 0);
  look.sky.cloudLitColor.setRGB(0.26, 0.29, 0.37);
  look.sky.cloudShadeColor.setRGB(0.06, 0.07, 0.09);
  look.sky.nightZenithColor.setHex(0x050a1a);
  look.sky.nightHorizonColor.copy(look.fogColor);
  look.vehicleLights = 1;
  look.headlightIntensity = 1;
  look.rainColor.setRGB(0.1, 0.11, 0.14);
  return look;
}

const luminance = (color: THREE.Color): number =>
  color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;

/** Moves a colour toward its own grey by `amount`, then scales it. */
function desaturate(color: THREE.Color, amount: number, scale = 1): THREE.Color {
  const grey = luminance(color);
  return color.lerp(new THREE.Color(grey, grey, grey), amount).multiplyScalar(scale);
}

function applyWeather(look: EnvironmentLook, weather: Weather): EnvironmentLook {
  const { sky } = look;
  if (weather === 'cloudy') {
    look.lightIntensity *= 0.55;
    look.hemisphereIntensity *= 1.35;
    look.fogDensity *= 1.5;
    desaturate(look.fogColor, 0.3);
    look.scatterColor.lerp(look.fogColor, 0.4);
    sky.discVisibility = 0.35;
    sky.cloudCoverage = 0.44;
    sky.cloudOpacity = 0.97;
    sky.stars *= 0.5;
    sky.hazeHeight = 0.11;
    desaturate(sky.cloudLitColor, 0.35, 0.92);
    sky.cloudShadeColor.multiplyScalar(0.85);
  } else if (weather === 'rain') {
    // The cloud deck hides the sun or moon. Any direct light would leave a
    // mirror-sharp highlight on the wet road of a light nobody can see.
    look.lightIntensity = 0;
    look.castShadows = false;
    look.hemisphereIntensity *= 2.1;
    look.environmentIntensity *= 1.2;
    look.exposure *= 0.97;
    look.fogDensity *= 2.8;
    desaturate(look.fogColor, 0.75, 0.8);
    look.scatterColor.lerp(look.fogColor, 0.94);
    look.groundColor.multiplyScalar(0.8);
    sky.discVisibility = 0;
    sky.cloudCoverage = 0.18;
    sky.cloudOpacity = 1;
    sky.stars = 0;
    sky.hazeHeight = 0.22;
    sky.hazeStrength = 0.96;
    const lit = luminance(sky.cloudLitColor) * 0.5;
    const shade = luminance(sky.cloudShadeColor) * 0.6;
    sky.cloudLitColor.setRGB(lit * 0.97, lit, lit * 1.04);
    sky.cloudShadeColor.setRGB(shade * 0.95, shade, shade * 1.06);
    look.rain = 1;
    look.wetness = 1;
    look.vehicleLights = Math.max(look.vehicleLights, 0.35);
    look.headlightIntensity = Math.max(look.headlightIntensity, 0.35);
  } else if (weather === 'fog') {
    look.lightIntensity *= 0.25;
    look.hemisphereIntensity *= 1.5;
    look.fogDensity *= 8.5;
    desaturate(look.fogColor, 0.7, 1.06);
    look.scatterColor.lerp(look.fogColor, 0.65);
    sky.discVisibility *= 0.2;
    sky.cloudCoverage = 0.3;
    sky.cloudOpacity = 1;
    sky.stars = 0;
    sky.hazeHeight = 0.5;
    sky.hazeStrength = 1;
    sky.cloudLitColor.lerp(look.fogColor, 0.5);
    sky.cloudShadeColor.lerp(look.fogColor, 0.5);
    look.wetness = 0.3;
    look.vehicleLights = Math.max(look.vehicleLights, 0.4);
    look.headlightIntensity = Math.max(look.headlightIntensity, 0.4);
  }
  // The night gradient meets the haze colour so the horizon stays seamless.
  if (sky.night > 0) sky.nightHorizonColor.copy(look.fogColor);
  return look;
}

/** Builds a fresh, independently mutable look for the given conditions. */
export function createEnvironmentLook(conditions: DrivingConditions): EnvironmentLook {
  const copy = { ...conditions };
  const base =
    conditions.timeOfDay === 'evening'
      ? eveningLook(copy)
      : conditions.timeOfDay === 'night'
        ? nightLook(copy)
        : dayLook(copy);
  return applyWeather(base, conditions.weather);
}
