# Hands-On Highway

![Hands-On Highway game poster](public/images/hands-on-highway-poster.jpg)

**Steer with your bare hands.** Hands-On Highway is a free browser driving game where your webcam is the controller: hold up two fists like a steering wheel and turn them to steer down a four-lane mountain highway, dodging same-direction and oncoming traffic. No download, no controller, no account.

**[▶ Play in your browser](https://iakashkanaujiya.github.io/car_driving/)** (Chrome or Edge on a computer with a webcam; keyboard controls work too.)

Hand tracking runs entirely on your device with MediaPipe, so camera video is never uploaded. The car accelerates automatically; slowing down for curves and traffic is up to you.

## Gameplay

![Hands-On Highway gameplay](public/images/hands-on-highway-gameplay.jpg)

## Run locally

```bash
npm install
npm run dev
```

Open the local URL shown by Vite in Chrome or Edge. Camera access works on `localhost` or an HTTPS deployment.

## Deploy to GitHub Pages

Push the project to a repository named `car_driving` using the `main` branch. In **Settings → Pages**, select **GitHub Actions** as the deployment source. The included workflow tests and deploys the game automatically to:

```text
https://<your-github-username>.github.io/car_driving/
```

## Time of day and weather

Pick the conditions on the start screen, or change them mid-run under **Graphics → Conditions**. Your choice is saved for future visits.

- **Time of day:** Day (high afternoon sun), Evening (a low sunset straight ahead with long shadows) or Night (moonlight, stars, and every car driving with its lights on).
- **Weather:** Clear, Cloudy (broken cloud and softer shadows), Rain (an overcast sky, falling rain, a glossy wet road, rain sound, and headlights on) or Fog (visibility drops to a couple of hundred metres and headlights come on).

Any time of day combines with any weather, so night fog or evening rain are available too.

Street lights line both verges, staggered so a lamp passes about every 30 m. By day they are poles that cast shadows; from dusk, and in dark rain or fog, their lamps glow, paint warm pools of light on the road, and light up your car as you pass underneath.

## Available car models

Choose any of these vehicles on the start screen; every one can be your car or traffic. Traffic gets randomized realistic paint colors, except the generic cars, whose colors are part of their textures.

| Vehicle                               | Length |
| ------------------------------------- | -----: |
| 2018 Audi e-tron GT Concept (default) |  5.0 m |
| 2013 Volvo V60 Polestar               |  4.6 m |
| 2000 Jaguar XJ Sport                  |  5.0 m |
| Peugeot 3008                          |  4.5 m |
| Nissan Z Proto                        |  4.4 m |
| Nissan Skyline R34 GT-R               |  4.6 m |
| Mercedes-Benz C63 AMG                 |  4.7 m |
| BMW 7 Series (F01)                    |  5.1 m |
| BMW i8                                |  4.7 m |
| Mercedes-Maybach Vision 6             |  5.7 m |

Ten unbranded **generic cars** (sedan, wagon, hatchback, compact, coupé, sports car, minivan, SUV, off-roader and pickup) are listed under their own heading. They are light (about 7,000 triangles and 0.7 MB each), so they make cheap, varied traffic.

Every car is drawn at its real size, with four rolling wheels, steering front wheels, headlights and working brake lights.

You can select 0, 4, 8, 12, or 16 traffic cars and choose how many different models appear (1, 2, 3, 4, 6 or 8). Car variety defaults to 1, which reuses the selected driver model for traffic and reduces model parsing and memory use; higher variety adds the next cars in the list. Higher traffic counts or model variety may reduce frame rates on lower-powered devices.

### Adding cars

The cars other than the Audi are downloaded from Sketchfab (credits below) into `models-src/cars/`, which is not committed, and prepared with:

```bash
node scripts/prepare-car-models.mjs
```

It removes scene props such as ground planes, shrinks textures to at most 1024 px, splits the generic car pack into one file per car and writes `public/models/cars/`. At load time the game finds each car's four tyres by material, so tyres that share one mesh are separated by corner, and splits lamp materials that cover both ends of a car into front and rear (`src/game/carParts.ts`). Each car's materials, facing and real size are listed in `src/game/vehicleAssets.ts`.

On the first visit, a setup popup keeps the game locked while it downloads approximately 11 MB of core scenery and road textures with live progress. Only selected car models are downloaded afterward; each model is stored on first use and reused on later visits. Interrupted core downloads can be retried and resume from files that are already cached.

## Controls

![Hands-On Highway hand-control guide](public/images/hand-controls.svg)

- **Hand mode:** hold two closed hands apart, keep them level during calibration, and rotate them like a steering wheel. Raise both thumbs to brake down to 40 km/h and hold that speed, or show both open palms for a full stop. The car stays stopped while your palms stay open; keep them open 3 seconds after it stops (the status counts down: STOPPED · REVERSE IN 3, 2, 1) to back up slowly (up to 15 km/h, still steering with your hands). Close your fists again to stop and drive forward.
- **Keyboard mode:** use `W` or up arrow to accelerate, `S` or down arrow to brake, and `A` / `D` or left / right arrows to steer. Keep holding `S` once the car stops to reverse (up to 30 km/h); pressing `W` while rolling backward brakes first, then drives forward.
- **Handbrake:** hold `Space`, in hand or keyboard mode. It locks the rear wheels and stops the car at about 0.55 g (gentler than the footbrake, and without lighting the brake lamps); steer while it is on and the back slides out with a tyre squeal. It overrides the accelerator, switches adaptive cruise off and never engages reverse; pressing `S` as well brakes at full strength.
- **Horn:** hold `H` to sound the horn, in hand or keyboard mode. The game never honks on its own.
- **Adaptive cruise control (ACC):** use the panel above the speedometer, or the keyboard. `C` (or the ACC button) turns it on and off, and `+` / `-` (or the panel's buttons) set the speed in 5 km/h steps, on or off. On a clear road it holds the set speed, even pulling away from a standstill. Behind a car in your lane it slows to keep a gap of about 1.6 seconds, braking as hard as needed, and follows it down to a stop and away again. The panel shows ACC ON, FOLLOWING or BRAKING. Holding `W` still accelerates past it to overtake. On the keyboard, pressing `S` cancels it like a real brake pedal. ACC is the only time the game brakes for traffic.
- **ACC with hand control:** hold a V sign (index and middle fingers up) with both hands for about a second to switch ACC on or off, without letting go of the wheel; steering keeps working while you do. Raise just your right thumb (left hand still gripping) to raise the set speed by 5 km/h, repeating while you hold it, or just your left thumb to lower it. Both thumbs up and open palms still brake: they take over from ACC, and it carries on once you grip the wheel again. If tracking loses your hands, the car brakes as usual and ACC resumes when your hands are back.
- **U-turns:** slow down and steer hard to turn around, or use reverse for a three-point turn. Like a real car, steering only turns the wheels while stopped, so the car needs to roll to change direction. The road, scenery and traffic carry on in whichever direction you drive, past the start line too. Traffic keeps left, so after turning around your lanes are the ones on the far side of the centre line.
- **Speed and handling:** the speedometer and distance are true to the size the road and cars are drawn at. Top speed is 150 km/h; the car reaches 100 km/h in about 6 seconds, then pulls more slowly toward 150, with the engine note climbing through six gears. Brakes stop at about 0.9 g, steering gets calmer at speed as grip runs out, and traffic cruises at 80–130 km/h.
- **Traffic:** every traffic car keeps a safe gap to whatever is ahead in its lane, other traffic or your car, braking harder the faster it closes in (up to 0.9 g) and stopping a couple of metres behind a stopped car before pulling away again. It follows the Intelligent Driver Model (`src/game/simulation/trafficFollowing.ts`). Traffic cannot swerve, so a car still crashes into you if you cut in or stop closer than it can brake.
- **Score:** distance counts every kilometre driven forward, in either direction; reversing does not add to it.
- **Pause:** use the Pause button or press `Escape`.
- **Performance diagnostics:** press `F3` to toggle the performance HUD. Add `?perf=1` to the URL to open it automatically.
- **Graphics:** open Graphics in the top bar to choose Auto, Low, Medium, or High quality. Low renders directly for speed; Medium and High add HDR bloom, MSAA, colour grading and a denser photoreal forest band. The same panel sets the time of day and weather. All choices are saved locally.

Hand-control mode accelerates automatically and only brakes on its own when it loses your hands. Keyboard mode uses manual acceleration and braking. Neither mode brakes for traffic or curves unless adaptive cruise is on, so watch the road ahead. The road has four lanes and traffic drives on the left: the two left lanes carry traffic going your way, so overtake in the inner one, and the two right lanes carry oncoming vehicles.

## Rendering

The valley is lit and shaded as one physically based system:

- **Sky and lighting:** a Preetham atmospheric sky with drifting procedural cumulus is both the backdrop and the source of a prefiltered environment map, so car paint, glass and chrome reflect the same sky the player sees. The sun light, shadows, sky disc and haze share one direction (`src/game/world/atmosphere.ts`).
- **Aerial perspective:** three.js fog chunks are replaced with exponential height fog integrated along each view ray and tinted toward the sun, so distant summits fade into the horizon realistically.
- **Terrain:** a seamless ring of ridged-noise mountains with altitude- and slope-based snow, rock and forest colouring replaces the old landscape download. Instanced conifers fill the valley, and the meadow uses world-space macro variation to hide texture tiling.
- **Cars:** every model gets a soft contact shadow, and roll and pitch are applied to the sprung body only, so the tyres stay planted while the body leans through corners and dives under braking.
- **Conditions:** each time of day and weather is one set of values (`src/game/world/conditions.ts`) shared by the sky, sun or moon light, shadows, fog and reflections. The fog's sun-scatter direction is a uniform every material shares, so switching conditions needs no shader rebuild. At night the player's headlights are a real spot light; traffic lamps are one draw call of glow sprites plus one instanced draw of light pools on the road. Street lights are instanced the same way (poles, lenses, pools and glows in four draw calls), with one real light riding on the lamp you are passing. Rain is a single GPU-animated draw of streaks that slant with your speed and catch your headlight beam. Under a full rain cloud the sun or moon and its shadow pass switch off.

## Architecture

The runtime is organized by responsibility:

- `src/app` coordinates menus, input mode, asset readiness, and game lifecycle.
- `src/game/simulation` contains deterministic gameplay rules that can be tested without WebGL.
- `src/game/world` owns reusable Three.js scene systems (sky, atmosphere, mountains, forest, fences) and their GPU-resource lifecycle.
- `src/game/rendering` contains quality tiers, post-processing and material shader extensions.
- `src/ui` renders the static shell, startup gate, and HUD.
- `src/audio` owns the procedural Web Audio graph.
- `src/controls` contains keyboard and hand-tracking input adapters.
- `src/diagnostics` contains opt-in runtime measurements that stay disabled during normal play.

Keep game rules deterministic by passing state in and returning results. DOM and Three.js mutations should stay at the edges, and every scene system that allocates GPU resources should expose `dispose()`.

## Checks

```bash
npm test
npm run build
```

The MediaPipe runtime and hand model are copied into `public/mediapipe` during `npm install`, so camera processing happens on the device without uploading video.

## License

Original Driftline source code and documentation are available under the [Driftline Non-Commercial License](LICENSE). Commercial or for-profit use is prohibited without prior written permission. Third-party assets retain their respective licenses and attribution requirements.

## 3D asset credits

- [2018 Audi e-tron GT Concept](https://sketchfab.com/3d-models/2018-audi-e-tron-gt-concept-e35726151c9e4a169c005d54509715fa) by [Ddiaz Design](https://sketchfab.com/ddiaz-design), licensed under [CC BY-NC-SA 4.0](http://creativecommons.org/licenses/by-nc-sa/4.0/).
- [Volvo V60 Polestar (2013)](https://sketchfab.com/3d-models/volvo-v60-polestar-2013-504ce39150fe49c7979f702d5f0f8580) by [Myedsu](https://sketchfab.com/myedsu), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
- [2000 Jaguar XJ Sport (X308 XJ8)](https://sketchfab.com/3d-models/2000-jaguar-xj-sport-x308-xj8-192011ef37994e8ca2f09cd1d73ca166) by [Fishboe](https://sketchfab.com/ministephen), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
- [Peugeot 3008](https://sketchfab.com/3d-models/peugeot-3008-4f7c7318a29d4e16a6047c2d58bba28d) by [iSteven](https://sketchfab.com/OneSteven), licensed under [CC BY-NC 4.0](http://creativecommons.org/licenses/by-nc/4.0/).
- [Nissan Z Proto](https://sketchfab.com/3d-models/nissan-z-proto-db9a5f7ae9d84a0fb01cac96afe3e69c) by [Lexyc16](https://sketchfab.com/Lexyc16), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
- [Nissan Skyline R34 GT-R](https://sketchfab.com/3d-models/nissan-skyline-r34-gt-r-ff8fb2251dfa4bb9979e7022c5a6666c) by [Lexyc16](https://sketchfab.com/Lexyc16), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
- [Mercedes Benz C63 AMG](https://sketchfab.com/3d-models/mercedes-benz-c63-amg-38eb721c70d34046a60ef7a8984024c5) by [LuizZed36](https://sketchfab.com/LuizZed36), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
- [BMW 7-series (F01)](https://sketchfab.com/3d-models/bmw-7-series-f01-0806c39847ae42e5996917f50527dda0) by [Black Snow](https://sketchfab.com/BlackSnow02), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
- [BMW I8](https://sketchfab.com/3d-models/bmw-i8-4b143b95aec045bf8912d99662f8d580) by [iSteven](https://sketchfab.com/OneSteven), licensed under [CC BY-NC 4.0](http://creativecommons.org/licenses/by-nc/4.0/).
- [Mercedes-Maybach Vision 6](https://sketchfab.com/3d-models/mercedes-maybach-vision-6-8445af9c07694f9b93f94b3f6c0ccd87) by [SÄNTI CUSTOMS](https://sketchfab.com/TEDIORE), licensed under [CC BY-NC 4.0](http://creativecommons.org/licenses/by-nc/4.0/).
- [Generic passenger car pack](https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5) by [Comrade1280](https://sketchfab.com/comrade1280), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
- [Pine Tree](https://sketchfab.com/3d-models/pine-tree-d45218a3fab349e5b1de040f29e7b6f9) by [evolveduk](https://sketchfab.com/evolveduk), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).

Attribution and license metadata are also embedded in each GLB file.
