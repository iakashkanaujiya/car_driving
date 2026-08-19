import { TRAFFIC_COUNT_OPTIONS } from '../game/config';
import {
  CAR_MODEL_OPTIONS,
  CAR_MODEL_VARIETY_OPTIONS,
  DEFAULT_CAR_MODEL_ID,
} from '../game/vehicleCatalog';

/** Builds the static application shell. Dynamic overlays remain in the app controller. */
export function createGameTemplate(): string {
  const carOptions = CAR_MODEL_OPTIONS.map(({ id, label }) =>
    `<option value="${id}"${id === DEFAULT_CAR_MODEL_ID ? ' selected' : ''}>${label}</option>`,
  ).join('');
  const trafficOptions = TRAFFIC_COUNT_OPTIONS.map((count) =>
    `<option value="${count}"${count === 4 ? ' selected' : ''}>${count === 0 ? 'NO TRAFFIC' : `${count} CARS`}</option>`,
  ).join('');
  const varietyOptions = CAR_MODEL_VARIETY_OPTIONS.map((count) =>
    `<option value="${count}"${count === 1 ? ' selected' : ''}>${count} ${count === 1 ? 'MODEL' : 'MODELS'}</option>`,
  ).join('');

  return `
    <main class="game-shell">
      <div id="viewport" class="viewport" aria-label="3D driving game"></div>

      <header class="topbar">
        <a class="brand" href="#" aria-label="Driftline home">
          <span class="brand-mark"></span><span>DRIFTLINE</span>
        </a>
        <div class="topbar-actions">
          <div id="tracking-pill" class="tracking-pill">
            <span class="status-dot"></span><span id="tracking-label">INPUT NOT SET</span>
          </div>
          <button id="fullscreen-button" class="icon-button" aria-label="Enter full screen" aria-pressed="false">FULL SCREEN</button>
          <button id="mute-button" class="icon-button" aria-label="Toggle sound">SOUND ON</button>
          <button id="pause-button" class="icon-button" aria-label="Pause game">PAUSE</button>
        </div>
      </header>

      <section id="hud" class="hud is-hidden" aria-live="polite">
        <div class="speed-panel">
          <div class="speed-number"><span id="speed">000</span><small>KM/H</small></div>
          <div class="speed-track"><span id="speed-fill"></span></div>
        </div>
        <div class="run-stats">
          <div><span>DISTANCE</span><strong id="distance">0.00 <small>KM</small></strong></div>
          <div><span>OVERTAKES</span><strong id="overtakes">0</strong></div>
          <div><span>SCORE</span><strong id="score">000000</strong></div>
        </div>
        <div id="assist" class="assist"><i></i><span>READY</span></div>
        <div class="steer-meter">
          <span>L</span><div class="steer-track"><i id="steer-indicator"></i></div><span>R</span>
        </div>
      </section>

      <aside class="camera-shell is-offline is-hidden" aria-label="Camera tracking preview">
        <video id="camera-video" playsinline muted></video>
        <canvas id="camera-canvas"></canvas>
        <div class="camera-topline"><span><i></i> HAND CAM</span><button id="hide-camera">HIDE</button></div>
        <div id="camera-hint" class="camera-hint">WAITING FOR CAMERA</div>
      </aside>
      <button id="show-camera" class="show-camera is-hidden">SHOW HAND CAM</button>

      <section id="overlay" class="overlay">
        <div class="modal intro-modal">
          <div class="eyebrow"><span></span> TWO-HAND DRIVING EXPERIENCE</div>
          <h1>YOUR HANDS.<br><em>YOUR ROAD.</em></h1>
          <p class="lead">Grip an invisible wheel. Turn naturally, and raise both thumbs to brake.</p>
          <div class="wheel-guide" aria-hidden="true">
            <div class="hand hand-left"><span></span><b>LEFT HAND</b></div>
            <div class="virtual-wheel"><span class="wheel-center"></span></div>
            <div class="hand hand-right"><span></span><b>RIGHT HAND</b></div>
          </div>
          <div class="instruction-row">
            <div><b>01</b><span>Allow camera<br>access</span></div>
            <div><b>02</b><span>Hold two closed<br>hands apart</span></div>
            <div><b>03</b><span>Rotate to steer<br>thumbs up to brake</span></div>
          </div>
          <div id="car-options" class="car-options">
            <label><span>YOUR CAR</span><select id="driver-car" aria-label="Choose your car model">${carOptions}</select></label>
            <label><span>TRAFFIC CARS</span><select id="traffic-count" aria-label="Choose number of traffic cars">${trafficOptions}</select></label>
            <label><span>CAR VARIETY</span><select id="car-model-count" aria-label="Choose number of different car models">${varietyOptions}</select></label>
          </div>
          <p class="traffic-performance-note"><i>!</i> More traffic cars or model variety may reduce frame rates on lower-powered devices.</p>
          <div class="modal-actions">
            <button id="camera-start" class="primary-button"><span>START WITH HANDS</span><i>→</i></button>
            <button id="keyboard-start" class="secondary-button">USE KEYBOARD INSTEAD <small>WASD / ARROWS</small></button>
          </div>
          <p class="privacy"><i>●</i> Camera processing stays on this device. No video is saved or uploaded.</p>
        </div>
      </section>

      <section id="asset-gate" class="asset-gate" role="dialog" aria-modal="true" aria-labelledby="asset-gate-title">
        <div class="modal compact-modal asset-gate-modal">
          <div class="eyebrow"><span></span> GAME STARTUP</div>
          <h2 id="asset-gate-title">GAME IS<br>LOADING.</h2>
          <p id="asset-gate-message">Downloading and preparing the required game files. Future visits will load from browser storage.</p>
          <div id="asset-loader" class="asset-loader" aria-hidden="true"><span id="asset-download-percent">0%</span></div>
          <div id="asset-download" class="asset-download" data-state="checking" role="status" aria-live="polite">
            <div class="asset-download-head"><span id="asset-download-label">CHECKING ASSETS</span></div>
            <div class="asset-download-track"><i id="asset-download-fill"></i></div>
            <small id="asset-download-detail">Checking browser storage...</small>
          </div>
          <button id="asset-download-retry" class="secondary-button is-hidden" type="button">RETRY DOWNLOAD</button>
        </div>
      </section>

      <div class="corner corner-tl"></div><div class="corner corner-tr"></div>
      <div class="corner corner-bl"></div><div class="corner corner-br"></div>
    </main>
  `;
}
