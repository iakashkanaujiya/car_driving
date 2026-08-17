import { cp, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const vendor = path.join(root, 'public', 'mediapipe');
const wasmSource = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const modelPath = path.join(vendor, 'hand_landmarker.task');
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

await mkdir(vendor, { recursive: true });
await cp(wasmSource, path.join(vendor, 'wasm'), { recursive: true, force: true });

try {
  await access(modelPath, constants.F_OK);
} catch {
  try {
    const response = await fetch(modelUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    await import('node:fs/promises').then(({ writeFile }) => writeFile(modelPath, bytes));
    console.log('Downloaded MediaPipe hand model.');
  } catch (error) {
    console.warn(`Could not download hand model: ${error}. Hand tracking will retry from the hosted model.`);
  }
}
