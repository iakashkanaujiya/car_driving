import { describe, expect, it } from 'vitest';
import { PINE_TREE_MODEL_PATH } from './sceneryAssets';

describe('SceneryAssets', () => {
  it('uses the optimized pine tree variant', () => {
    expect(PINE_TREE_MODEL_PATH).toBe('tree/pine_tree_1.glb');
  });
});
