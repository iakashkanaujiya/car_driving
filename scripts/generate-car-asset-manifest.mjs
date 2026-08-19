import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const publicRoot = path.join(projectRoot, 'public');
const modelsRoot = path.join(publicRoot, 'models');
const activeModels = new Set([
  'ford_everest_sport_2023.glb',
  'hyundai_ioniq_5_-_lowpoly.glb',
]);
const assetPaths = new Set();

const addAsset = (filePath) => {
  const resolved = path.resolve(filePath);
  const relative = path.relative(publicRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Car asset resolves outside public/: ${filePath}`);
  }
  assetPaths.add(relative.split(path.sep).join('/'));
};

for (const entry of await readdir(modelsRoot, { withFileTypes: true })) {
  if (
    entry.isFile() &&
    entry.name.toLowerCase().endsWith('.glb') &&
    activeModels.has(entry.name)
  ) {
    addAsset(path.join(modelsRoot, entry.name));
  }
}

const hash = createHash('sha256');
const assets = [];
let totalBytes = 0;

for (const assetPath of [...assetPaths].sort()) {
  const filePath = path.join(publicRoot, ...assetPath.split('/'));
  const fileStat = await stat(filePath);
  const bytes = await readFile(filePath);
  hash.update(assetPath);
  hash.update(bytes);
  totalBytes += fileStat.size;
  assets.push({ path: assetPath, size: fileStat.size });
}

const manifest = {
  version: hash.digest('hex').slice(0, 16),
  totalBytes,
  assets,
};

await writeFile(
  path.join(publicRoot, 'car-assets-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log(
  `Generated real-car cache manifest: ${assets.length} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MB.`,
);
