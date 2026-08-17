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
