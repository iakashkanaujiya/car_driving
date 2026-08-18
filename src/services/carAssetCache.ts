export type CarAssetCachePhase =
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'unsupported'
  | 'error';

export interface CarAssetCacheProgress {
  phase: CarAssetCachePhase;
  loadedBytes: number;
  totalBytes: number;
  completedFiles: number;
  checkedFiles: number;
  totalFiles: number;
  currentFile?: string;
  message?: string;
}

interface CarAssetManifest {
  version: string;
  totalBytes: number;
  assets: Array<{ path: string; size: number }>;
}

interface WorkerProgressMessage extends CarAssetCacheProgress {
  type: 'progress';
}

type WorkerMessage =
  | WorkerProgressMessage
  | { type: 'ready' }
  | { type: 'error'; message: string };

const emptyProgress = (
  phase: CarAssetCachePhase,
  message?: string,
): CarAssetCacheProgress => ({
  phase,
  loadedBytes: 0,
  totalBytes: 0,
  completedFiles: 0,
  checkedFiles: 0,
  totalFiles: 0,
  message,
});

export async function cacheRealCarAssets(
  onProgress: (progress: CarAssetCacheProgress) => void,
): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('caches' in window)) {
    onProgress(emptyProgress('unsupported', 'Browser storage is unavailable.'));
    return false;
  }

  try {
    onProgress(emptyProgress('checking'));
    const baseUrl = new URL(import.meta.env.BASE_URL, window.location.href);
    const manifestResponse = await fetch(
      new URL('car-assets-manifest.json', baseUrl),
      { cache: 'no-cache' },
    );
    if (!manifestResponse.ok) {
      throw new Error(`Asset manifest returned HTTP ${manifestResponse.status}.`);
    }
    const manifest = await manifestResponse.json() as CarAssetManifest;
    if (!manifest.version || !manifest.assets.length || manifest.totalBytes <= 0) {
      throw new Error('The real-car asset manifest is invalid.');
    }

    void navigator.storage?.persist?.().catch(() => false);
    await navigator.serviceWorker.register(
      new URL('car-assets-sw.js', baseUrl),
      {
        scope: baseUrl.pathname,
        updateViaCache: 'none',
      },
    );
    const registration = await navigator.serviceWorker.ready;
    const worker = registration.active;
    if (!worker) throw new Error('The asset storage worker did not activate.');

    const assets = manifest.assets.map((asset) => ({
      ...asset,
      url: new URL(asset.path, baseUrl).href,
    }));

    const cached = await new Promise<boolean>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event: MessageEvent<WorkerMessage>): void => {
        const message = event.data;
        if (message.type === 'progress') {
          const { type: _type, ...progress } = message;
          onProgress(progress);
        } else if (message.type === 'ready') {
          channel.port1.close();
          resolve(true);
        } else {
          onProgress(emptyProgress('error', message.message));
          channel.port1.close();
          resolve(false);
        }
      };
      worker.postMessage(
        {
          type: 'CACHE_CAR_ASSETS',
          version: manifest.version,
          totalBytes: manifest.totalBytes,
          assets,
        },
        [channel.port2],
      );
    });

    if (cached && !navigator.serviceWorker.controller) {
      await waitForController();
    }
    return cached;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('Real-car browser cache unavailable; using network loading.', error);
    onProgress(emptyProgress('error', message));
    return false;
  }
}

async function waitForController(): Promise<void> {
  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(resolve, 3_000);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}
