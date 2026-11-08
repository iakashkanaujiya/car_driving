import * as THREE from 'three';
import { PerformanceMonitor } from '../diagnostics/PerformanceMonitor';
import type { PerformanceSnapshot } from '../diagnostics/PerformanceMonitor';
import { fromKph, GAME, laneOffsets, toKph, toMeters } from './config';
import {
  clamp,
  constrainToRoad,
  damp,
  roadCenter,
  roadHeading,
  roadWindowStart,
  steeringYawRate,
} from './math';
import { createRoadStrip, updateRoadStrip } from './roadSurface';
import { AdaptiveQuality, chooseInitialQuality } from './rendering/AdaptiveQuality';
import type { GraphicsQualityMode, RenderQualitySettings } from './rendering/AdaptiveQuality';
import { installKeyLightGlintControl, setKeyLightGlint } from './rendering/keyLightGlint';
import { installVividToneMapping, VIVID_TONE_MAPPING } from './rendering/vividToneMapping';
import { PostProcessing } from './rendering/PostProcessing';
import { applyGroundVariation } from './rendering/groundVariation';
import { SceneryAssets } from './sceneryAssets';
import {
  adjustCruise,
  CRUISE_DEFAULT_KPH,
  cruiseStaysEngaged,
  findLeadVehicle,
} from './simulation/cruiseControl';
import { createSpeedPlan, updateReverseHold } from './simulation/drivingAssist';
import {
  addSceneLighting,
  applySceneLighting,
  SurfaceTextureStore,
  updateSceneShadow,
} from './sceneAssets';
import type { SceneLighting } from './sceneAssets';
import type { ControlInput, CruiseStatus, GamePhase, GameSnapshot } from './types';
import { VehicleAssets } from './vehicleAssets';
import type { LoadedCarModel } from './vehicleAssets';
import { DEFAULT_CAR_MODEL_ID, selectCarModelIds } from './vehicleCatalog';
import type { CarModelId } from './vehicleCatalog';
import { installAtmosphericFog, setAtmosphericScattering } from './world/atmosphere';
import { createEnvironmentLook, DEFAULT_CONDITIONS } from './world/conditions';
import type { DrivingConditions, EnvironmentLook } from './world/conditions';
import { ForestSystem } from './world/ForestSystem';
import { LaneMarkings } from './world/LaneMarkings';
import { MountainRange } from './world/MountainRange';
import { RoadsideFenceSystem } from './world/RoadsideFenceSystem';
import { RainSystem } from './world/RainSystem';
import { RoadsideScenerySystem } from './world/RoadsideScenerySystem';
import { SkySystem } from './world/SkySystem';
import { StreetLightSystem } from './world/StreetLightSystem';
import { VehicleLightSystem } from './world/VehicleLightSystem';

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
}

const GROUND_SIZE = 1200;
const GRASS_TEXTURE_REPEAT = 30;
const GRASS_TILE_METERS = GROUND_SIZE / GRASS_TEXTURE_REPEAT;
const ROAD_UPDATE_INTERVAL = 1 / 30;
const IDLE_RENDER_INTERVAL_MS = 200;
const BASE_FOV = 56;
const SPEED_FOV_BOOST = 9;
const CAMERA_DISTANCE = 8.5;
/** The chase camera eases back this much further at top speed. */
const CAMERA_SPEED_PULLBACK = 3;
/** Road texture vibration felt through the camera at top speed, in world units. */
const CAMERA_SHAKE = 0.05;
/** Spawn queues start at least this far ahead: about four seconds of warning at top speed. */
const TRAFFIC_SPAWN_AHEAD = 260;
/** The view must turn this far past side-on before traffic treats it as the new way ahead. */
const FACING_HYSTERESIS = 0.2;
/** Dry and fully wet values for the road, verge and meadow surfaces. */
const SURFACE_WETNESS = {
  road: { roughness: [0.96, 0.36], brightness: [1, 0.64], reflection: [1, 1.5] },
  shoulder: { roughness: [0.96, 0.48], brightness: [1, 0.74], reflection: [1, 1.3] },
  ground: { roughness: [0.96, 0.8], brightness: [1, 0.84], reflection: [1, 1.1] },
} as const;

