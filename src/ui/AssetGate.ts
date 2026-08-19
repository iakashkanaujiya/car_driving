import type { AssetCacheProgress } from '../services/assetCache';
import { byId } from './dom';

const INITIAL_PROGRESS: AssetCacheProgress = {
  phase: 'checking',
  loadedBytes: 0,
  totalBytes: 0,
  completedFiles: 0,
  checkedFiles: 0,
  totalFiles: 0,
};

/** Renders startup download state and owns the modal's locking behavior. */
export class AssetGate {
  private readonly root = byId<HTMLElement>('asset-gate');
  private readonly title = byId<HTMLElement>('asset-gate-title');
  private readonly message = byId<HTMLElement>('asset-gate-message');
  private readonly loader = byId<HTMLElement>('asset-loader');
  private readonly panel = byId<HTMLElement>('asset-download');
  private readonly label = byId<HTMLElement>('asset-download-label');
  private readonly percent = byId<HTMLElement>('asset-download-percent');
  private readonly fill = byId<HTMLElement>('asset-download-fill');
  private readonly detail = byId<HTMLElement>('asset-download-detail');
  readonly retryButton = byId<HTMLButtonElement>('asset-download-retry');
  private progress = INITIAL_PROGRESS;

  begin(): void {
    this.setApplicationLocked(true);
    this.root.classList.remove('is-hidden');
    this.root.dataset.state = 'loading';
    this.retryButton.classList.add('is-hidden');
  }

  showError(): void {
    this.root.dataset.state = 'error';
    this.retryButton.classList.remove('is-hidden');
  }

  async finish(): Promise<void> {
    this.root.dataset.state = 'ready';
    await new Promise<void>((resolve) => window.setTimeout(resolve, 450));
    this.root.classList.add('is-hidden');
    this.setApplicationLocked(false);
  }

  update(progress: AssetCacheProgress): void {
    this.progress = progress;
    const checkedRatio = progress.totalFiles > 0 ? progress.checkedFiles / progress.totalFiles : 0;
    const downloadedRatio = progress.totalBytes > 0 ? progress.loadedBytes / progress.totalBytes : 0;
    const ratio = progress.phase === 'checking' ? checkedRatio : downloadedRatio;
    const percentage = progress.phase === 'ready' || progress.phase === 'preparing'
      ? 100
      : Math.max(0, Math.min(99, Math.round(ratio * 100)));

    this.panel.dataset.state = progress.phase;
    this.loader.style.setProperty('--download-progress', `${percentage * 3.6}deg`);
    this.percent.textContent = `${percentage}%`;
    this.fill.style.width = `${percentage}%`;

    switch (progress.phase) {
      case 'checking':
        this.label.textContent = 'CHECKING BROWSER STORAGE';
        this.detail.textContent = progress.totalFiles > 0
          ? `${progress.checkedFiles} / ${progress.totalFiles} files checked`
          : 'Looking for previously downloaded assets...';
        break;
      case 'downloading':
        this.label.textContent = 'DOWNLOADING ASSETS';
        this.detail.textContent = `${formatBytes(progress.loadedBytes)} / ${formatBytes(progress.totalBytes)} saved · ${progress.completedFiles} / ${progress.totalFiles} files`;
        break;
      case 'preparing':
        this.title.innerHTML = 'GAME IS<br>LOADING.';
        this.message.textContent = 'All files are cached. Preparing textures and scenery for the game...';
        this.label.textContent = 'PREPARING GAME';
        this.detail.textContent = 'Decoding cached textures, trees, and mountain assets...';
        break;
      case 'ready':
        this.title.innerHTML = 'GAME<br>READY.';
        this.message.textContent = 'All required assets are stored and prepared.';
        this.label.textContent = 'ASSETS READY';
        this.detail.textContent = `${formatBytes(progress.totalBytes)} saved in browser storage for future visits.`;
        break;
      default:
        this.title.innerHTML = 'GAME LOAD<br>INTERRUPTED.';
        this.message.textContent = 'The game stays locked until every required asset is safely downloaded.';
        this.label.textContent = 'ASSET LOAD FAILED';
        this.percent.textContent = '!';
        this.loader.style.setProperty('--download-progress', '360deg');
        this.detail.textContent = progress.message
          ?? 'Check your connection and available browser storage, then retry.';
    }
  }

  markPreparing(): void {
    this.update({
      ...this.progress,
      phase: 'preparing',
      loadedBytes: this.progress.totalBytes,
      completedFiles: this.progress.totalFiles,
    });
  }

  markReady(): void {
    this.update({
      ...this.progress,
      phase: 'ready',
      loadedBytes: this.progress.totalBytes,
      completedFiles: this.progress.totalFiles,
    });
  }

  markPreparationError(): void {
    this.update({
      ...this.progress,
      phase: 'error',
      message: 'One or more cached scene assets could not be prepared.',
    });
  }

  private setApplicationLocked(locked: boolean): void {
    const shell = document.querySelector<HTMLElement>('.game-shell');
    if (!shell) return;
    for (const child of shell.children) {
      if (child instanceof HTMLElement && child.id !== 'asset-gate') child.inert = locked;
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
