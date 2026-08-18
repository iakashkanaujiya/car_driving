import * as THREE from 'three';
import { GAME, laneOffsets } from './config';
import { clamp, constrainToRoad, curveSpeedLimit, damp, roadCenter, roadHeading } from './math';
import { createRoadStrip, updateRoadStrip } from './roadSurface';
import { SceneryAssets } from './sceneryAssets';
import { addSceneLighting, createCloudTexture, ForestTextureStore } from './sceneAssets';
import type { CarStyle, ControlInput, GamePhase, GameSnapshot } from './types';
import { VehicleAssets } from './vehicleAssets';

interface TrafficCar {
  mesh: THREE.Group;
  distance: number;
  lane: number;
  laneOffset: number;
  speed: number;
  targetSpeed: number;
  speedChangeTimer: number;
  direction: 1 | -1;
  counted: boolean;
  horned: boolean;
}

export class DrivingGame {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.1, 800);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly clock = new THREE.Clock();
  private readonly vehicleAssets = new VehicleAssets();
  private readonly player = this.vehicleAssets.createCartoonCar(0xe9ff42, true);
  private readonly traffic: TrafficCar[] = [];
  private readonly laneMarkers: THREE.Mesh[] = [];
  private readonly scenery: THREE.Group[] = [];
  private readonly mountains: THREE.Group[] = [];
  private readonly clouds: THREE.Sprite[] = [];
  private readonly sunVisual: THREE.Group;
  private readonly textureStore: ForestTextureStore;
  private readonly sceneryAssets: SceneryAssets;
  private readonly fenceSlots: Array<{ distance: number; side: -1 | 1 }> = [];
  private readonly fencePostGeometry = new THREE.BoxGeometry(0.2, 1.15, 0.2);
  private readonly fenceRailGeometry = new THREE.BoxGeometry(0.16, 0.17, 9.7);
  private readonly fenceDummy = new THREE.Object3D();
  private readonly fencePosts: THREE.InstancedMesh;
  private readonly fenceRails: THREE.InstancedMesh;
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
  private hornCooldown = 0;
  private carStyle: CarStyle = 'cartoon';
  private carModelsLoading = false;
  private lastSnapshot = 0;
  private animationFrame = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly getControl: () => ControlInput,
    private readonly onUpdate: (snapshot: GameSnapshot) => void,
    private readonly onCrash: () => void,
    private readonly onHorn: () => void,
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

    this.textureStore = new ForestTextureStore(this.renderer.capabilities.getMaxAnisotropy());

    const roadMaterial = this.textureStore.createMaterial(
      'Dirt_Road_Bare_baseColor.png',
      'Dirt_Road_Bare_normal.png',
      'Dirt_Road_Bare_metallicRoughness.png',
      { normalScale: 0.48, tint: 0x8b98a5 },
    );
    const shoulderMaterial = this.textureStore.createMaterial(
      'Ground_Dirt_baseColor.jpeg',
      'Ground_Dirt_normal.jpeg',
      'Ground_Dirt_metallicRoughness.png',
      { normalScale: 0.42, tint: 0x8f8068 },
    );
    const groundMaterial = this.textureStore.createMaterial(
      'Grass_Close_baseColor.png',
      'Grass_Close_normal.jpeg',
      'Grass_Close_metallicRoughness.png',
      { repeatX: 58, repeatY: 58, normalScale: 0.36, tint: 0x80946b },
    );
    const rockMaterial = this.textureStore.createMaterial(
      'Broken_Rocks_baseColor.jpeg',
      'Broken_Rocks_normal.jpeg',
      'Broken_Rocks_metallicRoughness.png',
      { normalScale: 0.5, tint: 0x8e8a7e },
    );
    this.sceneryAssets = new SceneryAssets(this.textureStore, rockMaterial);
    const fenceMaterial = new THREE.MeshStandardMaterial({
      color: 0x514431,
      map: this.textureStore.load('Wood_Fence_baseColor.png', true, 3, 1),
      roughness: 0.96,
      metalness: 0,
    });

    this.roadGeometry = createRoadStrip(GAME.roadWidth, 220);
    this.roadMesh = new THREE.Mesh(this.roadGeometry, roadMaterial);
    this.roadMesh.receiveShadow = true;
    this.scene.add(this.roadMesh);

    this.shoulderGeometry = createRoadStrip(GAME.roadWidth + 5.5, 220);
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

    this.sunVisual = addSceneLighting(this.scene);
    this.setupWorld();
    this.sceneryAssets.loadTrees(this.scenery);
    this.sceneryAssets.loadMountains(this.mountains);
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
    this.hornCooldown = 0;
    this.phase = 'ready';
    this.vehicleAssets.setBrakeLights(this.player, false);
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

  setCarStyle(style: CarStyle): void {
    this.carStyle = style;
    if (style === 'real' && !this.carModelsLoading) {
      this.carModelsLoading = true;
      this.loadCarModels();
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener('resize', this.resize);
    this.textureStore.dispose();
    this.renderer.dispose();
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
      const object = index % 5 === 0
        ? this.sceneryAssets.createRock()
        : this.sceneryAssets.createTree();
      object.userData.slot = index;
      object.userData.distance = -45 + index * 12.5;
      object.userData.side = index % 2 === 0 ? -1 : 1;
      object.userData.offset = GAME.roadWidth / 2 + 6 + ((index * 7) % 10);
      this.scenery.push(object);
      this.scene.add(object);
    }

    for (let index = 0; index < 7; index += 1) {
      const mountain = this.sceneryAssets.createMountain();
      mountain.userData.slot = index;
      this.mountains.push(mountain);
      this.scene.add(mountain);
    }

    const cloudTexture = createCloudTexture();
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
        mesh: this.vehicleAssets.createCartoonCar(this.vehicleAssets.randomColor(), false),
        distance: 0,
        lane: direction === 1 ? 0 : 1,
        laneOffset: 0,
        speed: 0,
        targetSpeed: 0,
        speedChangeTimer: 0,
        direction,
        counted: false,
        horned: false,
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

  private loadCarModels(): void {
    void this.vehicleAssets.loadRealModels().then((available) => {
      if (this.carStyle !== 'real' || available.length === 0) return;

      const camaro = available.find((model) => model.id === 'camaro');
      if (camaro?.playerPrototype) {
        this.vehicleAssets.replaceVisual(this.player, camaro.playerPrototype, true, camaro.id);
      }

      const trafficStart = Math.floor(Math.random() * available.length);
      this.traffic.forEach((car, index) => {
        const model = available[(trafficStart + index) % available.length];
        this.vehicleAssets.replaceVisual(car.mesh, model.trafficPrototype, false, model.id);
      });
    });
  }

  private spawnTraffic(car: TrafficCar, ahead?: number, randomizeDirection = false): void {
    if (randomizeDirection) car.direction = Math.random() < 0.56 ? 1 : -1;
    const furthest = this.traffic
      .filter((other) => other !== car && other.direction === car.direction)
      .reduce((max, other) => Math.max(max, other.distance), this.distance + 120);
    car.distance = ahead ?? furthest + 48 + Math.random() * 95;
    car.lane = car.direction === 1 ? 0 : 1;
    car.laneOffset = (Math.random() * 2 - 1) * 1.35;
    car.speed = car.direction === 1 ? 20 + Math.random() * 16 : 24 + Math.random() * 12;
    car.targetSpeed = car.speed;
    car.speedChangeTimer = 2.5 + Math.random() * 6;
    car.counted = false;
    car.horned = false;
  }

  private updateSimulation(dt: number): void {
    const control = this.getControl();
    const curveLimit = curveSpeedLimit(this.distance, GAME.maxSpeed, GAME.minCurveSpeed);
    const collisionLength = this.carStyle === 'real' ? GAME.collisionLength : GAME.cartoonCollisionLength;
    const collisionWidth = this.carStyle === 'real' ? GAME.collisionWidth : GAME.cartoonCollisionWidth;
    let targetSpeed = curveLimit;
    let leadDistance = Number.POSITIVE_INFINITY;
    let leadIsIncoming = false;
    this.hornCooldown = Math.max(0, this.hornCooldown - dt);

    for (const car of this.traffic) {
      const gap = car.distance - this.distance;
      const laneGap = Math.abs(laneOffsets[car.lane] + car.laneOffset - this.lateral);
      if (!car.horned && gap > collisionLength && gap < 32 && laneGap < collisionWidth + 0.8) {
        car.horned = true;
        if (this.hornCooldown === 0) {
          this.hornCooldown = 3.5;
          this.onHorn();
        }
      }
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
    this.vehicleAssets.setBrakeLights(this.player, targetSpeed < this.speed - 0.35);
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
      GAME.roadEdgeMargin,
    );
    this.worldX = roadConstraint.worldX;
    this.lateral = roadConstraint.lateral;
    const boundaryLimit = GAME.roadWidth / 2 - GAME.roadEdgeMargin;
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
      if (edgeProximity > 0.55) this.vehicleAssets.setBrakeLights(this.player, true);
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
      const laneGap = Math.abs(laneOffsets[car.lane] + car.laneOffset - this.lateral);
      if (car.direction === 1 && !car.counted && gap < -collisionLength) {
        car.counted = true;
        this.overtakes += 1;
      }
      if (Math.abs(gap) < collisionLength && laneGap < collisionWidth) {
        this.phase = 'crashed';
        this.speed = 0;
        this.vehicleAssets.setBrakeLights(this.player, true);
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
    updateRoadStrip(this.shoulderGeometry, start, length);
    updateRoadStrip(this.roadGeometry, start, length);
    this.updateRoadsideFences();

    const centerX = roadCenter(this.distance);
    this.player.position.set(this.worldX, 0.02, -this.distance);
    this.player.rotation.y = this.vehicleHeading;
    this.player.rotation.z = damp(this.player.rotation.z, -this.steeringVisual * 0.06, 6, dt);
    const playerFrontWheels = this.player.userData.frontWheels as THREE.Object3D[];
    for (const wheel of playerFrontWheels) {
      const baseSteeringY = (wheel.userData.baseSteeringY as number | undefined) ?? 0;
      wheel.rotation.y = damp(wheel.rotation.y, baseSteeringY - this.steeringVisual * 0.48, 14, dt);
    }

    for (const car of this.traffic) {
      const carHeading = roadHeading(car.distance);
      const offset = laneOffsets[car.lane] + car.laneOffset;
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
