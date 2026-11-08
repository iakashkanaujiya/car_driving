import * as THREE from 'three';

/**
 * Splits the parts of a car model that its author merged together: four tyres
 * in one mesh, or one lamp material covering both ends of the car. `root` is
 * the group that turns the model so its nose points along -Z: positions are
 * compared in world space, after that turn, and new meshes are baked into
 * `root`'s own space.
 */

interface MeshTriangles {
  mesh: THREE.Mesh;
  /** Mesh space to root space, for baking split parts. */
  toRoot: THREE.Matrix4;
  /** Triangle centroids in world space. */
  centroids: THREE.Vector3[];
  /** The three corners of each triangle, in world space. */
  corners: THREE.Vector3[][];
}

function vertexIndex(geometry: THREE.BufferGeometry, corner: number): number {
  const index = geometry.getIndex();
  return index ? index.getX(corner) : corner;
}

function triangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  const count = index ? index.count : geometry.getAttribute('position').count;
  return Math.floor(count / 3);
}

function readTriangles(mesh: THREE.Mesh, inverseRoot: THREE.Matrix4): MeshTriangles {
  const toRoot = new THREE.Matrix4().multiplyMatrices(inverseRoot, mesh.matrixWorld);
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const position = geometry.getAttribute('position');
  const centroids: THREE.Vector3[] = [];
  const corners: THREE.Vector3[][] = [];
  for (let triangle = 0; triangle < triangleCount(geometry); triangle += 1) {
    const points = [0, 1, 2].map((k) =>
      new THREE.Vector3()
        .fromBufferAttribute(position, vertexIndex(geometry, triangle * 3 + k))
        .applyMatrix4(mesh.matrixWorld),
    );
    corners.push(points);
    centroids.push(points[0].clone().add(points[1]).add(points[2]).divideScalar(3));
  }
  return { mesh, toRoot, centroids, corners };
}

/** Copies the listed triangles into a compact geometry and bakes `matrix` into it. */
export function extractTriangles(
  source: THREE.BufferGeometry,
  triangles: readonly number[],
  matrix: THREE.Matrix4,
): THREE.BufferGeometry {
  const remap = new Map<number, number>();
  const used: number[] = [];
  const indices: number[] = [];
  for (const triangle of triangles) {
    for (let k = 0; k < 3; k += 1) {
      const vertex = vertexIndex(source, triangle * 3 + k);
      let mapped = remap.get(vertex);
      if (mapped === undefined) {
        mapped = used.length;
        remap.set(vertex, mapped);
        used.push(vertex);
      }
      indices.push(mapped);
    }
  }
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const size = attribute.itemSize;
    const array = new Float32Array(used.length * size);
    used.forEach((vertex, i) => {
      for (let component = 0; component < size; component += 1) {
        array[i * size + component] = attribute.getComponent(vertex, component);
      }
    });
    geometry.setAttribute(name, new THREE.BufferAttribute(array, size));
  }
  geometry.setIndex(indices);
  geometry.applyMatrix4(matrix);
  return geometry;
}

/**
 * Replaces `mesh` with one mesh per group of triangles, each baked into root
 * space. Triangles whose group is null stay together under the original material.
 */
function splitMesh(
  root: THREE.Object3D,
  triangles: MeshTriangles,
  groupOf: (triangle: number) => string | null,
  materialFor: (group: string | null) => THREE.Material,
  /** An extra world-space transform for a group's triangles, such as straightening a wheel. */
  correctionFor: (group: string | null) => THREE.Matrix4 | null = () => null,
): Map<string | null, THREE.Mesh> {
  const groups = new Map<string | null, number[]>();
  triangles.centroids.forEach((_, triangle) => {
    const group = groupOf(triangle);
    const list = groups.get(group);
    if (list) list.push(triangle);
    else groups.set(group, [triangle]);
  });
  const { mesh, toRoot } = triangles;
  const meshes = new Map<string | null, THREE.Mesh>();
  const inverseRoot = root.matrixWorld.clone().invert();
  for (const [group, list] of groups) {
    const correction = correctionFor(group);
    const matrix = correction
      ? inverseRoot.clone().multiply(correction).multiply(mesh.matrixWorld)
      : toRoot;
    const geometry = extractTriangles(mesh.geometry as THREE.BufferGeometry, list, matrix);
    const part = new THREE.Mesh(geometry, materialFor(group));
    part.name = group === null ? mesh.name : `${mesh.name}-${group}`;
    part.renderOrder = mesh.renderOrder;
    root.add(part);
    meshes.set(group, part);
  }
  mesh.removeFromParent();
  return meshes;
}

function meshesWithMaterial(root: THREE.Object3D, names: ReadonlySet<string>): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    if (names.has(object.material.name)) meshes.push(object);
  });
  return meshes;
}

