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
| 2021 Tata Safari (default) | Yes | Yes |
| 2022 Mahindra Scorpio-N | Yes | Yes |
| 2021 Ford Bronco 2-door | Yes | Yes |
| 2023 Hyundai Creta | Yes | Yes |
| Tata Tiago | Yes | Yes |
| 1970 Chevrolet Camaro | Yes | Yes |
| 1970 Pontiac Firebird Trans Am | Yes | Yes |
| 1976 Volkswagen Golf GTI Mk1 | Yes | Yes |

Cartoon-car mode uses the game's lightweight procedural vehicle instead of downloaded GLTF models. Real traffic can be configured for 4, 8, 12, or 16 cars.

On the first visit, a setup popup keeps the game locked while it downloads approximately 168.5 MB of real-car models and textures with live progress. These files are stored in the browser cache and reused on later visits. Interrupted downloads can be retried and resume from files that are already cached.

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

## 3D car credits

- [2021 Tata Safari](https://sketchfab.com/3d-models/2021-tata-safari-3051714dba91468f9d3f4f15305c2541) by [BHP3D](https://sketchfab.com/BHP3D), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
- [2022 Mahindra Scorpio-N](https://sketchfab.com/3d-models/2022-mahindra-scorpio-n-538b10f2860f44e694dc3e9d3e223bf8) by [BHP3D](https://sketchfab.com/BHP3D), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
- [2021 Ford Bronco 2-door](https://sketchfab.com/3d-models/2021-ford-bronco-2-door-98b8590146a8447da52a1fefce064f0b) by [Ddiaz Design](https://sketchfab.com/ddiaz-design), licensed under [CC BY-NC-SA 4.0](http://creativecommons.org/licenses/by-nc-sa/4.0/).
- [2023 Hyundai Creta](https://sketchfab.com/3d-models/2023-hyundai-creta-3cc28d4cf5574383b7dc030638ee6199) by [Ddiaz Design](https://sketchfab.com/ddiaz-design), licensed under [CC BY-NC 4.0](http://creativecommons.org/licenses/by-nc/4.0/).
- [Tata Tiago](https://sketchfab.com/3d-models/tata-tiago-7ae10b287a184453b19a83ed5b37c007) by [BHP3D](https://sketchfab.com/BHP3D), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
- [1970 Chevrolet Camaro](https://sketchfab.com/3d-models/1970-chevrolet-camaro-789b0af67d994306b967facf75ab2e01) by [DisneyCars](https://sketchfab.com/supercarmodels), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
- [1970 Pontiac Firebird Trans Am](https://sketchfab.com/3d-models/1970-pontiac-firebird-trans-am-192ee303d279425b974ccfe4eb3edfff) by [everhard](https://sketchfab.com/everhard), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
- [1976 Volkswagen Golf GTI Mk1](https://sketchfab.com/3d-models/1976-volkswagen-golf-gti-mk1-1fc46cb37bd748e3bb9355fcedaf3817) by [Ddiaz Design](https://sketchfab.com/ddiaz-design), licensed under [CC BY-NC-SA 4.0](http://creativecommons.org/licenses/by-nc-sa/4.0/).

The original license files are retained beside each model in `public/models`.