export class DrivingGame {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 2400);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly performanceMonitor = new PerformanceMonitor();
  private readonly adaptiveQuality: AdaptiveQuality;
  private readonly clock = new THREE.Clock();
  private readonly vehicleAssets = new VehicleAssets();
  private readonly player = new THREE.Group();
  private readonly traffic: TrafficCar[] = [];
  private readonly sky: SkySystem;
  private readonly fog: THREE.FogExp2;
  private readonly vehicleLights: VehicleLightSystem;
  private readonly streetLights: StreetLightSystem;
  private readonly rain: RainSystem;
  private readonly drawingBufferSize = new THREE.Vector2();
  private look?: EnvironmentLook;
  private readonly mountainRange: MountainRange;
  private readonly forest: ForestSystem;
  private postProcessing?: PostProcessing;
  private readonly lighting: SceneLighting;
  private readonly textureStore: SurfaceTextureStore;
  private readonly sceneryAssets: SceneryAssets;
  private readonly sceneAssetsReady: Promise<void>;
  private readonly roadsideFences: RoadsideFenceSystem;
  private readonly roadsideScenery: RoadsideScenerySystem;
  private readonly roadGeometry: THREE.BufferGeometry;
  private readonly roadMesh: THREE.Mesh;
  private readonly shoulderGeometry: THREE.BufferGeometry;
  private readonly shoulderMesh: THREE.Mesh;
  private readonly laneMarkings: LaneMarkings;
  private readonly ground: THREE.Mesh;
  private readonly forward = new THREE.Vector3();
  private readonly shadowCenter = new THREE.Vector3();
  private readonly desiredCamera = new THREE.Vector3();
  private readonly cameraTarget = new THREE.Vector3();
  private phase: GamePhase = 'ready';
  private distance = 0;
  private speed = 0;
  private lateral: number = laneOffsets[0];
  private worldX = roadCenter(0) + Math.cos(roadHeading(0)) * laneOffsets[0];
  private vehicleHeading = roadHeading(0);
  private steeringVisual = 0;
  private longitudinalAcceleration = 0;
  /** Seconds the full brake has been held at a standstill; engages reverse. */
  private reverseHoldSeconds = 0;
  /** Which way along the road the car points: 1 the original way, -1 after a U-turn. */
  private facing: 1 | -1 = 1;
  /** Cosine between the camera's view and the road's forward direction. */
  private viewAlong = 1;
  /** Distance driven in forward gear; the score counts this, not the position. */
  private odometer = 0;
  /** Adaptive cruise: on/off, its set speed (kept while off) and what it is doing. */
  private cruiseOn = false;
  private cruiseSetKph = CRUISE_DEFAULT_KPH;
  private cruiseStatus: CruiseStatus = 'off';
  /** A short-lived HUD message, such as a refused cruise request. */
  private notice = { message: '', seconds: 0 };
  private readonly viewDirection = new THREE.Vector3();
  private readonly lastPlayerPosition = new THREE.Vector3();
  private hasLastPlayerPosition = false;
  private overtakes = 0;
  private assistMessage = 'READY';
  private driverCar: CarModelId = DEFAULT_CAR_MODEL_ID;
  private carModelsPromise?: Promise<LoadedCarModel[]>;
  private carModelsApplied = false;
  private sceneAssetsLoaded = false;
  private lastSnapshot = 0;
  private lastIdleRender = 0;
  private roadUpdateElapsed = Number.POSITIVE_INFINITY;
  private lastRoadUpdateDistance = Number.NaN;
  private animationFrame = 0;
  private performanceMonitoring = false;
  private graphicsQualityMode: GraphicsQualityMode = 'auto';
  private pendingRenderQuality?: RenderQualitySettings;

  constructor(
    private readonly container: HTMLElement,
    private readonly getControl: () => ControlInput,
    private readonly onUpdate: (snapshot: GameSnapshot) => void,
    private readonly onCrash: () => void,
    private readonly onPerformanceUpdate: (snapshot: PerformanceSnapshot) => void,
  ) {
    // Aerial-perspective fog, the key-light glint control and the vivid tone
    // mapping must be installed before any material compiles.
    installAtmosphericFog();
    installKeyLightGlintControl();
    installVividToneMapping();
    this.fog = new THREE.FogExp2(0xffffff);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color();

    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    this.adaptiveQuality = new AdaptiveQuality(
      chooseInitialQuality(navigator.hardwareConcurrency || 2, deviceMemory),
    );
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, this.adaptiveQuality.settings.pixelRatioCap),
    );
    this.renderer.setSize(container.clientWidth, container.clientHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = VIVID_TONE_MAPPING;
    this.renderer.toneMappingExposure = 1.0;
    // The effect composer issues several renders per frame; count them all.
    this.renderer.info.autoReset = false;
    container.appendChild(this.renderer.domElement);

    // The sky is both the backdrop and the source of image-based lighting, so
    // car paint, glass and chrome reflect the same clouds the player sees.
    this.sky = new SkySystem();
    this.scene.add(this.sky.mesh);
    this.mountainRange = new MountainRange();
    this.scene.add(this.mountainRange.mesh);
    this.forest = new ForestSystem(this.scene);
    // Apply the starting tier on the first frame (creates the effect composer
    // when post-processing is enabled, including in Auto mode).
    this.pendingRenderQuality = this.adaptiveQuality.settings;

    this.textureStore = new SurfaceTextureStore(this.renderer.capabilities.getMaxAnisotropy());

    const roadMaterial = this.textureStore.createMaterial(
      'RoadLines_baseColor.jpeg',
      'RoadLines_normal.png',
      'RoadLines_metallicRoughness.png',
      {
        textureRoot: 'roads/textures',
        normalScale: 0.34,
        tint: 0xffffff,
      },
    );
    const shoulderMaterial = this.textureStore.createMaterial(
      'Sidewalk01_baseColor.jpeg',
      'Sidewalk01_normal.png',
      'Sidewalk01_metallicRoughness.png',
      {
        textureRoot: 'roads/textures',
        normalScale: 0.38,
        tint: 0xffffff,
      },
    );
    const groundMaterial = this.textureStore.createMaterial(
      'Grass02_baseColor.jpeg',
      'Grass02_normal.png',
      'Grass02_metallicRoughness.png',
      {
        textureRoot: 'roads/textures',
        repeatX: GRASS_TEXTURE_REPEAT,
        repeatY: GRASS_TEXTURE_REPEAT,
        normalScale: 0.34,
        tint: 0xffffff,
      },
    );
    applyGroundVariation(groundMaterial);
    this.sceneryAssets = new SceneryAssets();

    this.roadGeometry = createRoadStrip(GAME.roadWidth, 320, 0, 1, GAME.roadWidth);
    this.roadMesh = new THREE.Mesh(this.roadGeometry, roadMaterial);
    this.roadMesh.receiveShadow = true;
    this.scene.add(this.roadMesh);

    this.shoulderGeometry = createRoadStrip(GAME.roadWidth + 5.5, 320);
    this.shoulderMesh = new THREE.Mesh(this.shoulderGeometry, shoulderMaterial);
    this.shoulderMesh.position.y = -0.055;
    this.shoulderMesh.receiveShadow = true;
    this.scene.add(this.shoulderMesh);
    this.laneMarkings = new LaneMarkings(this.scene);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE), groundMaterial);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.09;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.roadsideFences = new RoadsideFenceSystem(this.scene);
    this.roadsideScenery = new RoadsideScenerySystem(this.scene);

    this.lighting = addSceneLighting(this.scene, this.adaptiveQuality.settings.shadowMapSize);
    this.vehicleLights = new VehicleLightSystem(this.scene);
    this.streetLights = new StreetLightSystem(this.scene);
    this.rain = new RainSystem(this.scene);
    this.setupTraffic();
    this.setConditions(DEFAULT_CONDITIONS);
    const natureReady = this.sceneryAssets.loadNature().then(() => {
      const pine = this.sceneryAssets.getPineTreePrototype();
      if (!pine) return;
      this.forest.setNearModel(pine);
      this.roadsideScenery.setTreeModel(pine);
    });
    this.sceneAssetsReady = Promise.all([this.textureStore.whenReady(), natureReady]).then(() => {
      this.sceneAssetsLoaded = true;
    });
    this.scene.add(this.player);
    this.resize();
    window.addEventListener('resize', this.resize);
    this.animationFrame = requestAnimationFrame(this.animate);
  }

  start(): void {
    if (!this.sceneAssetsLoaded || !this.carModelsApplied) {
      throw new Error('The game cannot start before all required assets load.');
    }
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
    this.reverseHoldSeconds = 0;
    this.facing = 1;
    this.viewAlong = 1;
    this.odometer = 0;
    this.cruiseOn = false;
    this.cruiseStatus = 'off';
    this.notice.seconds = 0;
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
    this.roadsideScenery.reset();
    this.longitudinalAcceleration = 0;
    this.forest.reset();
  }

  getPhase(): GamePhase {
    return this.phase;
  }

  refreshViewport(): void {
    this.resize();
  }

  setPerformanceMonitoring(enabled: boolean): void {
    this.performanceMonitoring = enabled;
    this.performanceMonitor.reset();
  }

  setGraphicsQuality(mode: GraphicsQualityMode): void {
    this.graphicsQualityMode = mode;
    // Re-selecting the current tier clears stale adaptive samples. Fixed
    // presets are applied inside the render loop so resizing the drawing
    // buffer and repainting always happen in the same animation frame.
    const level = mode === 'auto' ? this.adaptiveQuality.settings.level : mode;
    const settings = this.adaptiveQuality.setLevel(level);
    if (mode !== 'auto') this.pendingRenderQuality = settings;
  }

  /** Switches the time of day and weather; repaints immediately, even on menus. */
  setConditions(conditions: DrivingConditions): void {
    const current = this.look?.conditions;
    if (current?.timeOfDay === conditions.timeOfDay && current.weather === conditions.weather) {
      return;
    }
    const look = createEnvironmentLook(conditions);
    this.look = look;
    setAtmosphericScattering(look.lightDirection, look.scatterColor);
    setKeyLightGlint(look.keyLightGlint);
    this.fog.color.copy(look.fogColor);
    this.fog.density = look.fogDensity;
    (this.scene.background as THREE.Color).copy(look.fogColor);
    this.sky.setLook(look);
    this.scene.environment = this.sky.createEnvironment(this.renderer);
    this.scene.environmentIntensity = look.environmentIntensity;
    this.renderer.toneMappingExposure = look.exposure;
    applySceneLighting(this.lighting, look);
    this.vehicleLights.setLook(look);
    this.streetLights.setLook(look);
    this.vehicleAssets.setRunningLights(look.vehicleLights);
    for (const car of [this.player, ...this.traffic.map((traffic) => traffic.mesh)]) {
      this.vehicleAssets.setBrakeLights(car, this.vehicleAssets.isBraking(car));
    }
    this.rain.setRain(look.rain, look.rainColor);
    this.applyWetness(look.wetness);
    this.lastIdleRender = 0;
  }

  /**
   * Turns adaptive cruise on (it drives toward the set speed, even from a
   * standstill) or off. Only while driving forward.
   */
  toggleCruise(): void {
    if (this.phase !== 'playing') return;
    if (this.cruiseOn) {
      this.cruiseOn = false;
      this.cruiseStatus = 'off';
      this.showNotice('CRUISE OFF');
    } else if (this.speed < -0.3) {
      this.showNotice('STOP BEFORE CRUISE');
    } else {
      this.cruiseOn = true;
      this.cruiseStatus = 'cruising';
    }
  }

  /** Raises (+1) or lowers (−1) the cruise set speed in 5 km/h steps, on or off. */
  adjustCruise(direction: 1 | -1): void {
    this.cruiseSetKph = adjustCruise(this.cruiseSetKph, direction);
  }

  whenReady(): Promise<void> {
    return this.sceneAssetsReady;
  }

  async setCars(
    driverCar: CarModelId = DEFAULT_CAR_MODEL_ID,
    trafficCount: number = GAME.trafficCount,
    modelCount = 1,
  ): Promise<void> {
    this.driverCar = driverCar;
    this.setTrafficCount(trafficCount);
    await this.loadCarModels(driverCar, this.traffic.length === 0 ? 1 : modelCount);
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener('resize', this.resize);
    this.roadsideFences.dispose();
    this.roadsideScenery.dispose();
    this.vehicleLights.dispose();
    this.streetLights.dispose();
    this.rain.dispose();
    this.laneMarkings.dispose();
    this.forest.dispose();
    this.mountainRange.dispose();
    this.sky.dispose();
    this.sceneryAssets.dispose();
    this.postProcessing?.dispose();
    this.textureStore.dispose();
    this.renderer.dispose();
  }

  private setupTraffic(): void {
    let ongoingSpawnCursor = 45;
    let incomingSpawnCursor = 62;
    for (let index = 0; index < GAME.trafficCount; index += 1) {
      const direction: 1 | -1 = index === 0 ? 1 : index === 1 ? -1 : Math.random() < 0.56 ? 1 : -1;
      const car: TrafficCar = {
        mesh: new THREE.Group(),
        distance: 0,
        lane: 0,
        laneOffset: 0,
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

  private setTrafficCount(requestedCount: number): void {
    const trafficCount = Math.round(clamp(requestedCount, 0, GAME.trafficCount));
    while (this.traffic.length > trafficCount) {
      const removed = this.traffic.pop();
      if (removed) this.scene.remove(removed.mesh);
    }
  }

  private async loadCarModels(driverCar: CarModelId, modelCount: number): Promise<void> {
    if (this.carModelsApplied) return;
    this.carModelsPromise ??= this.vehicleAssets.loadCarModels(driverCar, modelCount);
    const available = await this.carModelsPromise;
    const expectedModelCount = selectCarModelIds(driverCar, modelCount).length;
    if (available.length !== expectedModelCount) {
      throw new Error('One or more selected car models could not be loaded.');
    }

    const playerModel = available.find((model) => model.playerPrototype);
    if (!playerModel?.playerPrototype) {
      throw new Error('The selected driver car could not be loaded.');
    }
    this.vehicleAssets.replaceVisual(
      this.player,
      playerModel.playerPrototype,
      true,
      playerModel.id,
    );

    const trafficStart = Math.floor(Math.random() * available.length);
    this.traffic.forEach((car, index) => {
      const model = available[(trafficStart + index) % available.length];
      this.vehicleAssets.replaceVisual(car.mesh, model.trafficPrototype, false, model.id);
    });
    this.carModelsApplied = true;
  }

  /**
   * Places a car `ahead` units in front of the player along the way the player
   * faces (or behind the furthest car going the same way). Slightly more cars
   * travel with the player, and they drive a little slower so they can be overtaken.
   */
  private spawnTraffic(car: TrafficCar, ahead?: number, randomizeDirection = false): void {
    const facing = this.facing;
    if (randomizeDirection) car.direction = Math.random() < 0.56 ? facing : (-facing as 1 | -1);
    const furthest = this.traffic
      .filter((other) => other !== car && other.direction === car.direction)
      .reduce(
        (max, other) => Math.max(max, (other.distance - this.distance) * facing),
        TRAFFIC_SPAWN_AHEAD,
      );
    car.distance = this.distance + facing * (ahead ?? furthest + 48 + Math.random() * 95);
    // Traffic keeps left: lanes 0-1 run toward increasing distance, 2-3 the other way.
    car.lane = (car.direction === 1 ? 0 : 2) + (Math.random() < 0.5 ? 0 : 1);
    car.laneOffset = (Math.random() * 2 - 1) * GAME.trafficLaneJitter;
    // Highway speeds: 80–120 km/h with the player, 90–130 km/h oncoming.
    car.speed =
      car.direction === facing
        ? fromKph(80 + Math.random() * 40)
        : fromKph(90 + Math.random() * 40);
    car.targetSpeed = car.speed;
    car.speedChangeTimer = 2.5 + Math.random() * 6;
    car.counted = false;
    this.vehicleAssets.setBrakeLights(car.mesh, false);
  }

  private updateSimulation(dt: number): void {
    const control = this.getControl();
    const { length: collisionLength, width: collisionWidth } = this.vehicleAssets.collisionSize(
      this.driverCar,
    );

    this.reverseHoldSeconds = updateReverseHold(this.reverseHoldSeconds, control, this.speed, dt);
    if (this.cruiseOn && !cruiseStaysEngaged(control)) this.cruiseOn = false;
    const lead = this.cruiseOn
      ? findLeadVehicle(this.distance, this.lateral, this.facing, collisionLength, this.traffic)
      : null;
    const speedPlan = createSpeedPlan(control, this.speed, {
      reverseHoldSeconds: this.reverseHoldSeconds,
      cruiseKph: this.cruiseOn ? this.cruiseSetKph : null,
      lead,
    });
    // A keyboard driver overtaking on the accelerator keeps cruise armed.
    this.cruiseStatus = this.cruiseOn ? (speedPlan.cruiseStatus ?? 'cruising') : 'off';
    const { targetSpeed, acceleration, autoBraking } = speedPlan;
    this.assistMessage = speedPlan.assistMessage;
    if (this.notice.seconds > 0) {
      this.notice.seconds -= dt;
      this.assistMessage = this.notice.message;
    }
    const previousSpeed = this.speed;
    this.vehicleAssets.setBrakeLights(this.player, autoBraking || speedPlan.braking);
    // Speed is signed: negative while reversing.
    this.speed = damp(
      this.speed,
      targetSpeed,
      acceleration / Math.max(8, Math.abs(targetSpeed - this.speed)),
      dt,
    );
    if (targetSpeed === 0 && Math.abs(this.speed) < 0.3) this.speed = 0;
    this.longitudinalAcceleration = damp(
      this.longitudinalAcceleration,
      (this.speed - previousSpeed) / Math.max(dt, 1e-3),
      5,
      dt,
    );

    this.steeringVisual = damp(this.steeringVisual, control.steering, 10, dt);
    const reversing = this.speed < 0;
    this.vehicleHeading -= steeringYawRate(this.steeringVisual, this.speed) * dt;
    // Plain planar motion: the car can turn around and drive back down the road.
    this.worldX += -Math.sin(this.vehicleHeading) * this.speed * dt;
    this.distance += Math.cos(this.vehicleHeading) * this.speed * dt;
    if (this.speed > 0) this.odometer += this.speed * dt;

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
      // Sideways drift across the road; positive moves toward positive lateral.
      const drift = -Math.sin(relativeHeading) * this.speed;
      if (drift * this.lateral > 0) {
        // Straighten toward whichever way along the road the nose is nearer,
        // so a U-turn that reaches the verge completes instead of unwinding.
        const along =
          Math.abs(relativeHeading) > Math.PI / 2 ? Math.sign(relativeHeading) * Math.PI : 0;
        const softenedHeading = damp(relativeHeading, along, 2.5 + edgeProximity * 5.5, dt);
        this.vehicleHeading = currentRoadHeading + softenedHeading;
        const scrub = (2 + edgeProximity * 5) * dt;
        this.speed = reversing ? Math.min(0, this.speed + scrub) : Math.max(0, this.speed - scrub);
      }
      this.assistMessage = 'ROAD EDGE';
      if (edgeProximity > 0.55) this.vehicleAssets.setBrakeLights(this.player, true);
    }

    this.updateFacing(currentRoadHeading);
    const facing = this.facing;
    for (const car of this.traffic) {
      car.speedChangeTimer -= dt;
      if (car.speedChangeTimer <= 0) {
        car.targetSpeed =
          car.direction === facing
            ? fromKph(75 + Math.random() * 50)
            : fromKph(85 + Math.random() * 45);
        car.speedChangeTimer = 2.5 + Math.random() * 7;
      }
      let trafficTargetSpeed = car.targetSpeed;
      for (const other of this.traffic) {
        if (other === car || other.direction !== car.direction || other.lane !== car.lane) continue;
        const forwardGap = (other.distance - car.distance) * car.direction;
        if (forwardGap > 0 && forwardGap < 60) {
          trafficTargetSpeed = Math.min(
            trafficTargetSpeed,
            other.speed * clamp((forwardGap - 14) / 32, 0, 1),
          );
        }
      }
      this.vehicleAssets.setBrakeLights(car.mesh, trafficTargetSpeed < car.speed - 0.35);
      car.speed = damp(car.speed, trafficTargetSpeed, 1.25, dt);
      car.distance += car.speed * car.direction * dt;
      const gap = car.distance - this.distance;
      // How far ahead the car is along the way the player faces.
      const aheadGap = gap * facing;
      const laneGap = Math.abs(laneOffsets[car.lane] + car.laneOffset - this.lateral);
      if (car.direction === facing && !car.counted && aheadGap < -collisionLength) {
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
      if (aheadGap < (car.direction === facing ? -70 : -45)) {
        this.spawnTraffic(car, undefined, true);
      }
    }
  }

  /**
   * Flips which way traffic treats as ahead once the car has clearly turned
   * around. Cars already behind in the new direction cannot count as overtakes.
   */
  private updateFacing(currentRoadHeading: number): void {
    const along = Math.cos(this.vehicleHeading - currentRoadHeading);
    const flipped =
      (this.facing === 1 && along < -FACING_HYSTERESIS) ||
      (this.facing === -1 && along > FACING_HYSTERESIS);
    if (!flipped) return;
    this.facing = this.facing === 1 ? -1 : 1;
    for (const car of this.traffic) {
      car.counted = (car.distance - this.distance) * this.facing < 0;
    }
  }

  private updateWorld(dt: number, rainSeconds: number): void {
    // Scenery follows the way the camera looks, so a U-turn finds road ahead.
    this.camera.getWorldDirection(this.viewDirection);
    const viewHeading = roadHeading(this.distance);
    const viewLength = Math.hypot(this.viewDirection.x, this.viewDirection.z);
    if (viewLength > 1e-3) {
      this.viewAlong =
        (-Math.sin(viewHeading) * this.viewDirection.x -
          Math.cos(viewHeading) * this.viewDirection.z) /
        viewLength;
    }
    const viewAlong = this.viewAlong;
    this.roadUpdateElapsed += dt;
    const roadJumped =
      !Number.isFinite(this.lastRoadUpdateDistance) ||
      Math.abs(this.distance - this.lastRoadUpdateDistance) > 5;
    if (roadJumped || this.roadUpdateElapsed >= ROAD_UPDATE_INTERVAL) {
      const length = GAME.lookAhead + GAME.lookBehind + 150;
      const start = roadWindowStart(this.distance, viewAlong, length, GAME.lookBehind);
      updateRoadStrip(this.shoulderGeometry, start, length);
      updateRoadStrip(this.roadGeometry, start, length);
      this.laneMarkings.update(start, length);
      this.lastRoadUpdateDistance = this.distance;
      this.roadUpdateElapsed = 0;
    }
    this.roadsideFences.update(this.distance, viewAlong);

    const centerX = roadCenter(this.distance);
    this.player.position.set(this.worldX, 0.02, -this.distance);
    this.player.rotation.y = this.vehicleHeading;
    // Body roll leans away from the turn and pitch follows braking/acceleration;
    // both act on the sprung body only so the tyres stay on the road.
    const lateralLoad =
      this.steeringVisual * clamp(Math.abs(this.speed) / 30, 0, 1) * Math.sign(this.speed);
    this.vehicleAssets.updateSuspension(
      this.player,
      lateralLoad * 0.04,
      this.longitudinalAcceleration * 0.0024,
      dt,
    );
    this.vehicleAssets.updateWheelAnimation(this.player, this.speed * dt, this.steeringVisual, dt);

    for (const car of this.traffic) {
      const gap = car.distance - this.distance;
      const aheadGap = gap * this.facing;
      const visible = aheadGap > -90 && aheadGap < GAME.lookAhead + 80;
      car.mesh.visible = visible;
      if (!visible) continue;
      const carHeading = roadHeading(car.distance);
      const offset = laneOffsets[car.lane] + car.laneOffset;
      car.mesh.position.set(
        roadCenter(car.distance) + Math.cos(carHeading) * offset,
        0.02,
        -car.distance - Math.sin(carHeading) * offset,
      );
      car.mesh.rotation.y = carHeading + (car.direction === -1 ? Math.PI : 0);
      const detailDistance = Math.abs(gap);
      this.vehicleAssets.setDetail(car.mesh, detailDistance);
      this.vehicleAssets.setShadowCasting(car.mesh, detailDistance < 65);
      if (detailDistance < 70) {
        this.vehicleAssets.updateWheelAnimation(car.mesh, car.speed * dt, 0, dt);
      }
    }

    this.roadsideScenery.update(this.distance, viewAlong);

    this.ground.position.set(centerX, -0.09, -this.distance - 180 * viewAlong);
    const groundMaterial = this.ground.material as THREE.MeshStandardMaterial;
    // PlaneGeometry's V axis points toward negative world Z after the ground is
    // rotated flat. Offset from the plane's world position so recentering the
    // large ground mesh never makes its texture travel with the player.
    const grassOffsetX = this.ground.position.x / GRASS_TILE_METERS;
    const grassOffsetY = -this.ground.position.z / GRASS_TILE_METERS;
    groundMaterial.map?.offset.set(grassOffsetX, grassOffsetY);
    groundMaterial.normalMap?.offset.set(grassOffsetX, grassOffsetY);
    groundMaterial.roughnessMap?.offset.set(grassOffsetX, grassOffsetY);
    groundMaterial.metalnessMap?.offset.set(grassOffsetX, grassOffsetY);
    this.forward.set(-Math.sin(this.vehicleHeading), 0, -Math.cos(this.vehicleHeading));
    this.shadowCenter.copy(this.player.position).addScaledVector(this.forward, 32);
    updateSceneShadow(this.lighting, this.shadowCenter);
    // Carry the camera with the car so it never trails further behind at
    // speed; the lerp below only smooths turns and the speed pull-back.
    if (this.hasLastPlayerPosition) {
      const moved = this.player.position.distanceTo(this.lastPlayerPosition);
      if (moved < 40) {
        this.camera.position.add(this.lastPlayerPosition.sub(this.player.position).negate());
      }
    }
    this.lastPlayerPosition.copy(this.player.position);
    this.hasLastPlayerPosition = true;
    const speedFraction = clamp(Math.abs(this.speed) / GAME.maxSpeed, 0, 1);
    this.desiredCamera
      .copy(this.player.position)
      .addScaledVector(this.forward, -(CAMERA_DISTANCE + CAMERA_SPEED_PULLBACK * speedFraction));
    this.desiredCamera.y += 4.3;
    this.camera.position.lerp(this.desiredCamera, 1 - Math.exp(-5 * dt));
    this.cameraTarget.copy(this.player.position).addScaledVector(this.forward, 12);
    // A faint high-frequency judder from the road surface grows with speed.
    const time = performance.now() * 0.001;
    const judder = Math.sin(time * 37) * 0.6 + Math.sin(time * 23.7 + 1.3) * 0.4;
    this.cameraTarget.y += 1 + judder * CAMERA_SHAKE * speedFraction * speedFraction;
    this.camera.lookAt(this.cameraTarget);
    // Widen the lens with speed for a stronger sense of velocity.
    const fov = BASE_FOV + SPEED_FOV_BOOST * clamp(this.speed / GAME.maxSpeed, 0, 1) ** 1.5;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = damp(this.camera.fov, fov, 3, dt);
      this.camera.updateProjectionMatrix();
    }

    this.sky.update(this.camera, performance.now() * 0.001);
    this.mountainRange.update(this.camera.position);
    this.forest.update(this.distance, viewAlong);
    this.rain.update(this.camera, rainSeconds, this.vehicleLights.headlight);
    this.updateVehicleLights();
  }

  private showNotice(message: string): void {
    this.notice.message = message;
    this.notice.seconds = 1.6;
  }

  private updateVehicleLights(): void {
    const bufferHeight = this.renderer.getDrawingBufferSize(this.drawingBufferSize).y;
    this.streetLights.update(
      this.distance,
      this.viewAlong,
      this.camera,
      bufferHeight,
      this.player.position,
    );
    if (!this.vehicleLights.beginFrame(this.camera, bufferHeight)) return;
    const playerRig = this.vehicleAssets.lightRig(this.player);
    if (playerRig) this.vehicleLights.placeHeadlight(this.player, playerRig);
    for (const car of this.traffic) {
      if (!car.mesh.visible) continue;
      const rig = this.vehicleAssets.lightRig(car.mesh);
      if (!rig) continue;
      this.vehicleLights.addVehicle(car.mesh, rig, this.vehicleAssets.isBraking(car.mesh));
    }
    this.vehicleLights.endFrame();
  }

  private applyWetness(wetness: number): void {
    const surfaces = [
      [this.roadMesh, SURFACE_WETNESS.road],
      [this.shoulderMesh, SURFACE_WETNESS.shoulder],
      [this.ground, SURFACE_WETNESS.ground],
    ] as const;
    for (const [mesh, response] of surfaces) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      const mix = (range: readonly [number, number]): number =>
        THREE.MathUtils.lerp(range[0], range[1], wetness);
      material.roughness = mix(response.roughness);
      material.color.setScalar(mix(response.brightness));
      material.envMapIntensity = mix(response.reflection);
    }
  }

  private animate = (): void => {
    this.animationFrame = requestAnimationFrame(this.animate);
    const frameSeconds = this.clock.getDelta();
    const dt = Math.min(frameSeconds, 0.05);
    const now = performance.now();
    const playing = this.phase === 'playing';
    if (!playing && now - this.lastIdleRender < IDLE_RENDER_INTERVAL_MS) return;
    if (playing) this.updateSimulation(dt);
    // Rain keeps real time on menus, where the world only repaints a few times a second.
    this.updateWorld(dt, Math.min(frameSeconds, 0.25));
    let qualitySettings = this.pendingRenderQuality;
    this.pendingRenderQuality = undefined;
    if (playing && this.graphicsQualityMode === 'auto') {
      const settings = this.adaptiveQuality.recordFrame(frameSeconds);
      if (settings) qualitySettings = settings;
    }
    if (qualitySettings) this.applyRenderQuality(qualitySettings);
    this.renderer.info.reset();
    // Quality changes resize and clear the WebGL drawing buffer. Rendering
    // afterward fills it in the same animation frame and prevents a black flash.
    if (this.postProcessing && this.adaptiveQuality.settings.postProcessing) {
      this.postProcessing.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    if (this.performanceMonitoring && playing) {
      const render = this.renderer.info.render;
      const memory = this.renderer.info.memory;
      const snapshot = this.performanceMonitor.recordFrame(
        frameSeconds,
        {
          drawCalls: render.calls,
          triangles: render.triangles,
          geometries: memory.geometries,
          textures: memory.textures,
        },
        this.adaptiveQuality.settings.level,
      );
      if (snapshot) this.onPerformanceUpdate(snapshot);
    }
    if (!playing) this.lastIdleRender = now;

    if (now - this.lastSnapshot > 80) {
      this.lastSnapshot = now;
      this.onUpdate({
        speedKph: toKph(Math.abs(this.speed)),
        distance: toMeters(this.odometer),
        overtakes: this.overtakes,
        score: Math.floor(toMeters(this.odometer) + this.overtakes * 250),
        cruise: { status: this.cruiseStatus, setKph: this.cruiseSetKph },
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
    this.postProcessing?.syncSize(width, height);
  };

  private applyRenderQuality(settings: RenderQualitySettings): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatioCap));
    this.forest.setDense(settings.denseForest);
    if (settings.postProcessing) {
      this.postProcessing ??= new PostProcessing(this.renderer, this.scene, this.camera);
      this.postProcessing.syncSize(this.container.clientWidth, this.container.clientHeight);
    }
    const shadow = this.lighting.sun.shadow;
    if (shadow.mapSize.x !== settings.shadowMapSize) {
      shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
      shadow.map?.dispose();
      shadow.map = null;
    }
  }
}
