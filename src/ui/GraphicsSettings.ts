import type { GraphicsQualityMode } from '../game/rendering/AdaptiveQuality';
import { byId } from './dom';

const STORAGE_KEY = 'driftline-graphics-quality';
const MODES: readonly GraphicsQualityMode[] = ['auto', 'low', 'medium', 'high'];
const DESCRIPTIONS: Record<GraphicsQualityMode, string> = {
  auto: 'Balances resolution and shadow detail from sustained frame pacing.',
  low: 'Prioritizes stable performance with 1x resolution and 512px shadows.',
  medium: 'Uses balanced 1.25x resolution and 1024px shadows.',
  high: 'Prioritizes detail with 1.5x resolution and 2048px shadows.',
};

interface GraphicsSettingsHandlers {
  onOpen(): void;
  onClose(): void;
  onChange(mode: GraphicsQualityMode): void;
}

/** Owns the graphics drawer, persistence, and its small DOM event surface. */
export class GraphicsSettings {
  private readonly root = byId<HTMLElement>('graphics-settings');
  private readonly openButton = byId<HTMLButtonElement>('graphics-button');
  private readonly closeButton = byId<HTMLButtonElement>('graphics-close');
  private readonly backdrop = byId<HTMLButtonElement>('graphics-backdrop');
  private readonly select = byId<HTMLSelectElement>('graphics-quality');
  private readonly description = byId<HTMLElement>('graphics-quality-description');
  private mode = this.loadMode();

  constructor() {
    this.select.value = this.mode;
    this.updateDescription();
  }

  bind(handlers: GraphicsSettingsHandlers, signal: AbortSignal): void {
    this.openButton.addEventListener('click', handlers.onOpen, { signal });
    this.closeButton.addEventListener('click', handlers.onClose, { signal });
    this.backdrop.addEventListener('click', handlers.onClose, { signal });
    this.select.addEventListener(
      'change',
      () => {
        const mode = this.select.value as GraphicsQualityMode;
        if (!MODES.includes(mode)) return;
        this.mode = mode;
        this.updateDescription();
        this.saveMode();
        handlers.onChange(mode);
      },
      { signal },
    );
  }

  getMode(): GraphicsQualityMode {
    return this.mode;
  }

  isOpen(): boolean {
    return !this.root.classList.contains('is-hidden');
  }

  open(): void {
    this.root.classList.remove('is-hidden');
    this.select.focus();
  }

  close(): void {
    this.root.classList.add('is-hidden');
    this.openButton.focus();
  }

  private updateDescription(): void {
    this.description.textContent = DESCRIPTIONS[this.mode];
  }

  private loadMode(): GraphicsQualityMode {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY) as GraphicsQualityMode | null;
      return saved && MODES.includes(saved) ? saved : 'low';
    } catch {
      return 'low';
    }
  }

  private saveMode(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, this.mode);
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
  }
}
