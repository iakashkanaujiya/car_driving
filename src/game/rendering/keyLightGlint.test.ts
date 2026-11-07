import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createEnvironmentLook } from '../world/conditions';
import {
  createKeyLightGlintChunk,
  installKeyLightGlintControl,
  setKeyLightGlint,
} from './keyLightGlint';

describe('key light glint control', () => {
  it('wraps only the directional light loop', () => {
    const source = THREE.ShaderChunk.lights_fragment_begin;
    const chunk = createKeyLightGlintChunk(source);
    const before = chunk.indexOf('vec3 keyLightSpecularBefore');
    const directional = chunk.indexOf('#if ( NUM_DIR_LIGHTS > 0 )');
    const after = chunk.indexOf('mix( reflectedLight.directSpecular, keyLightSpecularBefore');
    expect(before).toBeGreaterThan(chunk.indexOf('#if ( NUM_SPOT_LIGHTS > 0 )'));
    expect(before).toBeLessThan(directional);
    expect(after).toBeGreaterThan(directional);
    expect(after).toBeLessThan(chunk.indexOf('#if ( NUM_RECT_AREA_LIGHTS > 0 )'));
    // Everything three.js wrote is still there, in order.
    expect(chunk.replace(/\s+/g, '')).toContain(
      source.slice(source.indexOf('#if ( NUM_DIR_LIGHTS')).split('#endif')[0].replace(/\s+/g, ''),
    );
    expect(() => createKeyLightGlintChunk('void main() {}')).toThrow();
  });

  it('shares one dimming uniform across lit materials', () => {
    installKeyLightGlintControl();
    installKeyLightGlintControl();
    const standard = THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms);
    const lambert = THREE.UniformsUtils.clone(THREE.ShaderLib.lambert.uniforms);
    expect(standard.keyLightSpecularDim.value).toBe(lambert.keyLightSpecularDim.value);
    expect(THREE.ShaderLib.basic.uniforms.keyLightSpecularDim).toBeUndefined();
    expect(THREE.ShaderChunk.lights_pars_begin).toContain('uniform vec2 keyLightSpecularDim;');
    expect(THREE.ShaderChunk.lights_fragment_begin.match(/keyLightSpecularBefore =/g)).toHaveLength(
      1,
    );

    setKeyLightGlint(0.1);
    expect((standard.keyLightSpecularDim.value as Float32Array)[0]).toBeCloseTo(0.9, 6);
    setKeyLightGlint(1);
    expect((lambert.keyLightSpecularDim.value as Float32Array)[0]).toBe(0);
  });

  it('softens sun glints and mutes most of the moon glint', () => {
    const glint = (timeOfDay: 'day' | 'evening' | 'night') =>
      createEnvironmentLook({ timeOfDay, weather: 'clear' }).keyLightGlint;
    expect(glint('day')).toBeLessThan(1);
    expect(glint('day')).toBeGreaterThan(glint('evening'));
    expect(glint('evening')).toBeGreaterThan(glint('night'));
    expect(glint('night')).toBeLessThan(0.2);
  });
});
