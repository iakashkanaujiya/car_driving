import { describe, expect, it } from 'vitest';
import { createRoadStrip, updateRoadStrip } from './roadSurface';

describe('road surface', () => {
  it('keeps constant world-up normals while updating the ribbon', () => {
    const geometry = createRoadStrip(28, 12);
    const normal = geometry.getAttribute('normal');

    updateRoadStrip(geometry, 25, 200);

    for (let index = 0; index < normal.count; index += 1) {
      expect(normal.getX(index)).toBe(0);
      expect(normal.getY(index)).toBe(1);
      expect(normal.getZ(index)).toBe(0);
    }
    expect(geometry.boundingSphere).not.toBeNull();
  });
});
