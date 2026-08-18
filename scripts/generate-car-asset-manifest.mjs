import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const publicRoot = path.join(projectRoot, 'public');
const modelsRoot = path.join(publicRoot, 'models');
const modelFolders = [
  '1970_chevrolet_camaro',
  '1970_Pontiac',
  '1976_volkswagen_golf',
  '2018_audi_e-tron_gt_concept',
  '2021_mercedes-benz_s-class_maybach',
  '2023_audi_r8_coupe_v10_gt_rwd',
  'bmw_i8',
  'creata',
  'mercedes_benz_g-class_w263',
  'tata_tiago',
  '2021_ford_bronco_2-door',
];

const assetPaths = new Set();

const addAsset = (filePath) => {
  const resolved = path.resolve(filePath);
  const relative = path.relative(publicRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Car asset resolves outside public/: ${filePath}`);
  }
  assetPaths.add(relative.split(path.sep).join('/'));
};

for (const folder of modelFolders) {
  const scenePath = path.join(modelsRoot, folder, 'scene.gltf');
  const scene = JSON.parse(await readFile(scenePath, 'utf8'));
  addAsset(scenePath);

  const references = [
    ...(scene.buffers ?? []).map(({ uri }) => uri),
    ...(scene.images ?? []).map(({ uri }) => uri),
  ].filter((uri) => typeof uri === 'string' && !uri.startsWith('data:'));

  for (const uri of references) {
    const cleanUri = decodeURIComponent(uri.split(/[?#]/, 1)[0]);
    addAsset(path.resolve(path.dirname(scenePath), cleanUri));
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
