import { describe, expect, it } from 'vitest';
import { PerformanceMonitor } from './PerformanceMonitor';
import type { PerformanceSnapshot } from './PerformanceMonitor';

describe('performance monitor', () => {
  it('reports averaged frame pacing and the latest render counters', () => {
    const monitor = new PerformanceMonitor();
    let snapshot: PerformanceSnapshot | null = null;

    for (let frame = 0; frame < 60; frame += 1) {
      snapshot ??= monitor.recordFrame(
        1 / 60,
        { drawCalls: 120, triangles: 450_000, geometries: 42, textures: 18 },
        'medium',
      );
    }

    expect(snapshot).not.toBeNull();
    expect(snapshot?.fps).toBeCloseTo(60);
    expect(snapshot?.averageFrameMs).toBeCloseTo(1000 / 60);
    expect(snapshot?.p90FrameMs).toBeCloseTo(1000 / 60);
    expect(snapshot).toMatchObject({
      drawCalls: 120,
      triangles: 450_000,
      geometries: 42,
      textures: 18,
      quality: 'medium',
    });
  });

  it('ignores invalid timing samples', () => {
    const monitor = new PerformanceMonitor();
    const counters = { drawCalls: 0, triangles: 0, geometries: 0, textures: 0 };

    expect(monitor.recordFrame(0, counters, 'low')).toBeNull();
    expect(monitor.recordFrame(Number.NaN, counters, 'low')).toBeNull();
    expect(monitor.recordFrame(1.1, counters, 'low')).toBeNull();
  });
});
