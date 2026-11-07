import * as THREE from 'three';
import { ATMOSPHERE } from './world/atmosphere';
import type { EnvironmentLook } from './world/conditions';

export interface SurfaceMaterialOptions {
  repeatX?: number;
  repeatY?: number;
  normalScale?: number;
  tint?: number;
  textureRoot?: string;
  transparent?: boolean;
  alphaTest?: number;
}

export interface SceneLighting {
  /** The key light: the sun by day, the moon at night. */
  sun: THREE.DirectionalLight;
  target: THREE.Object3D;
  hemisphere: THREE.HemisphereLight;
  /** Light position relative to the shadow centre, along the sky's sun or moon. */
  shadowOffset: THREE.Vector3;
}

const SHADOW_LIGHT_DISTANCE = 110;

export class SurfaceTextureStore {
  private readonly textures: THREE.Texture[] = [];
  private readonly pendingLoads: Promise<void>[] = [];
  private readonly loadErrors: string[] = [];

  constructor(private readonly maxAnisotropy: number) {}

  load(
    file: string,
    colorTexture: boolean,
    repeatX = 1,
    repeatY = 1,
    textureRoot = 'roads/textures',
  ): THREE.Texture {
    let markLoaded = (): void => undefined;
    const pendingLoad = new Promise<void>((resolve) => {
      markLoaded = resolve;
    });
    const texture = new THREE.TextureLoader().load(
      `${import.meta.env.BASE_URL}${textureRoot}/${file}`,
      markLoaded,
      undefined,
      () => {
        this.loadErrors.push(`Could not load ${textureRoot}/${file}.`);
        markLoaded();
      },
    );
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = Math.min(8, this.maxAnisotropy);
    if (colorTexture) texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(texture);
    this.pendingLoads.push(pendingLoad);
    return texture;
  }

  createMaterial(
    baseColor: string,
    normal: string,
    metallicRoughness: string,
    options: SurfaceMaterialOptions = {},
  ): THREE.MeshStandardMaterial {
    const repeatX = options.repeatX ?? 1;
    const repeatY = options.repeatY ?? 1;
    const textureRoot = options.textureRoot ?? 'roads/textures';
    const surfaceMap = this.load(metallicRoughness, false, repeatX, repeatY, textureRoot);
    return new THREE.MeshStandardMaterial({
      color: options.tint ?? 0xffffff,
      map: this.load(baseColor, true, repeatX, repeatY, textureRoot),
      normalMap: this.load(normal, false, repeatX, repeatY, textureRoot),
      normalScale: new THREE.Vector2(options.normalScale ?? 0.45, options.normalScale ?? 0.45),
      roughnessMap: surfaceMap,
      metalnessMap: surfaceMap,
      roughness: 0.96,
      metalness: 0.02,
      transparent: options.transparent ?? false,
      alphaTest: options.alphaTest ?? 0,
      depthWrite: !(options.transparent ?? false),
      side: THREE.DoubleSide,
    });
  }

  async whenReady(): Promise<void> {
    await Promise.all(this.pendingLoads);
    if (this.loadErrors.length > 0) {
      throw new Error(this.loadErrors.join(' '));
    }
  }

  dispose(): void {
    for (const texture of this.textures) texture.dispose();
    this.textures.length = 0;
  }
}

export function addSceneLighting(scene: THREE.Scene, shadowMapSize = 1024): SceneLighting {
  // Image-based lighting from the sky provides most of the ambient light; the
  // hemisphere adds a little green bounce from the valley floor.
  const hemisphere = new THREE.HemisphereLight(0xcfe3f2, 0x3c4a2e, 0.3);
  scene.add(hemisphere);

  const sun = new THREE.DirectionalLight(ATMOSPHERE.sunColor, ATMOSPHERE.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  sun.shadow.camera.left = -44;
  sun.shadow.camera.right = 44;
  sun.shadow.camera.top = 52;
  sun.shadow.camera.bottom = -38;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.00018;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 3;
  const target = new THREE.Object3D();
  sun.target = target;
  scene.add(sun, target);
  const shadowOffset = ATMOSPHERE.sunDirection.clone().multiplyScalar(SHADOW_LIGHT_DISTANCE);
  const lighting = { sun, target, hemisphere, shadowOffset };
  updateSceneShadow(lighting, new THREE.Vector3());
  return lighting;
}

/** Points the key light along the look's sun or moon and sets the fill light. */
export function applySceneLighting(lighting: SceneLighting, look: EnvironmentLook): void {
  lighting.sun.color.copy(look.lightColor);
  lighting.sun.intensity = look.lightIntensity;
  // Toggling shadows recompiles lit materials, so only write real changes.
  if (lighting.sun.castShadow !== look.castShadows) lighting.sun.castShadow = look.castShadows;
  lighting.hemisphere.color.copy(look.hemisphereSkyColor);
  lighting.hemisphere.groundColor.copy(look.hemisphereGroundColor);
  lighting.hemisphere.intensity = look.hemisphereIntensity;
  lighting.shadowOffset.copy(look.lightDirection).normalize().multiplyScalar(SHADOW_LIGHT_DISTANCE);
  updateSceneShadow(lighting, lighting.target.position);
}

export function updateSceneShadow(lighting: SceneLighting, center: THREE.Vector3): void {
  lighting.target.position.copy(center);
  lighting.sun.position.copy(center).add(lighting.shadowOffset);
}
