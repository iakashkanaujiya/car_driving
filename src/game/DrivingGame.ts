import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GAME, laneOffsets } from './config';
import { clamp, constrainToRoad, curveSpeedLimit, damp, roadCenter, roadHeading } from './math';
import type { ControlInput, GamePhase, GameSnapshot } from './types';

interface TrafficCar {
  mesh: THREE.Group;
  distance: number;
  lane: number;
  speed: number;
  targetSpeed: number;
  speedChangeTimer: number;
  direction: 1 | -1;
  counted: boolean;
}

interface ForestMaterialOptions {
  repeatX?: number;
  repeatY?: number;
  normalScale?: number;
  tint?: number;
  transparent?: boolean;
  alphaTest?: number;
}

const carColors = [0xff5a5f, 0x65d1ff, 0xffcc4d, 0xa98cff, 0xf4f2e9, 0x50d890];

export class DrivingGame {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.1, 800);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly clock = new THREE.Clock();
  private readonly player = this.createCar(0xe9ff42, true);
  private readonly traffic: TrafficCar[] = [];
  private readonly laneMarkers: THREE.Mesh[] = [];
  private readonly scenery: THREE.Group[] = [];
  private readonly mountains: THREE.Group[] = [];
  private readonly clouds: THREE.Sprite[] = [];
  private readonly sunVisual = new THREE.Group();
  private readonly forestTextures: THREE.Texture[] = [];
  private readonly fenceSlots: Array<{ distance: number; side: -1 | 1 }> = [];
  private readonly fencePostGeometry = new THREE.BoxGeometry(0.2, 1.15, 0.2);
  private readonly fenceRailGeometry = new THREE.BoxGeometry(0.16, 0.17, 9.7);
  private readonly fenceDummy = new THREE.Object3D();
  private readonly fencePosts: THREE.InstancedMesh;
  private readonly fenceRails: THREE.InstancedMesh;
  private readonly rockMaterial: THREE.MeshStandardMaterial;
  private mapleTreePrototype?: THREE.Group;
  private greatMountainPrototype?: THREE.Group;
  private readonly roadGeometry: THREE.BufferGeometry;
  private readonly roadMesh: THREE.Mesh;
  private readonly shoulderGeometry: THREE.BufferGeometry;
  private readonly shoulderMesh: THREE.Mesh;
  private readonly ground: THREE.Mesh;
  private frame = 0;
  private phase: GamePhase = 'ready';
  private distance = 0;
  private speed = 0;
  private lateral: number = laneOffsets[0];
  private worldX = roadCenter(0) + Math.cos(roadHeading(0)) * laneOffsets[0];
  private vehicleHeading = roadHeading(0);
  private steeringVisual = 0;
  private overtakes = 0;
  private assistMessage = 'READY';
  private lastSnapshot = 0;
  private animationFrame = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly getControl: () => ControlInput,
    private readonly onUpdate: (snapshot: GameSnapshot) => void,
    private readonly onCrash: () => void,
  ) {
    this.scene.background = new THREE.Color(0x9bb8bd);
    this.scene.fog = new THREE.FogExp2(0x9bb8bd, 0.0048);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    const roadMaterial = this.createForestMaterial(
      'Dirt_Road_Bare_baseColor.png',
      'Dirt_Road_Bare_normal.png',
      'Dirt_Road_Bare_metallicRoughness.png',
      { normalScale: 0.48, tint: 0x8b98a5 },
    );
    const shoulderMaterial = this.createForestMaterial(
      'Ground_Dirt_baseColor.jpeg',
      'Ground_Dirt_normal.jpeg',
      'Ground_Dirt_metallicRoughness.png',
      { normalScale: 0.42, tint: 0x8f8068 },
    );
    const groundMaterial = this.createForestMaterial(
      'Grass_Close_baseColor.png',
      'Grass_Close_normal.jpeg',
      'Grass_Close_metallicRoughness.png',
      { repeatX: 58, repeatY: 58, normalScale: 0.36, tint: 0x80946b },
    );
    this.rockMaterial = this.createForestMaterial(
      'Broken_Rocks_baseColor.jpeg',
      'Broken_Rocks_normal.jpeg',
      'Broken_Rocks_metallicRoughness.png',
      { normalScale: 0.5, tint: 0x8e8a7e },
    );
    const fenceMaterial = new THREE.MeshStandardMaterial({
      color: 0x514431,
      map: this.loadForestTexture('Wood_Fence_baseColor.png', true, 3, 1),
      roughness: 0.96,
      metalness: 0,
    });

    this.roadGeometry = this.createStripGeometry(GAME.roadWidth, 220);
    this.roadMesh = new THREE.Mesh(this.roadGeometry, roadMaterial);
    this.roadMesh.receiveShadow = true;
    this.scene.add(this.roadMesh);

    this.shoulderGeometry = this.createStripGeometry(GAME.roadWidth + 5.5, 220);
    this.shoulderMesh = new THREE.Mesh(this.shoulderGeometry, shoulderMaterial);
    this.shoulderMesh.position.y = -0.055;
    this.shoulderMesh.receiveShadow = true;
    this.scene.add(this.shoulderMesh);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1200, 1200),
      groundMaterial,
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.09;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    const fenceSegments = 36;
    this.fencePosts = new THREE.InstancedMesh(this.fencePostGeometry, fenceMaterial, fenceSegments * 2);
    this.fenceRails = new THREE.InstancedMesh(this.fenceRailGeometry, fenceMaterial, fenceSegments * 2);
    this.fencePosts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fenceRails.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fencePosts.castShadow = true;
    this.fencePosts.receiveShadow = true;
    this.fenceRails.castShadow = true;
    this.fenceRails.receiveShadow = true;
    this.fencePosts.frustumCulled = false;
    this.fenceRails.frustumCulled = false;
    for (let index = 0; index < fenceSegments; index += 1) {
      this.fenceSlots.push({
        distance: -45 + index * 9.7,
        side: Math.floor(index / 6) % 2 === 0 ? -1 : 1,
      });
    }
    this.scene.add(this.fencePosts, this.fenceRails);

    this.setupLights();
    this.setupWorld();
    this.loadMapleTree();
    this.loadGreatMountain();
    this.scene.add(this.player);
    this.resize();
    window.addEventListener('resize', this.resize);
    this.animationFrame = requestAnimationFrame(this.animate);
  }

  start(): void {
    if (this.phase === 'crashed') this.reset();
    this.phase = 'playing';
    this.clock.getDelta();
  }

  pause(): void {
    if (this.phase === 'playing') {
      this.phase = 'paused';
      this.assistMessage = 'PAUSED';
    }
  }

  resume(): void {
    if (this.phase === 'paused') {
      this.phase = 'playing';
      this.clock.getDelta();
    }
  }

  reset(): void {
    this.distance = 0;
    this.speed = 0;
    this.lateral = laneOffsets[0];
    this.worldX = roadCenter(0) + Math.cos(roadHeading(0)) * laneOffsets[0];
    this.vehicleHeading = roadHeading(0);
    this.overtakes = 0;
    this.assistMessage = 'READY';
    this.phase = 'ready';
    this.setBrakeLights(this.player, false);
    let ongoingCursor = 45;
    let incomingCursor = 62;
    this.traffic.forEach((car, index) => {
      car.direction = index === 0 ? 1 : index === 1 ? -1 : Math.random() < 0.56 ? 1 : -1;
      if (car.direction === 1) {
        ongoingCursor += 34 + Math.random() * 48;
        this.spawnTraffic(car, ongoingCursor);
      } else {
        incomingCursor += 38 + Math.random() * 58;
        this.spawnTraffic(car, incomingCursor);
      }
    });
    this.scenery.forEach((object, index) => {
      object.userData.distance = -45 + index * 12.5;
    });
  }

  getPhase(): GamePhase {
    return this.phase;
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener('resize', this.resize);
    for (const texture of this.forestTextures) texture.dispose();
    this.renderer.dispose();
  }

  private loadForestTexture(
    file: string,
    colorTexture: boolean,
    repeatX = 1,
    repeatY = 1,
  ): THREE.Texture {
    const texture = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}forest/textures/${file}`);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    if (colorTexture) texture.colorSpace = THREE.SRGBColorSpace;
    this.forestTextures.push(texture);
    return texture;
  }

  private createForestMaterial(
    baseColor: string,
    normal: string,
    metallicRoughness: string,
    options: ForestMaterialOptions = {},
  ): THREE.MeshStandardMaterial {
    const repeatX = options.repeatX ?? 1;
    const repeatY = options.repeatY ?? 1;
    const surfaceMap = this.loadForestTexture(metallicRoughness, false, repeatX, repeatY);
    return new THREE.MeshStandardMaterial({
      color: options.tint ?? 0xffffff,
      map: this.loadForestTexture(baseColor, true, repeatX, repeatY),
      normalMap: this.loadForestTexture(normal, false, repeatX, repeatY),
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

  private setupLights(): void {
    const hemisphere = new THREE.HemisphereLight(0xdaf7ff, 0x31442c, 2.3);
    this.scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xfff1ce, 3.2);
    sun.position.set(-45, 75, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    sun.shadow.camera.left = -45;
    sun.shadow.camera.right = 45;
    sun.shadow.camera.top = 55;
    sun.shadow.camera.bottom = -25;
    this.scene.add(sun);

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
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }));
    sunSprite.scale.set(72, 72, 1);
    this.sunVisual.add(sunSprite);
    const sunCore = new THREE.Mesh(
      new THREE.SphereGeometry(7.5, 18, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff1a3, fog: false, depthTest: false }),
    );
    this.sunVisual.add(sunCore);
    this.scene.add(this.sunVisual);
  }

  private setupWorld(): void {
    const markerGeometry = new THREE.BoxGeometry(0.11, 0.022, 4.6);
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: 0xf0eee5,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
    });
    for (let index = 0; index < 38; index += 1) {
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.userData.slot = index;
      this.laneMarkers.push(marker);
      this.scene.add(marker);
    }

    for (let index = 0; index < 44; index += 1) {
      const object = index % 5 === 0 ? this.createRock() : this.createTree(index);
      object.userData.slot = index;
      object.userData.distance = -45 + index * 12.5;
      object.userData.side = index % 2 === 0 ? -1 : 1;
      object.userData.offset = GAME.roadWidth / 2 + 6 + ((index * 7) % 10);
      this.scenery.push(object);
      this.scene.add(object);
    }

    for (let index = 0; index < 7; index += 1) {
      const mountain = this.createMountain(index);
      mountain.userData.slot = index;
      this.mountains.push(mountain);
      this.scene.add(mountain);
    }

    const cloudTexture = this.createCloudTexture();
    for (let index = 0; index < 11; index += 1) {
      const cloud = new THREE.Sprite(new THREE.SpriteMaterial({
        map: cloudTexture,
        color: index % 3 === 0 ? 0xe8f2ef : 0xffffff,
        transparent: true,
        opacity: 0.58 + (index % 4) * 0.07,
        depthWrite: false,
        fog: false,
      }));
      const width = 54 + (index % 5) * 13;
      cloud.scale.set(width, width * (0.3 + (index % 2) * 0.04), 1);
      cloud.userData.baseX = -250 + index * 49;
      cloud.userData.height = 58 + (index % 4) * 15;
      cloud.userData.distanceOffset = 155 + (index % 3) * 68;
      cloud.userData.speed = (index % 2 === 0 ? 1 : -1) * (1.3 + (index % 4) * 0.42);
      this.clouds.push(cloud);
      this.scene.add(cloud);
    }

    let ongoingSpawnCursor = 45;
    let incomingSpawnCursor = 62;
    for (let index = 0; index < GAME.trafficCount; index += 1) {
      const direction: 1 | -1 = index === 0 ? 1 : index === 1 ? -1 : Math.random() < 0.56 ? 1 : -1;
      const car: TrafficCar = {
        mesh: this.createCar(carColors[index % carColors.length], false),
        distance: 0,
        lane: direction === 1 ? 0 : 1,
        speed: 0,
        targetSpeed: 0,
        speedChangeTimer: 0,
        direction,
        counted: false,
      };
      if (direction === 1) {
        ongoingSpawnCursor += 34 + Math.random() * 48;
        this.spawnTraffic(car, ongoingSpawnCursor);
      } else {
        incomingSpawnCursor += 38 + Math.random() * 58;
        this.spawnTraffic(car, incomingSpawnCursor);
      }
      this.traffic.push(car);
      this.scene.add(car.mesh);
    }
  }

  private createStripGeometry(width: number, segments: number, centerOffset = 0): THREE.BufferGeometry {
    const positions = new Float32Array((segments + 1) * 2 * 3);
    const uvs = new Float32Array((segments + 1) * 2 * 2);
    const indices: number[] = [];
    for (let index = 0; index <= segments; index += 1) {
      const uvOffset = index * 4;
      uvs[uvOffset] = 0;
      uvs[uvOffset + 1] = index / segments;
      uvs[uvOffset + 2] = 1;
      uvs[uvOffset + 3] = index / segments;
      if (index < segments) {
        const vertex = index * 2;
        indices.push(vertex, vertex + 1, vertex + 2, vertex + 2, vertex + 1, vertex + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.userData.width = width;
    geometry.userData.centerOffset = centerOffset;
    geometry.userData.uvWidth = Math.max(1, width / 9);
    geometry.userData.uvMeters = 11;
    return geometry;
  }

  private updateStrip(geometry: THREE.BufferGeometry, start: number, length: number): void {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    const segments = position.count / 2 - 1;
    const halfWidth = geometry.userData.width / 2;
    const centerOffset = geometry.userData.centerOffset as number;
    const uvWidth = geometry.userData.uvWidth as number;
    const uvMeters = geometry.userData.uvMeters as number;
    for (let index = 0; index <= segments; index += 1) {
      const distance = start + (index / segments) * length;
      const center = roadCenter(distance);
      const heading = roadHeading(distance);
      const sideX = Math.cos(heading);
      const sideZ = -Math.sin(heading);
      const vertex = index * 2;
      position.setXYZ(vertex, center + sideX * (centerOffset - halfWidth), 0, -distance + sideZ * (centerOffset - halfWidth));
      position.setXYZ(vertex + 1, center + sideX * (centerOffset + halfWidth), 0, -distance + sideZ * (centerOffset + halfWidth));
      uv.setXY(vertex, 0, distance / uvMeters);
      uv.setXY(vertex + 1, uvWidth, distance / uvMeters);
    }
    position.needsUpdate = true;
    uv.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }

  private createCar(color: number, player: boolean): THREE.Group {
    const group = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.22,
      metalness: 0.68,
      side: THREE.DoubleSide,
    });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0a0d11, roughness: 0.48, metalness: 0.32 });
    const carbon = new THREE.MeshStandardMaterial({ color: 0x151a1f, roughness: 0.32, metalness: 0.62 });
    const glass = new THREE.MeshStandardMaterial({
      color: player ? 0x315f6b : 0x3b5862,
      roughness: 0.08,
      metalness: 0.42,
      side: THREE.DoubleSide,
    });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xb9c4c7, roughness: 0.22, metalness: 0.9 });

    const bodyProfile: Array<[number, number]> = [
      [-2.28, 0.35], [-2.2, 0.76], [-1.7, 0.93], [-0.9, 1.02],
      [0.9, 0.98], [1.72, 0.82], [2.3, 0.5], [2.24, 0.33],
    ];
    const body = new THREE.Mesh(this.createCarProfileGeometry(bodyProfile, 2.02, 0.09, true), paint);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const canopyProfile: Array<[number, number]> = [
      [-1.03, 1.01], [-0.72, 1.54], [-0.42, 1.69], [0.47, 1.69], [1.05, 1.01],
    ];
    const canopy = new THREE.Mesh(this.createCarProfileGeometry(canopyProfile, 1.5, 0.045), glass);
    canopy.castShadow = true;
    group.add(canopy);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.1, 0.92), carbon);
    roof.position.set(0, 1.69, 0.08);
    roof.castShadow = true;
    group.add(roof);

    const frontPillar = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.075, 0.1), carbon);
    frontPillar.position.set(0, 1.36, -0.75);
    frontPillar.rotation.x = -0.55;
    group.add(frontPillar);
    const rearPillar = frontPillar.clone();
    rearPillar.position.set(0, 1.35, 0.73);
    rearPillar.rotation.x = 0.72;
    group.add(rearPillar);

    for (const x of [-1.02, 1.02]) {
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.17, 3.35), carbon);
      skirt.position.set(x, 0.43, 0.02);
      skirt.castShadow = true;
      group.add(skirt);

      const mirror = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 6), paint);
      mirror.scale.set(0.9, 0.45, 0.62);
      mirror.position.set(x * 1.05, 1.28, -0.43);
      mirror.castShadow = true;
      group.add(mirror);
    }

    const tireGeometry = new THREE.CylinderGeometry(0.44, 0.44, 0.32, 20);
    const rimGeometry = new THREE.CylinderGeometry(0.265, 0.265, 0.345, 18);
    const frontWheels: THREE.Group[] = [];
    for (const x of [-1.04, 1.04]) {
      for (const z of [-1.43, 1.39]) {
        const steeringPivot = new THREE.Group();
        steeringPivot.position.set(x, 0.48, z);
        const wheelAssembly = new THREE.Group();
        wheelAssembly.rotation.z = Math.PI / 2;
        const tire = new THREE.Mesh(tireGeometry, dark);
        tire.castShadow = true;
        wheelAssembly.add(tire);
        const rim = new THREE.Mesh(rimGeometry, chrome);
        wheelAssembly.add(rim);

        const outerFace = -Math.sign(x) * 0.19;
        for (let spokeIndex = 0; spokeIndex < 5; spokeIndex += 1) {
          const angle = (spokeIndex / 5) * Math.PI * 2;
          const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.035, 0.38), carbon);
          spoke.position.y = outerFace;
          spoke.rotation.y = angle;
          wheelAssembly.add(spoke);
        }
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.38, 12), carbon);
        wheelAssembly.add(hub);
        steeringPivot.add(wheelAssembly);
        group.add(steeringPivot);
        if (z < 0) frontWheels.push(steeringPivot);
      }
    }
    group.userData.frontWheels = frontWheels;

    const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.2, 0.18), carbon);
    frontBumper.position.set(0, 0.45, -2.28);
    group.add(frontBumper);
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 0.42), carbon);
    splitter.position.set(0, 0.31, -2.18);
    group.add(splitter);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.2, 0.035), dark);
    grille.position.set(0, 0.57, -2.385);
    group.add(grille);

    const headlightMaterial = new THREE.MeshBasicMaterial({ color: 0xd9ffff });
    const tailMaterial = new THREE.MeshStandardMaterial({
      color: 0x681015,
      emissive: 0x240003,
      emissiveIntensity: 0.7,
      roughness: 0.32,
    });
    group.userData.tailMaterial = tailMaterial;
    const rearLightPanel = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.27, 0.045), carbon);
    rearLightPanel.position.set(0, 0.78, 2.23);
    group.add(rearLightPanel);
    for (const x of [-0.66, 0.66]) {
      const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.15, 0.055), headlightMaterial);
      headlight.position.set(x, 0.74, -2.23);
      headlight.rotation.y = x * 0.08;
      group.add(headlight);

      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.15, 0.055), tailMaterial);
      tail.position.set(x, 0.8, 2.265);
      group.add(tail);
    }
    const centerTail = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.045, 0.04), tailMaterial);
    centerTail.position.set(0, 0.8, 2.27);
    group.add(centerTail);

    const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.26, 0.18), carbon);
    rearBumper.position.set(0, 0.48, 2.22);
    group.add(rearBumper);
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.12, 0.3), dark);
    diffuser.position.set(0, 0.32, 2.2);
    group.add(diffuser);
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.19, 0.025),
      new THREE.MeshBasicMaterial({ color: 0xe8ece7 }),
    );
    plate.position.set(0, 0.63, 2.325);
    group.add(plate);

    for (const x of [-0.63, 0.63]) {
      const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.27, 12), chrome);
      exhaust.rotation.x = Math.PI / 2;
      exhaust.position.set(x, 0.32, 2.34);
      group.add(exhaust);
    }

    if (player) {
      const brakeGlow = new THREE.PointLight(0xff1824, 0, 7, 2);
      brakeGlow.position.set(0, 0.58, 2.55);
      group.userData.brakeGlow = brakeGlow;
      group.add(brakeGlow);

      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.1, 0.34), carbon);
      wing.position.set(0, 1.18, 1.78);
      wing.castShadow = true;
      group.add(wing);
      for (const x of [-0.57, 0.57]) {
        const support = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.33, 0.08), carbon);
        support.position.set(x, 1.03, 1.76);
        group.add(support);
      }
    }

    group.scale.setScalar(player ? 1 : 0.93 + Math.random() * 0.12);
    return group;
  }

  private setBrakeLights(car: THREE.Group, braking: boolean): void {
    const material = car.userData.tailMaterial as THREE.MeshStandardMaterial | undefined;
    if (material) {
      material.color.setHex(braking ? 0xff1d29 : 0x681015);
      material.emissive.setHex(braking ? 0xff0712 : 0x240003);
      material.emissiveIntensity = braking ? 4.5 : 0.7;
    }
    const glow = car.userData.brakeGlow as THREE.PointLight | undefined;
    if (glow) glow.intensity = braking ? 4.2 : 0;
  }

  private createCarProfileGeometry(
    profile: Array<[number, number]>,
    width: number,
    bevel: number,
    taperEnds = false,
  ): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(profile[0][0], profile[0][1]);
    for (let index = 1; index < profile.length; index += 1) shape.lineTo(profile[index][0], profile[index][1]);
    shape.lineTo(profile[0][0], profile[0][1]);

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: width,
      steps: 1,
      curveSegments: 1,
      bevelEnabled: true,
      bevelSegments: 1,
      bevelSize: bevel,
      bevelThickness: bevel,
    });
    geometry.translate(0, 0, -width / 2);
    if (taperEnds) {
      const position = geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let index = 0; index < position.count; index += 1) {
        const profilePosition = position.getX(index);
        const taper = 1 - Math.max(0, Math.abs(profilePosition) - 1.05) * 0.11;
        position.setZ(index, position.getZ(index) * taper);
      }
      position.needsUpdate = true;
    }
    geometry.rotateY(Math.PI / 2);
    geometry.computeVertexNormals();
    return geometry;
  }

  private loadMapleTree(): void {
    const loader = new GLTFLoader();
    loader.load(
      `${import.meta.env.BASE_URL}maple_tree/scene.gltf`,
      (gltf) => {
        try {
          const sourceTree = gltf.scene.getObjectByName('instance_0');
          if (!sourceTree) throw new Error('The maple tree root node was not found.');

          gltf.scene.updateMatrixWorld(true);
          const buckets = new Map<string, {
            material: THREE.MeshStandardMaterial;
            geometries: THREE.BufferGeometry[];
          }>();

          sourceTree.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            const sourceMaterial = Array.isArray(object.material) ? object.material[0] : object.material;
            const key = sourceMaterial.name || `material-${sourceMaterial.id}`;
            let bucket = buckets.get(key);

            if (!bucket) {
              const material = sourceMaterial.clone() as THREE.MeshStandardMaterial;
              material.metalness = 0;
              material.roughness = key.includes('leaf') ? 0.88 : 0.96;
              material.aoMap = null;
              material.emissiveMap = null;
              material.emissive?.set(0x000000);
              if (key.includes('leaf')) {
                material.side = THREE.DoubleSide;
                material.map = material.map ? this.createCleanLeafTexture(material.map) : null;
                material.alphaMap = null;
                material.color.set(0x9ab08f);
                material.alphaTest = 0.38;
                material.transparent = false;
                material.depthWrite = true;
              }
              bucket = { material, geometries: [] };
              buckets.set(key, bucket);
            }

            const transformed = object.geometry.clone();
            transformed.applyMatrix4(object.matrixWorld);
            let geometry = transformed;
            if (transformed.index) {
              geometry = transformed.toNonIndexed();
              transformed.dispose();
            }
            for (const attribute of Object.keys(geometry.attributes)) {
              if (!['position', 'normal', 'uv'].includes(attribute)) geometry.deleteAttribute(attribute);
            }
            if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
            bucket.geometries.push(geometry);
          });

          const content = new THREE.Group();
          for (const bucket of buckets.values()) {
            const merged = mergeGeometries(bucket.geometries, false);
            bucket.geometries.forEach((geometry) => geometry.dispose());
            if (!merged) continue;
            merged.computeBoundingBox();
            merged.computeBoundingSphere();
            const mesh = new THREE.Mesh(merged, bucket.material);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            content.add(mesh);
          }

          if (content.children.length === 0) throw new Error('The maple tree geometry could not be merged.');
          const bounds = new THREE.Box3().setFromObject(content);
          const size = bounds.getSize(new THREE.Vector3());
          const center = bounds.getCenter(new THREE.Vector3());
          content.position.set(-center.x, -bounds.min.y, -center.z);

          const prototype = new THREE.Group();
          prototype.scale.setScalar(10 / Math.max(1, size.y));
          prototype.add(content);
          this.mapleTreePrototype = prototype;

          for (const object of this.scenery) {
            if (object.userData.kind !== 'maple-tree') continue;
            object.clear();
            object.add(prototype.clone(true));
          }
        } catch (error) {
          console.error('Could not prepare the maple tree model.', error);
        }
      },
      undefined,
      (error) => console.error('Could not load the maple tree model.', error),
    );
  }

  private createCleanLeafTexture(source: THREE.Texture): THREE.CanvasTexture | null {
    const image = source.image as CanvasImageSource & { width?: number; height?: number };
    const width = image?.width ?? 0;
    const height = image?.height ?? 0;
    if (!width || !height) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;

    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const red = pixels.data[index];
      const green = pixels.data[index + 1];
      const blue = pixels.data[index + 2];
      const minimum = Math.min(red, green, blue);
      const maximum = Math.max(red, green, blue);
      const neutralBackground = minimum > 150 && maximum - minimum < 46;
      const alpha = neutralBackground ? clamp((210 - minimum) * 6, 0, 255) : 255;
      if (alpha < 255) {
        // Keep transparent texels forest-green so generated mipmaps cannot
        // blend the source image's white background into leaf edges.
        pixels.data[index] = 38;
        pixels.data[index + 1] = 66;
        pixels.data[index + 2] = 28;
      }
      pixels.data[index + 3] = alpha;
    }
    context.putImageData(pixels, 0, 0);

    const cleanTexture = new THREE.CanvasTexture(canvas);
    cleanTexture.colorSpace = source.colorSpace;
    cleanTexture.flipY = source.flipY;
    cleanTexture.wrapS = source.wrapS;
    cleanTexture.wrapT = source.wrapT;
    cleanTexture.magFilter = source.magFilter;
    cleanTexture.minFilter = source.minFilter;
    cleanTexture.anisotropy = source.anisotropy;
    cleanTexture.channel = source.channel;
    cleanTexture.needsUpdate = true;
    this.forestTextures.push(cleanTexture);
    return cleanTexture;
  }

  private createTree(_index: number): THREE.Group {
    const group = new THREE.Group();
    group.userData.kind = 'maple-tree';
    if (this.mapleTreePrototype) group.add(this.mapleTreePrototype.clone(true));
    return group;
  }

  private createRock(): THREE.Group {
    const group = new THREE.Group();
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1.25, 0),
      this.rockMaterial,
    );
    rock.scale.set(1.2, 0.7, 0.9);
    rock.position.y = 0.7;
    rock.castShadow = true;
    group.add(rock);
    return group;
  }

  private loadGreatMountain(): void {
    const loader = new GLTFLoader();
    loader.load(
      `${import.meta.env.BASE_URL}great_mountain/scene.gltf`,
      (gltf) => {
        try {
          gltf.scene.updateMatrixWorld(true);
          const source = gltf.scene.getObjectByName('Object_2');
          if (!(source instanceof THREE.Mesh)) throw new Error('The mountain mesh was not found.');

          const geometry = source.geometry.clone();
          geometry.applyMatrix4(source.matrixWorld);
          geometry.computeBoundingBox();
          const bounds = geometry.boundingBox;
          if (!bounds) throw new Error('The mountain bounds could not be calculated.');
          const size = bounds.getSize(new THREE.Vector3());
          const center = bounds.getCenter(new THREE.Vector3());
          geometry.translate(-center.x, -bounds.min.y, -center.z);
          geometry.computeBoundingSphere();

          const sourceMaterial = Array.isArray(source.material) ? source.material[0] : source.material;
          const material = sourceMaterial.clone() as THREE.MeshStandardMaterial;
          material.color.set(0x8999a3);
          material.metalness = 0;
          material.roughness = 1;
          material.emissiveMap = null;
          material.emissive?.set(0x000000);

          const mesh = new THREE.Mesh(geometry, material);
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          const prototype = new THREE.Group();
          prototype.scale.setScalar(52 / Math.max(1, size.y));
          prototype.add(mesh);
          this.greatMountainPrototype = prototype;

          for (const mountain of this.mountains) {
            mountain.clear();
            mountain.add(prototype.clone(true));
          }
        } catch (error) {
          console.error('Could not prepare the great mountain model.', error);
        }
      },
      undefined,
      (error) => console.error('Could not load the great mountain model.', error),
    );
  }

  private createMountain(_index: number): THREE.Group {
    const group = new THREE.Group();
    if (this.greatMountainPrototype) group.add(this.greatMountainPrototype.clone(true));
    return group;
  }

  private createCloudTexture(): THREE.CanvasTexture {
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

  private spawnTraffic(car: TrafficCar, ahead?: number, randomizeDirection = false): void {
    if (randomizeDirection) car.direction = Math.random() < 0.56 ? 1 : -1;
    const furthest = this.traffic
      .filter((other) => other !== car && other.direction === car.direction)
      .reduce((max, other) => Math.max(max, other.distance), this.distance + 120);
    car.distance = ahead ?? furthest + 48 + Math.random() * 95;
    car.lane = car.direction === 1 ? 0 : 1;
    car.speed = car.direction === 1 ? 20 + Math.random() * 16 : 24 + Math.random() * 12;
    car.targetSpeed = car.speed;
    car.speedChangeTimer = 2.5 + Math.random() * 6;
    car.counted = false;
  }

  private updateSimulation(dt: number): void {
    const control = this.getControl();
    const curveLimit = curveSpeedLimit(this.distance, GAME.maxSpeed, GAME.minCurveSpeed);
    let targetSpeed = curveLimit;
    let leadDistance = Number.POSITIVE_INFINITY;
    let leadIsIncoming = false;

    for (const car of this.traffic) {
      const gap = car.distance - this.distance;
      const laneGap = Math.abs(laneOffsets[car.lane] - this.lateral);
      if (gap > 0 && gap < leadDistance && laneGap < 2.35) {
        leadDistance = gap;
        leadIsIncoming = car.direction === -1;
        if (car.direction === -1 && gap < 95) {
          targetSpeed = Math.min(targetSpeed, GAME.maxSpeed * clamp((gap - 13) / 55, 0, 1));
        } else if (car.direction === 1 && gap < 58) {
          targetSpeed = Math.min(targetSpeed, car.speed * clamp((gap - 7) / 28, 0, 1));
        }
      }
    }

    if (!control.active) {
      targetSpeed = 0;
      this.assistMessage = 'HANDS LOST · AUTO BRAKE';
    } else if (leadIsIncoming && leadDistance < 70) {
      this.assistMessage = leadDistance < 28 ? 'ONCOMING · EMERGENCY BRAKE' : 'ONCOMING VEHICLE';
    } else if (leadDistance < 32) {
      this.assistMessage = leadDistance < 15 ? 'EMERGENCY BRAKE' : 'TRAFFIC ASSIST';
    } else if (curveLimit < GAME.maxSpeed - 4) {
      this.assistMessage = 'CURVE ASSIST';
    } else {
      this.assistMessage = 'CRUISING';
    }

    const acceleration = targetSpeed > this.speed
      ? GAME.acceleration
      : leadDistance < 15 || (leadIsIncoming && leadDistance < 32) ? GAME.emergencyBrake : GAME.serviceBrake;
    this.setBrakeLights(this.player, targetSpeed < this.speed - 0.35);
    this.speed = damp(this.speed, targetSpeed, acceleration / Math.max(8, Math.abs(targetSpeed - this.speed)), dt);
    if (targetSpeed === 0 && this.speed < 0.3) this.speed = 0;

    this.steeringVisual = damp(this.steeringVisual, control.steering, 10, dt);
    const steeringAuthority = 0.28 + 0.72 * clamp(this.speed / 18, 0, 1);
    this.vehicleHeading -= this.steeringVisual * 0.82 * steeringAuthority * dt;
    this.worldX += -Math.sin(this.vehicleHeading) * this.speed * dt;
    this.distance += Math.max(0.12, Math.cos(this.vehicleHeading)) * this.speed * dt;

    const currentRoadHeading = roadHeading(this.distance);
    const currentRoadCenter = roadCenter(this.distance);
    const roadConstraint = constrainToRoad(
      this.worldX,
      currentRoadCenter,
      currentRoadHeading,
      GAME.roadWidth,
      1.25,
    );
    this.worldX = roadConstraint.worldX;
    this.lateral = roadConstraint.lateral;
    const boundaryLimit = GAME.roadWidth / 2 - 1.25;
    const edgeProximity = clamp((Math.abs(this.lateral) - (boundaryLimit - 1.6)) / 1.6, 0, 1);
    if (edgeProximity > 0) {
      const relativeHeading = Math.atan2(
        Math.sin(this.vehicleHeading - currentRoadHeading),
        Math.cos(this.vehicleHeading - currentRoadHeading),
      );
      const pointsOutward =
        (this.lateral > 0 && relativeHeading < 0) ||
        (this.lateral < 0 && relativeHeading > 0);
      if (pointsOutward) {
        const softenedHeading = damp(relativeHeading, 0, 2.5 + edgeProximity * 5.5, dt);
        this.vehicleHeading = currentRoadHeading + softenedHeading;
        this.speed = Math.max(0, this.speed - (2 + edgeProximity * 5) * dt);
      }
      this.assistMessage = 'ROAD EDGE';
      if (edgeProximity > 0.55) this.setBrakeLights(this.player, true);
    }

    for (const car of this.traffic) {
      car.speedChangeTimer -= dt;
      if (car.speedChangeTimer <= 0) {
        car.targetSpeed = car.direction === 1 ? 19 + Math.random() * 18 : 23 + Math.random() * 14;
        car.speedChangeTimer = 2.5 + Math.random() * 7;
      }
      let trafficTargetSpeed = car.targetSpeed;
      for (const other of this.traffic) {
        if (other === car || other.direction !== car.direction || other.lane !== car.lane) continue;
        const forwardGap = (other.distance - car.distance) * car.direction;
        if (forwardGap > 0 && forwardGap < 22) {
          trafficTargetSpeed = Math.min(trafficTargetSpeed, other.speed * clamp((forwardGap - 5) / 12, 0, 1));
        }
      }
      car.speed = damp(car.speed, trafficTargetSpeed, 1.25, dt);
      car.distance += car.speed * car.direction * dt;
      const gap = car.distance - this.distance;
      const laneGap = Math.abs(laneOffsets[car.lane] - this.lateral);
      if (car.direction === 1 && !car.counted && gap < -GAME.collisionLength) {
        car.counted = true;
        this.overtakes += 1;
      }
      if (Math.abs(gap) < GAME.collisionLength && laneGap < GAME.collisionWidth) {
        this.phase = 'crashed';
        this.speed = 0;
        this.setBrakeLights(this.player, true);
        this.assistMessage = 'COLLISION';
        this.onCrash();
        break;
      }
      if (gap < (car.direction === -1 ? -45 : -70)) this.spawnTraffic(car, undefined, true);
    }
  }

  private updateRoadsideFences(): void {
    const segmentLength = 9.7;
    const ringLength = this.fenceSlots.length * segmentLength;
    const offsetMagnitude = GAME.roadWidth / 2 + 1.75;
    let postIndex = 0;
    let railIndex = 0;

    const setInstance = (
      mesh: THREE.InstancedMesh,
      index: number,
      distance: number,
      side: -1 | 1,
      height: number,
    ): void => {
      const heading = roadHeading(distance);
      const offset = side * offsetMagnitude;
      this.fenceDummy.position.set(
        roadCenter(distance) + Math.cos(heading) * offset,
        height,
        -distance - Math.sin(heading) * offset,
      );
      this.fenceDummy.rotation.set(0, heading, 0);
      this.fenceDummy.scale.set(1, 1, 1);
      this.fenceDummy.updateMatrix();
      mesh.setMatrixAt(index, this.fenceDummy.matrix);
    };

    for (const slot of this.fenceSlots) {
      if (slot.distance < this.distance - 65) slot.distance += ringLength;
      const midpoint = slot.distance + segmentLength / 2;
      setInstance(this.fencePosts, postIndex, slot.distance, slot.side, 0.57);
      setInstance(this.fencePosts, postIndex + 1, slot.distance + segmentLength, slot.side, 0.57);
      setInstance(this.fenceRails, railIndex, midpoint, slot.side, 0.48);
      setInstance(this.fenceRails, railIndex + 1, midpoint, slot.side, 0.91);
      postIndex += 2;
      railIndex += 2;
    }

    this.fencePosts.instanceMatrix.needsUpdate = true;
    this.fenceRails.instanceMatrix.needsUpdate = true;
  }

  private updateWorld(dt: number): void {
    const start = Math.max(-40, this.distance - GAME.lookBehind);
    const length = GAME.lookAhead + GAME.lookBehind + 150;
    this.updateStrip(this.shoulderGeometry, start, length);
    this.updateStrip(this.roadGeometry, start, length);
    this.updateRoadsideFences();

    const centerX = roadCenter(this.distance);
    this.player.position.set(this.worldX, 0.02, -this.distance);
    this.player.rotation.y = this.vehicleHeading;
    this.player.rotation.z = damp(this.player.rotation.z, -this.steeringVisual * 0.06, 6, dt);
    const playerFrontWheels = this.player.userData.frontWheels as THREE.Group[];
    for (const wheel of playerFrontWheels) {
      wheel.rotation.y = damp(wheel.rotation.y, -this.steeringVisual * 0.48, 14, dt);
    }

    for (const car of this.traffic) {
      const carHeading = roadHeading(car.distance);
      const offset = laneOffsets[car.lane];
      car.mesh.position.set(
        roadCenter(car.distance) + Math.cos(carHeading) * offset,
        0.02,
        -car.distance - Math.sin(carHeading) * offset,
      );
      car.mesh.rotation.y = carHeading + (car.direction === -1 ? Math.PI : 0);
    }

    const markerBase = Math.floor((this.distance - 35) / 12) * 12;
    for (const marker of this.laneMarkers) {
      const slot = marker.userData.slot as number;
      const distance = markerBase + slot * 12;
      const markerHeading = roadHeading(distance);
      marker.position.set(
        roadCenter(distance),
        0.025,
        -distance,
      );
      marker.rotation.y = markerHeading;
    }

    for (const object of this.scenery) {
      const slot = object.userData.slot as number;
      let distance = object.userData.distance as number;
      if (distance < this.distance - 70) {
        distance += this.scenery.length * 12.5;
        object.userData.distance = distance;
      }
      const headingAtObject = roadHeading(distance);
      const offset = (object.userData.side as number) * (object.userData.offset as number);
      object.position.set(
        roadCenter(distance) + Math.cos(headingAtObject) * offset,
        0,
        -distance - Math.sin(headingAtObject) * offset,
      );
      object.rotation.y = (slot * 2.39) % (Math.PI * 2);
      const scale = 0.72 + (slot % 5) * 0.11;
      object.scale.setScalar(scale);
    }

    for (const mountain of this.mountains) {
      const slot = mountain.userData.slot as number;
      const row = slot % 2;
      const distance = this.distance + 270 + row * 88;
      const horizonOffset = (slot - 3) * 88 + (row === 0 ? -18 : 24);
      mountain.position.set(roadCenter(distance) + horizonOffset, -6, -distance);
      mountain.rotation.y = roadHeading(distance) * 0.25 + slot * 0.71;
      mountain.scale.setScalar(0.78 + (slot % 3) * 0.12);
    }

    const sunDistance = this.distance + 350;
    this.sunVisual.position.set(roadCenter(sunDistance) - 92, 102, -sunDistance);

    const cloudTime = performance.now() * 0.001;
    for (const cloud of this.clouds) {
      const cloudDistance = this.distance + (cloud.userData.distanceOffset as number);
      const drift = (cloud.userData.baseX as number) + cloudTime * (cloud.userData.speed as number);
      const wrappedX = ((drift + 270) % 540 + 540) % 540 - 270;
      cloud.position.set(
        roadCenter(cloudDistance) + wrappedX,
        cloud.userData.height as number,
        -cloudDistance,
      );
    }

    this.ground.position.set(centerX, -0.09, -this.distance - 180);
    const groundMaterial = this.ground.material as THREE.MeshStandardMaterial;
    const groundTextures = [
      groundMaterial.map,
      groundMaterial.normalMap,
      groundMaterial.roughnessMap,
      groundMaterial.metalnessMap,
    ];
    // PlaneGeometry's V axis points toward negative world Z after the ground is
    // rotated flat. Offset from the plane's world position so recentering the
    // large ground mesh never makes its texture travel with the player.
    for (const texture of groundTextures) {
      texture?.offset.set(this.ground.position.x / 20.7, -this.ground.position.z / 20.7);
    }

    const forward = new THREE.Vector3(-Math.sin(this.vehicleHeading), 0, -Math.cos(this.vehicleHeading));
    const desiredCamera = this.player.position.clone().addScaledVector(forward, -11.5).add(new THREE.Vector3(0, 6.1, 0));
    this.camera.position.lerp(desiredCamera, 1 - Math.exp(-5 * dt));
    const target = this.player.position.clone().addScaledVector(forward, 16).add(new THREE.Vector3(0, 1.2, 0));
    this.camera.lookAt(target);
  }

  private animate = (): void => {
    this.animationFrame = requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.phase === 'playing') this.updateSimulation(dt);
    this.updateWorld(dt);
    this.renderer.render(this.scene, this.camera);
    this.frame += 1;

    const now = performance.now();
    if (now - this.lastSnapshot > 80) {
      this.lastSnapshot = now;
      this.onUpdate({
        speedKph: this.speed * 3.6,
        distance: this.distance,
        overtakes: this.overtakes,
        score: Math.floor(this.distance + this.overtakes * 250),
        phase: this.phase,
        assistMessage: this.assistMessage,
      });
    }
  };

  private resize = (): void => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };
}
