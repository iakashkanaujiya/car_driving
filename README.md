# Driftline

A stylized endless-driving game controlled by a two-hand virtual steering wheel. The browser tracks two closed hands locally, converts their angle into steering, and automatically manages acceleration and braking for curves and traffic.

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

## Available car models

Real-car mode lets you select any of these vehicles as the driver car. Traffic reuses the same model collection with randomized realistic paint colors.

| Vehicle | Driver car | Traffic car |
| --- | :---: | :---: |
| 2023 Ford Everest Sport (default) | Yes | Yes |
| Hyundai Ioniq 5 | Yes | Yes |

Concept-car mode uses the 2018 Audi e-tron GT Concept for both the driver and traffic. Real-car mode remains selectable, with traffic configurable for 4, 8, 12, or 16 cars.

On the first visit, a setup popup keeps the game locked while it downloads approximately 24 MB of car models and embedded textures with live progress. These files are stored in the browser cache and reused on later visits. Interrupted downloads can be retried and resume from files that are already cached.

## Controls

- **Hand mode:** hold two closed hands apart, keep them level during calibration, then rotate them like a steering wheel.
- **Keyboard mode:** use `A` / `D` or the left / right arrow keys.
- **Pause:** use the Pause button or press `Escape`.

The car accelerates automatically and slows for traffic, sharper curves, and lost hand tracking. Drive on the left with same-direction traffic; the right lane carries oncoming vehicles and can be used carefully for overtaking.

## Checks

```bash
npm test
npm run build
```

The MediaPipe runtime and hand model are copied into `public/mediapipe` during `npm install`, so camera processing happens on the device without uploading video.

## 3D asset credits

- [2023 Ford Everest Sport](https://sketchfab.com/3d-models/ford-everest-sport-2023-c37bec0353a94f90a3acbe09ceb3aecf) by [Asadawut.Kaewma](https://sketchfab.com/Asadawut.Kaewma), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
- [Hyundai Ioniq 5](https://sketchfab.com/3d-models/hyundai-ioniq-5-lowpoly-675e78311e8440d88714bd212cb7a8fb) by [andikapratamaw](https://sketchfab.com/andikapratamaw), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
- [2018 Audi e-tron GT Concept](https://sketchfab.com/3d-models/2018-audi-e-tron-gt-concept-e35726151c9e4a169c005d54509715fa) by [Ddiaz Design](https://sketchfab.com/ddiaz-design), licensed under [CC BY-NC-SA 4.0](http://creativecommons.org/licenses/by-nc-sa/4.0/).
- [Pine Tree](https://sketchfab.com/3d-models/pine-tree-d45218a3fab349e5b1de040f29e7b6f9) by [evolveduk](https://sketchfab.com/evolveduk), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).

Attribution and license metadata are also embedded in each GLB file.
