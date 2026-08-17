import * as THREE from 'three';
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
  private readonly sunVisual = new THREE.Group();
  private readonly roadGeometry: THREE.BufferGeometry;
  private readonly roadMesh: THREE.Mesh;
  private readonly shoulderGeometry: THREE.BufferGeometry;
  private readonly shoulderMesh: THREE.Mesh;
  private readonly edgeGeometries: THREE.BufferGeometry[] = [];
  private readonly edgeMeshes: THREE.Mesh[] = [];
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
    this.scene.background = new THREE.Color(0x90bfd0);
    this.scene.fog = new THREE.FogExp2(0x90bfd0, 0.0044);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.roadGeometry = this.createStripGeometry(GAME.roadWidth, 220);
    this.roadMesh = new THREE.Mesh(
      this.roadGeometry,
      new THREE.MeshStandardMaterial({ color: 0x1c252c, roughness: 0.94, metalness: 0.03 }),
    );
    this.roadMesh.receiveShadow = true;
    this.scene.add(this.roadMesh);

    this.shoulderGeometry = this.createStripGeometry(GAME.roadWidth + 1.25, 220);
    this.shoulderMesh = new THREE.Mesh(
      this.shoulderGeometry,
      new THREE.MeshStandardMaterial({ color: 0xb89c58, roughness: 1 }),
    );
    this.shoulderMesh.position.y = -0.045;
    this.shoulderMesh.receiveShadow = true;
    this.scene.add(this.shoulderMesh);

    const edgeMaterial = new THREE.MeshBasicMaterial({ color: 0xf5e8b1 });
    for (const offset of [-GAME.roadWidth / 2 + 0.38, GAME.roadWidth / 2 - 0.38]) {
      const geometry = this.createStripGeometry(0.22, 220, offset);
      const edge = new THREE.Mesh(geometry, edgeMaterial);
      edge.position.y = 0.035;
      edge.renderOrder = 2;
      this.edgeGeometries.push(geometry);
      this.edgeMeshes.push(edge);
      this.scene.add(edge);
    }

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1200, 1200),
      new THREE.MeshStandardMaterial({ color: 0x547b45, roughness: 1 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.09;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.setupLights();
    this.setupWorld();
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
      object.userData.distance = -45 + index * 17;
    });
  }

  getPhase(): GamePhase {
    return this.phase;
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener('resize', this.resize);
    this.renderer.dispose();
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
    const markerGeometry = new THREE.BoxGeometry(0.13, 0.025, 5.4);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xf7f3d0 });
    for (let index = 0; index < 38; index += 1) {
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.userData.slot = index;
      this.laneMarkers.push(marker);
      this.scene.add(marker);
    }

    for (let index = 0; index < 44; index += 1) {
      const object = index % 5 === 0 ? this.createRock() : this.createTree(index);
      object.userData.slot = index;
      object.userData.distance = -45 + index * 17;
      object.userData.side = index % 2 === 0 ? -1 : 1;
      object.userData.offset = GAME.roadWidth / 2 + 5 + ((index * 7) % 11);
      this.scenery.push(object);
      this.scene.add(object);
    }

    for (let index = 0; index < 17; index += 1) {
      const mountain = this.createMountain(index);
      mountain.userData.slot = index;
      this.mountains.push(mountain);
      this.scene.add(mountain);
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
    return geometry;
  }

  private updateStrip(geometry: THREE.BufferGeometry, start: number, length: number): void {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const segments = position.count / 2 - 1;
    const halfWidth = geometry.userData.width / 2;
    const centerOffset = geometry.userData.centerOffset as number;
    for (let index = 0; index <= segments; index += 1) {
      const distance = start + (index / segments) * length;
      const center = roadCenter(distance);
      const heading = roadHeading(distance);
      const sideX = Math.cos(heading);
      const sideZ = -Math.sin(heading);
      const vertex = index * 2;
      position.setXYZ(vertex, center + sideX * (centerOffset - halfWidth), 0, -distance + sideZ * (centerOffset - halfWidth));
      position.setXYZ(vertex + 1, center + sideX * (centerOffset + halfWidth), 0, -distance + sideZ * (centerOffset + halfWidth));
    }
    position.needsUpdate = true;
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

  private createTree(index: number): THREE.Group {
    const group = new THREE.Group();
    const trunkColor = [0x68452f, 0x775039, 0x5b3d2c][index % 3];
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.34, index % 4 === 0 ? 3.2 : 2.45, 7),
      new THREE.MeshStandardMaterial({ color: trunkColor, roughness: 1, flatShading: true }),
    );
    trunk.position.y = index % 4 === 0 ? 1.6 : 1.22;
    trunk.castShadow = true;
    group.add(trunk);

    if (index % 4 === 0) {
      const leafColors = [0x477d42, 0x568b48, 0x3f713b];
      const clusters = [
        [-0.65, 3.5, 0.12, 1.2], [0.58, 3.62, -0.05, 1.12],
        [0.05, 4.25, 0.08, 1.35], [0.05, 3.48, 0.62, 0.94],
      ];
      for (let clusterIndex = 0; clusterIndex < clusters.length; clusterIndex += 1) {
        const [x, y, z, scale] = clusters[clusterIndex];
        const crown = new THREE.Mesh(
          new THREE.IcosahedronGeometry(scale, 1),
          new THREE.MeshStandardMaterial({
            color: leafColors[(index + clusterIndex) % leafColors.length],
            roughness: 1,
            flatShading: true,
          }),
        );
        crown.position.set(x, y, z);
        crown.scale.y = 0.82 + clusterIndex * 0.04;
        crown.rotation.set(clusterIndex * 0.3, index * 0.7, clusterIndex * 0.22);
        crown.castShadow = true;
        group.add(crown);
      }
    } else {
      const green = [0x2f673c, 0x3e7b43, 0x295b38][index % 3];
      for (let layer = 0; layer < 4; layer += 1) {
        const crown = new THREE.Mesh(
          new THREE.ConeGeometry(1.62 - layer * 0.23, 2.45, 8),
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(green).offsetHSL(layer * 0.008, 0, layer * 0.018),
            roughness: 1,
            flatShading: true,
          }),
        );
        crown.position.y = 2.25 + layer * 0.88;
        crown.rotation.y = layer * 0.63 + index;
        crown.scale.x = 0.9 + ((index + layer) % 3) * 0.06;
        crown.castShadow = true;
        group.add(crown);
      }
    }
    return group;
  }

  private createRock(): THREE.Group {
    const group = new THREE.Group();
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1.25, 0),
      new THREE.MeshStandardMaterial({ color: 0x7a8174, roughness: 1 }),
    );
    rock.scale.set(1.2, 0.7, 0.9);
    rock.position.y = 0.7;
    rock.castShadow = true;
    group.add(rock);
    return group;
  }

  private createMountain(index: number): THREE.Group {
    const group = new THREE.Group();
    const palette = [0x4c6270, 0x607684, 0x405865, 0x71828a];
    const radius = 34 + (index % 4) * 8;
    const height = 38 + (index % 5) * 7;
    const mountain = new THREE.Mesh(
      this.createMountainGeometry(radius, height, index * 1.73),
      new THREE.MeshStandardMaterial({
        color: palette[index % palette.length],
        roughness: 1,
        flatShading: true,
      }),
    );
    mountain.position.y = height / 2 - 1;
    mountain.rotation.y = (index * 1.73) % Math.PI;
    group.add(mountain);

    if (index % 3 !== 1) {
      const snow = new THREE.Mesh(
        this.createMountainGeometry(radius * 0.35, height * 0.25, index * 2.31 + 4),
        new THREE.MeshStandardMaterial({ color: 0xdce9e8, roughness: 0.95, flatShading: true }),
      );
      snow.position.y = height * 0.88;
      snow.rotation.y = mountain.rotation.y;
      group.add(snow);
    }
    return group;
  }

  private createMountainGeometry(radius: number, height: number, seed: number): THREE.ConeGeometry {
    const geometry = new THREE.ConeGeometry(radius, height, 8, 3);
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const z = position.getZ(index);
      const angle = Math.atan2(z, x);
      const irregularity = 1 + Math.sin(angle * 3 + seed) * 0.1 + Math.cos(angle * 5 - seed) * 0.055;
      position.setX(index, x * irregularity);
      position.setZ(index, z * irregularity);
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
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

  private updateWorld(dt: number): void {
    const start = Math.max(-40, this.distance - GAME.lookBehind);
    const length = GAME.lookAhead + GAME.lookBehind + 150;
    this.updateStrip(this.shoulderGeometry, start, length);
    this.updateStrip(this.roadGeometry, start, length);
    for (const edgeGeometry of this.edgeGeometries) this.updateStrip(edgeGeometry, start, length);

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
        distance += this.scenery.length * 17;
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
      const row = slot % 3;
      const distance = this.distance + 245 + row * 74;
      const horizonOffset = (slot - 8) * 31 + (row - 1) * 12;
      mountain.position.x = roadCenter(distance) + horizonOffset;
      mountain.position.z = -distance;
      mountain.rotation.y = roadHeading(distance) * 0.25;
    }

    const sunDistance = this.distance + 350;
    this.sunVisual.position.set(roadCenter(sunDistance) - 92, 102, -sunDistance);

    this.ground.position.set(centerX, -0.09, -this.distance - 180);

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
