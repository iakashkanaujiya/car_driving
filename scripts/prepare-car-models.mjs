/**
 * Prepares the downloaded Sketchfab cars in models-src/cars/ for the game and
 * writes them to public/models/cars/. Run it again after adding or changing a
 * source: `node scripts/prepare-car-models.mjs`.
 *
 * For every car it removes scene props that are not part of the car, shrinks
 * oversized textures and drops anything left unused. The generic passenger car
 * pack holds ten cars on a turntable, so it is split into one file per car.
 * Wheels, paint and lamps are picked out at load time (src/game/vehicleAssets.ts).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NodeIO, getBounds } from '@gltf-transform/core';
import {
  clearNodeTransform,
  compactPrimitive,
  dedup,
  flatten,
  prune,
  textureCompress,
} from '@gltf-transform/functions';
import sharp from 'sharp';

const projectRoot = process.cwd();
const sourceDir = path.join(projectRoot, 'models-src', 'cars');
const outputDir = path.join(projectRoot, 'public', 'models', 'cars');
const io = new NodeIO();

/** One source file per car; `removeMaterials` are scene props such as ground planes. */
const SINGLE_CARS = [
  { source: 'volvo_v60_polestar_2013.glb', output: 'volvo_v60_polestar.glb' },
  { source: '2000_jaguar_xj_sport_x308_xj8.glb', output: 'jaguar_xj_sport.glb' },
  { source: 'peugeot_3008.glb', output: 'peugeot_3008.glb' },
  { source: 'nissan_z_proto.glb', output: 'nissan_z_proto.glb' },
  { source: 'nissan_skyline_r34_gt-r.glb', output: 'nissan_skyline_r34.glb' },
  { source: 'mercedes_benz_c63_amg.glb', output: 'mercedes_c63_amg.glb' },
  { source: 'bmw_7-series_f01.glb', output: 'bmw_7_series.glb' },
  { source: 'bmw_i8.glb', output: 'bmw_i8.glb' },
  // Glowing light-streak cards from the showroom scene surround the car.
  {
    source: 'mercedes-maybach_vision_6.glb',
    output: 'maybach_vision_6.glb',
    removeMaterials: ['maybachv6_frame'],
  },
];

const PACK_SOURCE = 'generic_passenger_car_pack.glb';
/** Body node in the pack → output file. Each body's four wheels are loose siblings. */
const PACK_CARS = {
  'Compact Body': 'generic_compact.glb',
  'Coupe Body': 'generic_coupe.glb',
  'Hatchback Body': 'generic_hatchback.glb',
  'minivan body': 'generic_minivan.glb',
  'Offroad Body': 'generic_offroad.glb',
  'Pickup Body': 'generic_pickup.glb',
  'Sedan Body': 'generic_sedan.glb',
  'Sport body': 'generic_sport.glb',
  'SUV Body': 'generic_suv.glb',
  'Wagon Body': 'generic_wagon.glb',
};

function removeMeshesWithMaterials(document, names) {
  if (!names?.length) return;
  const removed = new Set(names);
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      if (removed.has(primitive.getMaterial()?.getName())) {
        mesh.removePrimitive(primitive);
        primitive.dispose();
      }
    }
  }
  // Nodes left without geometry are dropped by prune().
}

async function finish(document, outputName, maxTexture, title) {
  if (title) {
    const asset = document.getRoot().getAsset();
    asset.extras = { ...(asset.extras ?? {}), title };
  }
  // Some meshes carry vertices no triangle uses, which would stretch their bounds.
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getIndices()) compactPrimitive(primitive);
    }
  }
  await document.transform(
    prune(),
    // Keep every named material: the game finds paint, lamps and tyres by name.
    dedup({ keepUniqueNames: true }),
    textureCompress({ encoder: sharp, resize: [maxTexture, maxTexture] }),
    prune(),
  );
  const outputPath = path.join(outputDir, outputName);
  await io.write(outputPath, document);
  const bytes = (await readFile(outputPath)).byteLength;
  console.log(`${outputName}: ${(bytes / 1e6).toFixed(1)} MB`);
}

for (const car of SINGLE_CARS) {
  const document = await io.read(path.join(sourceDir, car.source));
  removeMeshesWithMaterials(document, car.removeMaterials);
  await finish(document, car.output, 1024);
}

// The pack: keep one body and the four wheels inside its footprint per file.
const packPath = path.join(sourceDir, PACK_SOURCE);
for (const [bodyName, outputName] of Object.entries(PACK_CARS)) {
  const document = await io.read(packPath);
  const root = document.getRoot();
  const body = root.listNodes().find((node) => node.getName() === bodyName);
  if (!body) throw new Error(`The car pack has no "${bodyName}" node.`);
  const container = body.getParentNode();
  const { min, max } = getBounds(body);
  const insideBody = (node) => {
    const bounds = getBounds(node);
    const x = (bounds.min[0] + bounds.max[0]) / 2;
    const z = (bounds.min[2] + bounds.max[2]) / 2;
    return x >= min[0] && x <= max[0] && z >= min[2] && z <= max[2];
  };
  const wheels = container
    .listChildren()
    .filter((node) => /^Wheel_/.test(node.getName()) && insideBody(node));
  if (wheels.length !== 4)
    throw new Error(`${bodyName}: expected 4 wheels, found ${wheels.length}.`);
  for (const node of container.listChildren()) {
    if (node !== body && !wheels.includes(node)) node.dispose();
  }
  // The turntable turns each car to a different heading. The longer side of
  // the wheel rectangle is the wheelbase, so turn the car until it runs along Z.
  // Wheel pivots are not always at the hub, so use the wheels' bounds. The
  // game centres every model, so the turn can be about any point.
  const centers = wheels.map((wheel) => {
    const bounds = getBounds(wheel);
    return [0, 1, 2].map((axis) => (bounds.min[axis] + bounds.max[axis]) / 2);
  });
  const [first, ...others] = centers;
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
  const [, wheelbasePartner] = others.sort((a, b) => distance(first, a) - distance(first, b));
  const heading = Math.atan2(wheelbasePartner[0] - first[0], wheelbasePartner[2] - first[2]);
  const wrapper = document
    .createNode('Car')
    .setRotation([0, Math.sin(-heading / 2), 0, Math.cos(-heading / 2)]);
  container.addChild(wrapper);
  for (const node of [body, ...wheels]) wrapper.addChild(node);
  // Bake the turn into the vertices: bounds of a mesh turned by an odd angle
  // are measured as a box around its local box, which would inflate the car.
  await document.transform(flatten());
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    // The pack shares one wheel mesh between a car's four wheels.
    if (mesh.listParents().filter((parent) => parent !== root).length > 1) {
      node.setMesh(mesh.clone());
    }
    clearNodeTransform(node);
  }
  const label = bodyName.replace(/ body$/i, '');
  await finish(document, outputName, 512, `Generic ${label.toLowerCase()}`);
}