/**
 * Splits lamp materials that cover both ends of the car into `<name>#front`
 * and `<name>#rear`, so the brake lights never light the headlamps.
 */
export function splitLampsByEnd(root: THREE.Object3D, materialNames: ReadonlySet<string>): void {
  if (materialNames.size === 0) return;
  root.updateMatrixWorld(true);
  const center = new THREE.Box3().setFromObject(root, true).getCenter(new THREE.Vector3());
  const inverseRoot = root.matrixWorld.clone().invert();
  const clones = new Map<string, THREE.Material>();
  for (const mesh of meshesWithMaterial(root, materialNames)) {
    const source = mesh.material as THREE.Material;
    const triangles = readTriangles(mesh, inverseRoot);
    splitMesh(
      root,
      triangles,
      (triangle) => (triangles.centroids[triangle].z < center.z ? 'front' : 'rear'),
      (end) => {
        const name = `${source.name}#${end}`;
        let material = clones.get(`${source.uuid}${name}`);
        if (!material) {
          material = source.clone();
          material.name = name;
          clones.set(`${source.uuid}${name}`, material);
        }
        return material;
      },
    );
  }
}

interface WheelZone {
  hub: THREE.Vector3;
  radius: number;
  /** Lateral reach of the wheel, measured with the wheel straightened. */
  minX: number;
  maxX: number;
  /**
   * Turns the wheel about its hub so its axle runs along X; null when it
   * already does. Some models are posed with the front wheels steered.
   */
  straighten: THREE.Matrix4 | null;
}

/**
 * The angle about Y of a tyre's axle, from the spread of its vertices: a tyre
 * spreads widely along its rolling direction and narrowly along its axle.
 */
function axleYaw(points: readonly THREE.Vector3[], hub: THREE.Vector3): number {
  let xx = 0;
  let xz = 0;
  let zz = 0;
  for (const point of points) {
    const x = point.x - hub.x;
    const z = point.z - hub.z;
    xx += x * x;
    xz += x * z;
    zz += z * z;
  }
  // Direction of greatest spread, then the axle at right angles to it.
  const rolling = 0.5 * Math.atan2(2 * xz, xx - zz);
  let yaw = rolling - Math.PI / 2;
  if (yaw <= -Math.PI / 2) yaw += Math.PI;
  if (yaw > Math.PI / 2) yaw -= Math.PI;
  return yaw;
}

/**
 * Joins triangles that share a corner position into connected pieces.
 * Returns each triangle's piece number.
 */
function connectedPieces(corners: readonly THREE.Vector3[][]): number[] {
  const parent = corners.map((_, triangle) => triangle);
  const find = (triangle: number): number => {
    while (parent[triangle] !== triangle) {
      parent[triangle] = parent[parent[triangle]];
      triangle = parent[triangle];
    }
    return triangle;
  };
  const owner = new Map<string, number>();
  corners.forEach((points, triangle) => {
    for (const point of points) {
      // Exports often split vertices along UV seams, so match by position.
      const key = `${point.x.toFixed(4)},${point.y.toFixed(4)},${point.z.toFixed(4)}`;
      const other = owner.get(key);
      if (other === undefined) owner.set(key, triangle);
      else parent[find(triangle)] = find(other);
    }
  });
  return corners.map((_, triangle) => find(triangle));
}

/**
 * Finds the four tyres among the tyre materials and gives each corner of the
 * car its own wheel meshes. A piece of a wheel material joins a wheel only if
 * it lies wholly inside the tyre's cylinder and is centred on the hub or
 * reaches in close to it, as rims, spokes, discs and wheel nuts do. Brake
 * calipers, arch liners and trim sharing those materials stay on the body.
 * Returns the new wheel meshes, or none when four tyres cannot be found.
 */
