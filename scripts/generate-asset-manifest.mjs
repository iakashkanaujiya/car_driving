import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const publicRoot = path.join(projectRoot, 'public');
const requiredAssets = [
  'great_mountain/landscape_mountain_optimized.glb',
  'roads/textures/Grass02_baseColor.jpeg',
  'roads/textures/Grass02_metallicRoughness.png',
  'roads/textures/Grass02_normal.png',
  'roads/textures/RoadLines_baseColor.jpeg',
  'roads/textures/RoadLines_metallicRoughness.png',
  'roads/textures/RoadLines_normal.png',
  'roads/textures/Sidewalk01_baseColor.jpeg',
  'roads/textures/Sidewalk01_metallicRoughness.png',
  'roads/textures/Sidewalk01_normal.png',
  'tree/pine_tree_1.glb',
];
const assetPaths = new Set();

const addAsset = (filePath) => {
  const resolved = path.resolve(filePath);
  const relative = path.relative(publicRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Game asset resolves outside public/: ${filePath}`);
  }
  assetPaths.add(relative.split(path.sep).join('/'));
};

for (const assetPath of requiredAssets) {
  addAsset(path.join(publicRoot, ...assetPath.split('/')));
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
  path.join(publicRoot, 'assets-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log(
  `Generated asset cache manifest: ${assets.length} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MB.`,
);
