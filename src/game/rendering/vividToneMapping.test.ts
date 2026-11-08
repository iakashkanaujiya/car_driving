import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createVividToneMappingChunk,
  installVividToneMapping,
  TONE_SATURATION,
  TONE_VIBRANCE,
  VIVID_TONE_MAPPING,
} from './vividToneMapping';

/** The GLSL curve, mirrored in TypeScript: ACES, then saturation and vibrance. */
function vivid(aces: [number, number, number]): [number, number, number] {
  const luma = aces[0] * 0.2126 + aces[1] * 0.7152 + aces[2] * 0.0722;
  const chroma = Math.max(...aces) - Math.min(...aces);
  const boost = TONE_SATURATION + TONE_VIBRANCE * (1 - Math.min(1, chroma));
  return aces.map((c) => Math.min(1, Math.max(0, luma + (c - luma) * boost))) as [
    number,
    number,
    number,
  ];
}

describe('vivid tone mapping', () => {
  it('fills in three.js custom tone mapping on top of the ACES curve', () => {
    const source = THREE.ShaderChunk.tonemapping_pars_fragment;
    const chunk = createVividToneMappingChunk(source);
    const custom = chunk.slice(chunk.indexOf('vec3 CustomToneMapping'));
    expect(custom).toContain('ACESFilmicToneMapping( color )');
    expect(custom).toContain(TONE_SATURATION.toFixed(4));
    // The rest of the chunk, ACES included, is untouched.
    expect(chunk.slice(0, chunk.indexOf('vec3 CustomToneMapping'))).toBe(
      source.slice(0, source.indexOf('vec3 CustomToneMapping')),
    );
    expect(() => createVividToneMappingChunk('void main() {}')).toThrow();
  });

  it('installs once and is selected through CustomToneMapping', () => {
    installVividToneMapping();
    const installed = THREE.ShaderChunk.tonemapping_pars_fragment;
    installVividToneMapping();
    expect(THREE.ShaderChunk.tonemapping_pars_fragment).toBe(installed);
    expect(VIVID_TONE_MAPPING).toBe(THREE.CustomToneMapping);
  });

  it('enriches dull colours more than vivid ones and leaves greys alone', () => {
    const grey = vivid([0.4, 0.4, 0.4]);
    expect(grey[0]).toBeCloseTo(0.4, 6);
    expect(grey[2]).toBeCloseTo(0.4, 6);
    // A muted meadow green gains more spread than a saturated red.
    const meadow: [number, number, number] = [0.3, 0.38, 0.22];
    const red: [number, number, number] = [0.8, 0.1, 0.1];
    const spread = (c: number[]) => Math.max(...c) - Math.min(...c);
    expect(spread(vivid(meadow)) / spread(meadow)).toBeGreaterThan(
      spread(vivid(red)) / spread(red),
    );
    for (const channel of vivid(red)) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(1);
    }
  });
});
