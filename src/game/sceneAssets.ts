import * as THREE from 'three';

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
  sun: THREE.DirectionalLight;
  target: THREE.Object3D;
  visual: THREE.Group;
}

const SUN_SHADOW_OFFSET = new THREE.Vector3(-45, 75, 30);

export class SurfaceTextureStore {
  private readonly textures: THREE.Texture[] = [];

  constructor(private readonly maxAnisotropy: number) {}

  load(
    file: string,
    colorTexture: boolean,
    repeatX = 1,
    repeatY = 1,
    textureRoot = 'roads/textures',
  ): THREE.Texture {
    const texture = new THREE.TextureLoader().load(
      `${import.meta.env.BASE_URL}${textureRoot}/${file}`,
    );
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = Math.min(8, this.maxAnisotropy);
    if (colorTexture) texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(texture);
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
    const surfaceMap = this.load(
      metallicRoughness,
      false,
      repeatX,
      repeatY,
      textureRoot,
    );
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

  track(texture: THREE.Texture): void {
    this.textures.push(texture);
  }

  dispose(): void {
    for (const texture of this.textures) texture.dispose();
    this.textures.length = 0;
  }
}

export function addSceneLighting(scene: THREE.Scene): SceneLighting {
  const hemisphere = new THREE.HemisphereLight(0xdaf7ff, 0x31442c, 1.55);
  scene.add(hemisphere);

  const sun = new THREE.DirectionalLight(0xfff1ce, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -38;
  sun.shadow.camera.right = 38;
  sun.shadow.camera.top = 48;
  sun.shadow.camera.bottom = -32;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 180;
  sun.shadow.bias = -0.00012;
  sun.shadow.normalBias = 0.025;
  const target = new THREE.Object3D();
  sun.target = target;
  scene.add(sun, target);

  const sunCanvas = document.createElement('canvas');
  sunCanvas.width = 256;
  sunCanvas.height = 256;
  const context = sunCanvas.getContext('2d');
  if (context) {
    const glow = context.createRadialGradient(128, 128, 5, 128, 128, 126);
    glow.addColorStop(0, 'rgba(255,255,224,1)');
    glow.addColorStop(0.18, 'rgba(255,239,139,1)');
    glow.addColorStop(0.42, 'rgba(255,190,73,0.48)');
    glow.addColorStop(1, 'rgba(255,164,46,0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, 256, 256);
  }

  const sunTexture = new THREE.CanvasTexture(sunCanvas);
  sunTexture.colorSpace = THREE.SRGBColorSpace;
  const sunVisual = new THREE.Group();
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sunTexture,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  }));
  sunSprite.scale.set(72, 72, 1);
  sunVisual.add(sunSprite);
  sunVisual.add(new THREE.Mesh(
    new THREE.SphereGeometry(7.5, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xfff1a3, fog: false, depthTest: false }),
  ));
  scene.add(sunVisual);
  const lighting = { sun, target, visual: sunVisual };
  updateSceneShadow(lighting, new THREE.Vector3());
  return lighting;
}

export function updateSceneShadow(
  lighting: SceneLighting,
  center: THREE.Vector3,
): void {
  lighting.target.position.copy(center);
  lighting.sun.position.copy(center).add(SUN_SHADOW_OFFSET);
}

export function createCloudTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createLinearGradient(0, 36, 0, 170);
    gradient.addColorStop(0, 'rgba(255,255,255,0.96)');
    gradient.addColorStop(0.7, 'rgba(236,244,244,0.86)');
    gradient.addColorStop(1, 'rgba(196,216,220,0.12)');
    context.fillStyle = gradient;
    context.filter = 'blur(3px)';
    context.beginPath();
    context.ellipse(116, 124, 90, 40, -0.08, 0, Math.PI * 2);
    context.ellipse(208, 96, 100, 66, 0.03, 0, Math.PI * 2);
    context.ellipse(302, 82, 82, 72, -0.05, 0, Math.PI * 2);
    context.ellipse(390, 119, 96, 44, 0.08, 0, Math.PI * 2);
    context.ellipse(260, 133, 198, 44, 0, 0, Math.PI * 2);
    context.fill();
    context.filter = 'none';
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}