export function separateWheels(
  root: THREE.Object3D,
  tyreNames: ReadonlySet<string>,
  wheelNames: ReadonlySet<string>,
): THREE.Mesh[] {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root, true);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const inverseRoot = root.matrixWorld.clone().invert();
  const cornerOf = (point: THREE.Vector3): string =>
    `${point.x < center.x ? 'left' : 'right'}-${point.z < center.z ? 'front' : 'rear'}`;
  // Tyres sit low and out at the sides; this skips a spare on the tailgate.
  const isTyre = (point: THREE.Vector3): boolean =>
    point.y < bounds.min.y + size.y * 0.55 && Math.abs(point.x - center.x) > size.x * 0.18;

  const tyreMeshes = meshesWithMaterial(root, tyreNames).map((mesh) =>
    readTriangles(mesh, inverseRoot),
  );
  const tyrePoints = new Map<string, THREE.Vector3[]>();
  for (const { centroids, corners } of tyreMeshes) {
    centroids.forEach((centroid, triangle) => {
      if (!isTyre(centroid)) return;
      const corner = cornerOf(centroid);
      const points = tyrePoints.get(corner) ?? [];
      points.push(...corners[triangle]);
      tyrePoints.set(corner, points);
    });
  }
  if (tyrePoints.size !== 4) return [];
  const zones = new Map<string, WheelZone>();
  for (const [corner, points] of tyrePoints) {
    const hub = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
    const yaw = axleYaw(points, hub);
    // Less than about half a degree is modelling noise, not a steered wheel.
    const straighten =
      Math.abs(yaw) > 0.01
        ? new THREE.Matrix4()
            .makeTranslation(hub.x, hub.y, hub.z)
            .multiply(new THREE.Matrix4().makeRotationY(yaw))
            .multiply(new THREE.Matrix4().makeTranslation(-hub.x, -hub.y, -hub.z))
        : null;
    const box = new THREE.Box3();
    for (const point of points) {
      box.expandByPoint(straighten ? point.clone().applyMatrix4(straighten) : point);
    }
    const tyreSize = box.getSize(new THREE.Vector3());
    const radius = Math.max(tyreSize.y, tyreSize.z) / 2;
    zones.set(corner, {
      hub,
      radius,
      // Hubs and brake discs sit inboard of the tyre.
      minX: box.min.x - radius * 0.5,
      maxX: box.max.x + radius * 0.5,
      straighten,
    });
  }
  const straightened = (point: THREE.Vector3, zone: WheelZone): THREE.Vector3 =>
    zone.straighten ? point.clone().applyMatrix4(zone.straighten) : point;
  const radialDistance = (point: THREE.Vector3, zone: WheelZone): number =>
    Math.hypot(point.y - zone.hub.y, point.z - zone.hub.z);
  const insideZone = (point: THREE.Vector3, zone: WheelZone): boolean => {
    const local = straightened(point, zone);
    return (
      radialDistance(local, zone) <= zone.radius * 1.02 &&
      local.x >= zone.minX &&
      local.x <= zone.maxX
    );
  };

  /** Wheel corner for each triangle of a rim-like mesh, or null for the body. */
  const assignWheelPieces = (triangles: MeshTriangles): (string | null)[] => {
    const pieceOf = connectedPieces(triangles.corners);
    const pieces = new Map<number, number[]>();
    pieceOf.forEach((piece, triangle) => {
      const list = pieces.get(piece);
      if (list) list.push(triangle);
      else pieces.set(piece, [triangle]);
    });
    const result: (string | null)[] = pieceOf.map(() => null);
    for (const list of pieces.values()) {
      const box = new THREE.Box3();
      for (const triangle of list)
        for (const point of triangles.corners[triangle]) box.expandByPoint(point);
      const corner = cornerOf(box.getCenter(new THREE.Vector3()));
      const zone = zones.get(corner)!;
      const inside = list.every((triangle) =>
        triangles.corners[triangle].every((point) => insideZone(point, zone)),
      );
      if (!inside) continue;
      const pieceCenter = straightened(box.getCenter(new THREE.Vector3()), zone);
      let nearest = Infinity;
      let farthest = 0;
      for (const triangle of list) {
        for (const point of triangles.corners[triangle]) {
          const distance = radialDistance(straightened(point, zone), zone);
          nearest = Math.min(nearest, distance);
          farthest = Math.max(farthest, distance);
        }
      }
      // Rims, discs and hub caps are centred on the hub; wheel nuts sit right
      // by it; spokes run from close to the hub out toward the rim. A brake
      // caliper or suspension arm does none of these.
      const centred = radialDistance(pieceCenter, zone) < zone.radius * 0.15;
      const byHub = nearest < zone.radius * 0.2;
      const spoke = nearest < zone.radius * 0.35 && farthest - nearest > zone.radius * 0.45;
      if (!centred && !byHub && !spoke) continue;
      for (const triangle of list) result[triangle] = corner;
    }
    return result;
  };

  const wheelParts: THREE.Mesh[] = [];
  const tyreSet = new Set(tyreMeshes.map(({ mesh }) => mesh));
  const others = meshesWithMaterial(root, wheelNames)
    .filter((mesh) => !tyreSet.has(mesh))
    .map((mesh) => readTriangles(mesh, inverseRoot));
  for (const triangles of [...tyreMeshes, ...others]) {
    const groups = tyreSet.has(triangles.mesh)
      ? triangles.centroids.map((centroid) => (isTyre(centroid) ? cornerOf(centroid) : null))
      : assignWheelPieces(triangles);
    if (groups.every((group) => group === null)) continue;
    const material = triangles.mesh.material as THREE.Material;
    const parts = splitMesh(
      root,
      triangles,
      (triangle) => groups[triangle],
      () => material,
      (group) => (group === null ? null : zones.get(group)!.straighten),
    );
    for (const [group, part] of parts) if (group !== null) wheelParts.push(part);
  }
  return wheelParts;
}
