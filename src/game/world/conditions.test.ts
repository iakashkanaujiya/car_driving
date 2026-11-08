import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ATMOSPHERE } from './atmosphere';
import {
  createEnvironmentLook,
  DEFAULT_CONDITIONS,
  isTimeOfDay,
  isWeather,
  TIME_OF_DAY_OPTIONS,
  WEATHER_OPTIONS,
} from './conditions';
import type { DrivingConditions } from './conditions';
import { createRainGeometry } from './RainSystem';
import { createPoolTexture, VehicleLightSystem } from './VehicleLightSystem';

const look = (timeOfDay: DrivingConditions['timeOfDay'], weather: DrivingConditions['weather']) =>
  createEnvironmentLook({ timeOfDay, weather });

describe('driving conditions', () => {
  it('keeps the original clear-day look as the default', () => {
    const day = createEnvironmentLook(DEFAULT_CONDITIONS);
    expect(day.lightDirection.angleTo(ATMOSPHERE.sunDirection)).toBeLessThan(1e-9);
    expect(day.fogColor.getHex()).toBe(ATMOSPHERE.fogColor.getHex());
    expect(day.fogDensity).toBe(ATMOSPHERE.fogDensity);
    expect(day.lightIntensity).toBe(ATMOSPHERE.sunIntensity);
    expect(day.vehicleLights).toBe(0);
    expect(day.rain).toBe(0);
  });

  it('validates option ids from storage', () => {
    for (const { id } of TIME_OF_DAY_OPTIONS) expect(isTimeOfDay(id)).toBe(true);
    for (const { id } of WEATHER_OPTIONS) expect(isWeather(id)).toBe(true);
    expect(isTimeOfDay('dawn')).toBe(false);
    expect(isWeather(null)).toBe(false);
  });

  it('builds a usable look for every combination', () => {
    for (const { id: timeOfDay } of TIME_OF_DAY_OPTIONS) {
      for (const { id: weather } of WEATHER_OPTIONS) {
        const current = look(timeOfDay, weather);
        expect(current.conditions).toEqual({ timeOfDay, weather });
        expect(current.lightDirection.length()).toBeCloseTo(1, 6);
        expect(current.lightDirection.y).toBeGreaterThan(0.05);
        expect(current.lightIntensity).toBeGreaterThanOrEqual(0);
        expect(current.castShadows).toBe(current.lightIntensity > 0);
        expect(current.fogDensity).toBeGreaterThan(0);
        expect(current.exposure).toBeGreaterThan(0.8);
        for (const color of [current.fogColor, current.lightColor, current.sky.cloudLitColor]) {
          expect(Number.isFinite(color.r + color.g + color.b)).toBe(true);
        }
      }
    }
  });

  it('lowers the sun for the evening and swaps it for the moon at night', () => {
    const day = look('day', 'clear');
    const evening = look('evening', 'clear');
    const night = look('night', 'clear');
    expect(evening.lightDirection.y).toBeLessThan(day.lightDirection.y);
    expect(evening.sky.sunDirection.angleTo(evening.lightDirection)).toBeLessThan(1e-9);
    // The physical sky's sun sets; the key light becomes the moon.
    expect(night.sky.sunDirection.y).toBeLessThan(0);
    expect(night.lightDirection.y).toBeGreaterThan(0);
    // A moonlit night: clearly dimmer than day, but never left to headlights alone.
    expect(night.lightIntensity).toBeLessThan(day.lightIntensity * 0.5);
    expect(night.lightIntensity).toBeGreaterThan(day.lightIntensity * 0.3);
    expect(night.sky.night).toBe(1);
    expect(night.sky.stars).toBe(1);
    expect(night.vehicleLights).toBe(1);
    expect(evening.vehicleLights).toBeGreaterThan(0);
    expect(evening.vehicleLights).toBeLessThan(1);
  });

  it('dims and closes in the scene for bad weather', () => {
    const clear = look('day', 'clear');
    const cloudy = look('day', 'cloudy');
    const rain = look('day', 'rain');
    const fog = look('day', 'fog');
    expect(cloudy.lightIntensity).toBeLessThan(clear.lightIntensity);
    expect(rain.lightIntensity).toBe(0);
    expect(rain.hemisphereIntensity).toBeGreaterThan(clear.hemisphereIntensity);
    expect(cloudy.sky.cloudCoverage).toBeLessThan(clear.sky.cloudCoverage);
    expect(rain.sky.cloudCoverage).toBeLessThan(cloudy.sky.cloudCoverage);
    expect(rain.rain).toBe(1);
    expect(rain.wetness).toBe(1);
    expect(fog.fogDensity).toBeGreaterThan(rain.fogDensity);
    expect(fog.sky.hazeHeight).toBeGreaterThan(0.3);
    // Drivers switch their lights on in rain and fog, even by day.
    expect(rain.vehicleLights).toBeGreaterThan(0);
    expect(fog.vehicleLights).toBeGreaterThan(0);
    expect(look('night', 'rain').sky.stars).toBe(0);
  });

  it('greys out the haze in rain and fog', () => {
    const saturation = (color: THREE.Color) => color.getHSL({ h: 0, s: 0, l: 0 }).s;
    const clear = look('day', 'clear');
    expect(saturation(look('day', 'rain').fogColor)).toBeLessThan(saturation(clear.fogColor));
    expect(saturation(look('day', 'fog').fogColor)).toBeLessThan(saturation(clear.fogColor));
  });

  it('returns independent objects that callers may mutate', () => {
    const first = look('night', 'fog');
    first.fogColor.setRGB(1, 0, 0);
    first.lightDirection.set(0, 1, 0);
    const second = look('night', 'fog');
    expect(second.fogColor.getHex()).not.toBe(0xff0000);
    expect(second.lightDirection.y).toBeLessThan(1);
    expect(ATMOSPHERE.fogColor.getHex()).toBe(0x8db4de);
  });
});

