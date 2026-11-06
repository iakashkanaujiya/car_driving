import { describe, expect, it } from 'vitest';
import manifest from '../../public/assets-manifest.json';

const assetPaths = manifest.assets.map(({ path }) => path);

describe('asset manifest', () => {
  it('contains core scenery while deferring optional vehicle packs', () => {
    expect(assetPaths).toHaveLength(10);
    // Mountains are generated procedurally, so no landscape download is needed.
    expect(assetPaths.some((path) => path.startsWith('great_mountain/'))).toBe(false);
    expect(assetPaths).toContain('tree/pine_tree_1.glb');
    expect(assetPaths.filter((path) => path.startsWith('models/'))).toHaveLength(0);
    expect(assetPaths.filter((path) => path.startsWith('roads/textures/'))).toHaveLength(9);
  });

  it('defers hand-tracking assets and reports the exact cache size', () => {
    expect(assetPaths.some((path) => path.startsWith('mediapipe/'))).toBe(false);
    expect(manifest.totalBytes).toBe(
      manifest.assets.reduce((total, asset) => total + asset.size, 0),
    );
  });
});
