import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { copyFile, mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const sourcePath = path.join(
  projectRoot,
  'source-assets',
  'models',
  'ford_everest_sport_2023.source.glb',
);
const outputPath = path.join(
  projectRoot,
  'public',
  'models',
  'ford_everest_sport_2023.glb',
);
// NodeIO selects GLB vs. JSON glTF from the filename extension.
const temporaryPath = `${outputPath}.optimized.glb`;

const ratio = readNumberOption('--ratio', 0.22);
const error = readNumberOption('--error', 0.005);
const requiredNodeNames = ['WHEEL_RF', 'WHEEL_RR', 'WHEEL_LF', 'WHEEL_LR'];
const requiredMaterialNames = ['carpaint', 'redglass'];
if (ratio <= 0 || ratio > 1) throw new Error('--ratio must be greater than 0 and at most 1.');
if (error <= 0 || error > 1) throw new Error('--error must be greater than 0 and at most 1.');

await stat(sourcePath).catch(() => {
  throw new Error(`Missing preserved Everest source model: ${sourcePath}`);
});

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(sourcePath);
const before = inspect(document);

// Simplification welds identical vertices first, then reduces each material
// primitive independently so material assignments and textures stay intact.
await document.transform(
  dedup(),
  simplify({
    simplifier: MeshoptSimplifier,
    ratio,
    error,
    lockBorder: false,
  }),
  prune(),
);

const after = inspect(document);
if (after.triangles >= before.triangles * 0.8) {
  throw new Error(
    `Everest simplification was ineffective (${before.triangles} -> ${after.triangles} triangles).`,
  );
}
if (after.materials !== before.materials || after.textures !== before.textures) {
  throw new Error('Everest optimization unexpectedly changed material or texture counts.');
}
assertRuntimeBindings(after);

await mkdir(path.dirname(outputPath), { recursive: true });
await io.write(temporaryPath, document);
await copyFile(temporaryPath, outputPath);
await unlink(temporaryPath);
const writtenDocument = await io.read(outputPath);
const written = inspect(writtenDocument);
if (written.triangles !== after.triangles || written.vertices !== after.vertices) {
  throw new Error('Written Everest GLB failed geometry verification.');
}
assertRuntimeBindings(written);

const sourceBytes = (await stat(sourcePath)).size;
const outputBytes = (await stat(outputPath)).size;
console.log([
  'Everest optimization complete.',
  `Triangles: ${before.triangles.toLocaleString()} -> ${after.triangles.toLocaleString()}`,
  `Vertices: ${before.vertices.toLocaleString()} -> ${after.vertices.toLocaleString()}`,
  `File size: ${formatMb(sourceBytes)} MB -> ${formatMb(outputBytes)} MB`,
  `Materials/textures preserved: ${after.materials}/${after.textures}`,
].join('\n'));

function inspect(gltfDocument) {
  let triangles = 0;
  let vertices = 0;
  for (const mesh of gltfDocument.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION');
      const indices = primitive.getIndices();
      vertices += position?.getCount() ?? 0;
      triangles += Math.floor((indices?.getCount() ?? position?.getCount() ?? 0) / 3);
    }
  }
  return {
    triangles,
    vertices,
    materials: gltfDocument.getRoot().listMaterials().length,
    textures: gltfDocument.getRoot().listTextures().length,
    materialNames: gltfDocument.getRoot().listMaterials().map((material) => material.getName()),
    nodeNames: gltfDocument.getRoot().listNodes().map((node) => node.getName()),
  };
}

function assertRuntimeBindings(model) {
  for (const name of requiredNodeNames) {
    if (!model.nodeNames.includes(name)) throw new Error(`Optimized Everest lost wheel node: ${name}`);
  }
  for (const name of requiredMaterialNames) {
    if (!model.materialNames.includes(name)) throw new Error(`Optimized Everest lost material: ${name}`);
  }
}

function readNumberOption(name, fallback) {
  const prefix = `${name}=`;
  const argument = process.argv.slice(2).find((value) => value.startsWith(prefix));
  if (!argument) return fallback;
  const value = Number(argument.slice(prefix.length));
  if (!Number.isFinite(value)) throw new Error(`${name} must be numeric.`);
  return value;
}

function formatMb(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}
