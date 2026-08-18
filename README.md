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
| 2021 Ford Bronco 2-door (default) | Yes | Yes |
| Mercedes-Benz G-Class W263 | Yes | Yes |
| 2021 Mercedes-Maybach S-Class | Yes | Yes |
| 2018 Audi e-tron GT Concept | Yes | Yes |
| 2023 Audi R8 Coupe V10 GT RWD | Yes | Yes |
| BMW i8 | Yes | Yes |
| 2023 Hyundai Creta | Yes | Yes |
| 1970 Chevrolet Camaro | Yes | Yes |
| 1976 Volkswagen Golf GTI Mk1 | Yes | Yes |

Cartoon-car mode uses the game's lightweight procedural vehicle instead of downloaded GLTF models. Real traffic can be configured for 4, 8, 12, or 16 cars.

On the first visit, a setup popup keeps the game locked while it downloads approximately 73.1 MB of real-car models and textures with live progress. These files are stored in the browser cache and reused on later visits. Interrupted downloads can be retried and resume from files that are already cached.

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

- [2021 Ford Bronco 2-door](https://sketchfab.com/3d-models/2021-ford-bronco-2-door-98b8590146a8447da52a1fefce064f0b) by [Ddiaz Design](https://sketchfab.com/ddiaz-design), licensed under [CC BY-NC-SA 4.0](http://creativecommons.org/licenses/by-nc-sa/4.0/).
- [Mercedes-Benz G-Class W263](https://sketchfab.com/3d-models/mercedes-benz-g-class-w263-1a2a52b16cad4e618af347461817895c) by [Lexyc16](https://sketchfab.com/Lexyc16), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
- [2021 Mercedes-Benz S-Class Maybach](https://sketchfab.com/3d-models/2021-mercedes-benz-s-class-maybach-53c739ff5512413e8d6c373c65b95047) by [Ddiaz Design](https://sketchfab.com/ddiaz-design), licensed under [CC BY-NC 4.0](http://creativecommons.org/licenses/by-nc/4.0/).
- [2018 Audi e-tron GT Concept](https://sketchfab.com/3d-models/2018-audi-e-tron-gt-concept-e35726151c9e4a169c005d54509715fa) by [Ddiaz Design](https://sketchfab.com/ddiaz-design), licensed under [CC BY-NC-SA 4.0](http://creativecommons.org/licenses/by-nc-sa/4.0/).
- [2023 Audi R8 Coupe V10 GT RWD](https://sketchfab.com/3d-models/2023-audi-r8-coupe-v10-gt-rwd-0701d14ce550407f900df891316788f0) by [Ddiaz Design](https://sketchfab.com/ddiaz-design), licensed under [CC BY-NC-SA 4.0](http://creativecommons.org/licenses/by-nc-sa/4.0/).
- [BMW i8](https://sketchfab.com/3d-models/bmw-i8-4b143b95aec045bf8912d99662f8d580) by [iSteven](https://sketchfab.com/OneSteven), licensed under [CC BY-NC 4.0](http://creativecommons.org/licenses/by-nc/4.0/).
- [2023 Hyundai Creta](https://sketchfab.com/3d-models/2023-hyundai-creta-3cc28d4cf5574383b7dc030638ee6199) by [Ddiaz Design](https://sketchfab.com/ddiaz-design), licensed under [CC BY-NC 4.0](http://creativecommons.org/licenses/by-nc/4.0/).
- [1970 Chevrolet Camaro](https://sketchfab.com/3d-models/1970-chevrolet-camaro-789b0af67d994306b967facf75ab2e01) by [DisneyCars](https://sketchfab.com/supercarmodels), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
- [1976 Volkswagen Golf GTI Mk1](https://sketchfab.com/3d-models/1976-volkswagen-golf-gti-mk1-1fc46cb37bd748e3bb9355fcedaf3817) by [Ddiaz Design](https://sketchfab.com/ddiaz-design), licensed under [CC BY-NC-SA 4.0](http://creativecommons.org/licenses/by-nc-sa/4.0/).

The original license files are retained beside each model in `public/models`.
