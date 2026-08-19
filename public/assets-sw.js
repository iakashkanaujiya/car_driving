const ASSET_CACHE_PREFIX = 'driftline-assets-';
const LEGACY_CACHE_PREFIXES = ['driftline-core-game-', 'driftline-real-cars-'];
const DOWNLOAD_CONCURRENCY = 3;
let currentAssetCacheName = null;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      currentAssetCacheName =
        cacheNames
          .filter(
            (name) =>
              name.startsWith(ASSET_CACHE_PREFIX) ||
              LEGACY_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix)),
          )
          .at(-1) ?? null;
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      let currentCache = null;
      if (currentAssetCacheName) {
        currentCache = await caches.open(currentAssetCacheName);
        const currentMatch = await currentCache.match(event.request);
        if (currentMatch) return currentMatch;
      }
      const response = await fetch(event.request);
      // Vehicle packs are optional at startup. Persist each selected model on
      // first use so later runs retain the original offline-friendly behavior.
      if (currentCache && response.ok && url.pathname.includes('/models/')) {
        await currentCache.put(event.request, response.clone());
      }
      return response;
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'CACHE_ASSETS') return;
  const port = event.ports[0];
  if (!port) return;
  event.waitUntil(cacheAssets(event.data, port));
});

async function cacheAssets(message, port) {
  const cacheName = `${ASSET_CACHE_PREFIX}${message.version}`;
  currentAssetCacheName = cacheName;
  const cache = await caches.open(cacheName);
  const assets = message.assets;
  const totalBytes = message.totalBytes;
  const pending = [];
  let completedBytes = 0;
  let completedFiles = 0;
  let checkedFiles = 0;
  const activeBytes = new Map();
  let lastReport = 0;

  const report = (phase, currentFile, force = false) => {
    const now = performance.now();
    if (!force && now - lastReport < 100) return;
    lastReport = now;
    const downloadingBytes = [...activeBytes.values()].reduce((sum, size) => sum + size, 0);
    port.postMessage({
      type: 'progress',
      phase,
      loadedBytes: Math.min(totalBytes, completedBytes + downloadingBytes),
      totalBytes,
      completedFiles,
      checkedFiles,
      totalFiles: assets.length,
      currentFile,
    });
  };

  try {
    report('checking', undefined, true);
    for (const asset of assets) {
      const existing = await cache.match(asset.url);
      checkedFiles += 1;
      if (existing) {
        completedBytes += asset.size;
        completedFiles += 1;
      } else {
        pending.push(asset);
      }
      report('checking', asset.path);
    }

    report(pending.length > 0 ? 'downloading' : 'ready', undefined, true);
    let cursor = 0;

    const downloadNext = async () => {
      while (cursor < pending.length) {
        const asset = pending[cursor];
        cursor += 1;
        const request = new Request(asset.url, { credentials: 'same-origin' });
        const response = await fetch(request);
        if (!response.ok) {
          throw new Error(`Could not download ${asset.path} (HTTP ${response.status}).`);
        }

        const cacheWrite = cache.put(request, response.clone());
        if (response.body) {
          const reader = response.body.getReader();
          let fileBytes = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            fileBytes += value.byteLength;
            activeBytes.set(asset.url, Math.min(asset.size, fileBytes));
            report('downloading', asset.path);
          }
        }
        await cacheWrite;
        activeBytes.delete(asset.url);
        completedBytes += asset.size;
        completedFiles += 1;
        report('downloading', asset.path, true);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, pending.length) }, () => downloadNext()),
    );

    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter(
          (name) =>
            name !== cacheName &&
            (name.startsWith(ASSET_CACHE_PREFIX) ||
              LEGACY_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix))),
        )
        .map((name) => caches.delete(name)),
    );

    completedBytes = totalBytes;
    completedFiles = assets.length;
    report('ready', undefined, true);
    port.postMessage({ type: 'ready' });
  } catch (error) {
    port.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