describe('rain', () => {
  it('pairs a head and a tail vertex for every streak, deterministically', () => {
    const geometry = createRainGeometry(50, 3);
    const positions = geometry.getAttribute('position').array;
    const tails = geometry.getAttribute('aTail').array;
    expect(positions.length).toBe(50 * 6);
    expect(Array.from(positions)).toEqual(
      Array.from(createRainGeometry(50, 3).getAttribute('position').array),
    );
    for (let streak = 0; streak < 50; streak += 1) {
      expect(positions.slice(streak * 6, streak * 6 + 3)).toEqual(
        positions.slice(streak * 6 + 3, streak * 6 + 6),
      );
      expect([tails[streak * 2], tails[streak * 2 + 1]]).toEqual([0, 1]);
    }
    expect(Math.max(...positions)).toBeLessThan(1);
    expect(Math.min(...positions)).toBeGreaterThanOrEqual(0);
  });
});

describe('vehicle lights', () => {
  const rig = {
    length: 9,
    headlamp: { x: 1.4, y: 1.2, z: -4.4 },
    taillamp: { x: 1.5, y: 1.5, z: 4.4 },
  };

  const carAt = (z: number, heading: number): THREE.Object3D => {
    const car = new THREE.Object3D();
    car.position.set(0, 0, z);
    car.rotation.y = heading;
    return car;
  };

  it('fades the light pool toward its far end and sides', () => {
    const texture = createPoolTexture(16, 32);
    const data = texture.image.data as Uint8Array;
    const at = (x: number, y: number) => data[(y * 16 + x) * 4 + 1];
    expect(at(8, 6)).toBeGreaterThan(at(8, 28));
    expect(at(8, 6)).toBeGreaterThan(at(0, 6));
    expect(at(8, 31)).toBeLessThan(10);
  });

  it('shows oncoming headlights and the tail lights of cars ahead', () => {
    const scene = new THREE.Scene();
    const lights = new VehicleLightSystem(scene);
    lights.setLook(look('night', 'clear'));
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 4, 0);

    expect(lights.beginFrame(camera, 900)).toBe(true);
    // Oncoming: faces +Z toward the camera. Ahead: faces -Z, away from it.
    lights.addVehicle(carAt(-80, Math.PI), rig, false);
    lights.addVehicle(carAt(-40, 0), rig, true);
    lights.endFrame();

    const glows = scene.getObjectByName('vehicle-lamp-glows') as THREE.Points;
    const pools = scene.getObjectByName('vehicle-light-pools') as THREE.InstancedMesh;
    // Two oncoming headlamps and the two braking tail lamps of the car ahead.
    expect(glows.geometry.drawRange.count).toBe(4);
    expect(pools.count).toBe(2);
    const colors = glows.geometry.getAttribute('aColor');
    const reds = Array.from(
      { length: 4 },
      (_, index) => colors.getX(index) > colors.getY(index) * 4,
    );
    expect(reds.filter(Boolean)).toHaveLength(2);
    expect(lights.headlight.visible).toBe(true);
    lights.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('leaves tail lights up close to the real lenses', () => {
    const scene = new THREE.Scene();
    const lights = new VehicleLightSystem(scene);
    lights.setLook(look('night', 'clear'));
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 4, 0);
    lights.beginFrame(camera, 900);
    // Ahead and close: its tail lamps face the camera from about 6 units away.
    lights.addVehicle(carAt(-10, 0), rig, false);
    lights.endFrame();
    const glows = scene.getObjectByName('vehicle-lamp-glows') as THREE.Points;
    expect(glows.geometry.drawRange.count).toBe(0);
    lights.dispose();
  });

  it('switches everything off on a clear day', () => {
    const scene = new THREE.Scene();
    const lights = new VehicleLightSystem(scene);
    lights.setLook(look('day', 'clear'));
    expect(lights.beginFrame(new THREE.PerspectiveCamera(), 900)).toBe(false);
    expect(lights.headlight.visible).toBe(false);
    expect(scene.getObjectByName('vehicle-lamp-glows')?.visible).toBe(false);
    lights.dispose();
  });
});
