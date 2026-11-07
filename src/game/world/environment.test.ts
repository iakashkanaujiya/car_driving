import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GAME, laneDividerOffsets } from '../config';
import { roadCenter, roadHeading } from '../math';
import { createRockGeometry } from '../sceneryAssets';
import {
  ATMOSPHERE,
  atmosphericFogFactor,
  createAtmosphericFogChunks,
  installAtmosphericFog,
  setAtmosphericScattering,
} from './atmosphere';
import { createPineGeometry, forestChunkTrees } from './ForestSystem';
import { createDashTexture, DASH_FRACTION, LaneMarkings } from './LaneMarkings';
import { mountainColor, mountainHeight } from './MountainRange';
import { RoadsideScenerySystem } from './RoadsideScenerySystem';
import { fbm3, mulberry32, ridged3, valueNoise3 } from './noise';

describe('procedural noise', () => {
  it('is deterministic and normalized', () => {
    for (let index = 0; index < 200; index += 1) {
      const x = index * 0.37;
      const value = fbm3(x, x * 0.5, -x, 5, 3);
      expect(value).toBe(fbm3(x, x * 0.5, -x, 5, 3));
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      expect(ridged3(x, 1, x, 4)).toBeLessThanOrEqual(1);
      expect(valueNoise3(x, 0, 0)).toBeGreaterThanOrEqual(0);
    }
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('aerial perspective fog', () => {
  it('thickens with distance and thins for rays climbing toward summits', () => {
    const near = atmosphericFogFactor(50, 0, 4);
    const far = atmosphericFogFactor(800, 0, 4);
    const summit = atmosphericFogFactor(800, 0.3, 4);
    expect(near).toBeLessThan(far);
    expect(summit).toBeLessThan(far);
    expect(far).toBeLessThan(1);
  });

  it('replaces three.js fog chunks with a shared sun-scatter direction', () => {
    const chunks = createAtmosphericFogChunks();
    expect(chunks.fog_pars_fragment).toContain('uniform vec3 fogScatterDirection');
    expect(chunks.fog_fragment).toContain('dot( fogRay, fogScatterDirection )');
    expect(chunks.fog_vertex).toContain('vFogViewPosition = mvPosition.xyz');
    installAtmosphericFog();
    installAtmosphericFog();
    expect(THREE.ShaderChunk.fog_fragment).toBe(chunks.fog_fragment);
  });

  it('shares one scatter uniform across every material, even after cloning', () => {
    installAtmosphericFog();
    const standard = THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms);
    const basic = THREE.UniformsUtils.clone(THREE.ShaderLib.basic.uniforms);
    expect(standard.fogScatterDirection.value).toBe(basic.fogScatterDirection.value);
    expect(THREE.ShaderLib.physical.uniforms.fogScatterColor).toBeDefined();
    expect(THREE.ShaderLib.depth.uniforms.fogScatterDirection).toBeUndefined();

    const moon = new THREE.Vector3(0.46, 0.25, -0.85).normalize();
    setAtmosphericScattering(moon, new THREE.Color(0.2, 0.3, 0.4));
    expect(Array.from(standard.fogScatterDirection.value as Float32Array)).toEqual(
      Array.from(new Float32Array(moon.toArray())),
    );
    setAtmosphericScattering(ATMOSPHERE.sunDirection, ATMOSPHERE.sunScatterColor);
    expect((basic.fogScatterColor.value as Float32Array)[0]).toBeCloseTo(
      ATMOSPHERE.sunScatterColor.r,
      6,
    );
  });

  it('closes in when the density rises for fog', () => {
    const clear = atmosphericFogFactor(200, 0, 4);
    const foggy = atmosphericFogFactor(200, 0, 4, ATMOSPHERE.fogDensity * 8.5);
    expect(foggy).toBeGreaterThan(0.75);
    expect(clear).toBeLessThan(0.25);
  });
});

describe('mountain range', () => {
  it('is seamless around the ring', () => {
    for (const radius of [500, 900, 1400]) {
      expect(mountainHeight(0, radius)).toBeCloseTo(mountainHeight(Math.PI * 2, radius), 6);
    }
  });

  it('rises from low foothills to tall outer summits', () => {
    let foothills = 0;
    let summits = 0;
    for (let index = 0; index < 64; index += 1) {
      const angle = (index / 64) * Math.PI * 2;
      foothills = Math.max(foothills, mountainHeight(angle, 370));
      summits = Math.max(summits, mountainHeight(angle, 1300));
    }
    expect(foothills).toBeLessThan(40);
    expect(summits).toBeGreaterThan(180);
  });

  it('puts snow on gentle high ground and forest in the valley', () => {
    const snow = mountainColor(300, 0.9, 0.5, new THREE.Color());
    const forest = mountainColor(10, 0.95, 0.5, new THREE.Color());
    expect(snow.r).toBeGreaterThan(0.5);
    expect(forest.g).toBeGreaterThan(forest.r);
    expect(forest.r).toBeLessThan(0.1);
  });
});

describe('forest placement', () => {
  it('is deterministic and never encroaches on the road verge', () => {
    const trees = forestChunkTrees(5, 60);
    expect(trees).toEqual(forestChunkTrees(5, 60));
    for (const tree of trees) {
      expect(Math.abs(tree.offset)).toBeGreaterThan(GAME.roadWidth / 2 + 10);
      expect(tree.distance).toBeGreaterThanOrEqual(5 * 40);
      expect(tree.distance).toBeLessThan(6 * 40);
    }
  });

  it('builds a vertex-shaded conifer about one unit tall', () => {
    const geometry = createPineGeometry();
    geometry.computeBoundingBox();
    expect(geometry.getAttribute('color')).toBeDefined();
    expect(geometry.boundingBox!.max.y).toBeCloseTo(1.05, 1);
    expect(geometry.boundingBox!.min.y).toBeGreaterThanOrEqual(-0.1);
  });
});

describe('roadside rocks', () => {
  it('produces distinct boulders that sit on the ground', () => {
    const a = createRockGeometry(1);
    const b = createRockGeometry(2);
    a.computeBoundingBox();
    expect(a.getAttribute('color')).toBeDefined();
    expect(a.boundingBox!.min.y).toBeGreaterThan(-0.2);
    expect(a.getAttribute('position').array).not.toEqual(b.getAttribute('position').array);
  });
});

describe('roadside scenery', () => {
  const instanceDistances = (mesh: THREE.InstancedMesh): number[] => {
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    return Array.from({ length: mesh.count }, (_, index) => {
      mesh.getMatrixAt(index, matrix);
      return -position.setFromMatrixPosition(matrix).z;
    });
  };

  it('draws every pine and rock variant as one instanced mesh each', () => {
    const scene = new THREE.Scene();
    const scenery = new RoadsideScenerySystem(scene);
    const prototype = new THREE.Group();
    prototype.add(new THREE.Mesh(new THREE.ConeGeometry(1, 3)));
    prototype.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1)));
    scenery.setTreeModel(prototype);
    scenery.update(0);

    const meshes = scene.children.filter(
      (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
    );
    const pines = meshes.filter((mesh) => mesh.name === 'roadside-pine');
    const rocks = meshes.filter((mesh) => mesh.name.startsWith('roadside-rock-'));
    expect(scene.children).toHaveLength(6);
    expect(pines.map((mesh) => mesh.count)).toEqual([36, 36]);
    // Eight boulder clusters of three stones each.
    expect(rocks.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(24);
    expect(meshes.every((mesh) => mesh.castShadow)).toBe(true);
    scenery.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('recycles slots ahead of the player and restores them on reset', () => {
    const scene = new THREE.Scene();
    const scenery = new RoadsideScenerySystem(scene);
    const prototype = new THREE.Group();
    prototype.add(new THREE.Mesh(new THREE.ConeGeometry(1, 3)));
    scenery.setTreeModel(prototype);
    const pine = scene.getObjectByName('roadside-pine') as THREE.InstancedMesh;
    scenery.update(0);
    const start = instanceDistances(pine);
    expect(Math.min(...start)).toBeLessThan(0);

    scenery.update(100);
    // Lateral offsets on the curving road shift z by at most the verge width.
    const margin = GAME.roadWidth / 2 + 16;
    expect(Math.min(...instanceDistances(pine))).toBeGreaterThan(100 - 70 - margin);

    scenery.reset();
    scenery.update(0);
    expect(instanceDistances(pine)).toEqual(start);
    scenery.dispose();
  });
});

describe('lane markings', () => {
  it('paints one third of every dash period', () => {
    const texture = createDashTexture(60);
    const data = texture.image.data as Uint8Array;
    const alpha = Array.from({ length: 60 }, (_, row) => data[row * 4 + 1]);
    expect(alpha.filter((value) => value === 255)).toHaveLength(60 * DASH_FRACTION);
    expect(alpha[0]).toBe(255);
    expect(alpha[59]).toBe(0);
    expect(texture.wrapT).toBe(THREE.RepeatWrapping);
  });

  it('draws a divider strip between the two lanes on each side', () => {
    const scene = new THREE.Scene();
    const markings = new LaneMarkings(scene);
    markings.update(0, 300);
    const dividers = scene.children as THREE.Mesh[];
    expect(dividers).toHaveLength(2);
    for (const [index, divider] of dividers.entries()) {
      // At distance 0 the first vertex pair straddles the divider offset.
      const position = divider.geometry.getAttribute('position');
      const midX = (position.getX(0) + position.getX(1)) / 2;
      const heading = roadHeading(0);
      expect(midX).toBeCloseTo(roadCenter(0) + Math.cos(heading) * laneDividerOffsets[index], 4);
    }
    markings.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
