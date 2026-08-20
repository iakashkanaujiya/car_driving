import type { PerformanceSnapshot } from '../diagnostics/PerformanceMonitor';
import { byId } from './dom';

const formatCount = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return Math.round(value).toString();
};

/** Owns the opt-in diagnostics panel so normal gameplay stays low-chrome. */
export class PerformanceHud {
  private readonly root = byId<HTMLElement>('performance-hud');
  private readonly fps = byId<HTMLElement>('perf-fps');
  private readonly frame = byId<HTMLElement>('perf-frame');
  private readonly p90 = byId<HTMLElement>('perf-p90');
  private readonly calls = byId<HTMLElement>('perf-calls');
  private readonly triangles = byId<HTMLElement>('perf-triangles');
  private readonly geometries = byId<HTMLElement>('perf-geometries');
  private readonly textures = byId<HTMLElement>('perf-textures');
  private readonly quality = byId<HTMLElement>('perf-quality');
  private visible = new URLSearchParams(window.location.search).has('perf');

  constructor() {
    this.root.classList.toggle('is-hidden', !this.visible);
  }

  isVisible(): boolean {
    return this.visible;
  }

  toggle(): boolean {
    this.visible = !this.visible;
    this.root.classList.toggle('is-hidden', !this.visible);
    return this.visible;
  }

  update(snapshot: PerformanceSnapshot): void {
    this.fps.textContent = Math.round(snapshot.fps).toString();
    this.frame.textContent = `${snapshot.averageFrameMs.toFixed(1)} ms`;
    this.p90.textContent = `${snapshot.p90FrameMs.toFixed(1)} ms`;
    this.calls.textContent = formatCount(snapshot.drawCalls);
    this.triangles.textContent = formatCount(snapshot.triangles);
    this.geometries.textContent = formatCount(snapshot.geometries);
    this.textures.textContent = formatCount(snapshot.textures);
    this.quality.textContent = snapshot.quality.toUpperCase();
    this.root.dataset.state = snapshot.fps >= 55 ? 'good' : snapshot.fps >= 40 ? 'warn' : 'slow';
  }
}
