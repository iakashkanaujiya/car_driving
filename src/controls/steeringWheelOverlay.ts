/**
 * A virtual yoke-style steering wheel (open top, flat bottom, side grips, in
 * the manner of performance-EV yokes) drawn over the hand-cam preview. The
 * grips sit in both fists and the yoke turns with them, so players see the
 * wheel they are "holding" instead of raw tracking landmarks.
 */

export interface WheelPoint {
  x: number;
  y: number;
}

/** Wheel placement in canvas pixels; `angle` points from the first grip to the second. */
export interface WheelPose {
  x: number;
  y: number;
  radius: number;
  angle: number;
}

export type WheelState = 'idle' | 'gripping' | 'calibrating' | 'braking';

export interface WheelVisual {
  state: WheelState;
  /** Overall opacity; the idle "ghost" wheel is drawn faintly. */
  alpha: number;
  /** Calibration progress in [0, 1]. */
  calibration: number;
  /** Brake request in [0, 1]: 0.5 for thumbs-up, 1 for open palms. */
  brakePressure: number;
  /** True when drawn into a horizontally mirrored (selfie) canvas. */
  mirrored?: boolean;
}

const TAU = Math.PI * 2;
/** Wrist and finger-base landmarks: their mean is the centre of a closed fist. */
const PALM_LANDMARKS = [0, 5, 9, 13, 17] as const;
const MIN_RADIUS = 14;
const BRAND = '#ecff76';
const ACCENTS: Record<Exclude<WheelState, 'idle'>, string> = {
  gripping: '#55e8ff',
  calibrating: '#ffb866',
  braking: '#ff4d4d',
};

export function gripPoint(hand: readonly WheelPoint[], width: number, height: number): WheelPoint {
  let x = 0;
  let y = 0;
  for (const index of PALM_LANDMARKS) {
    x += hand[index].x;
    y += hand[index].y;
  }
  return { x: (x / PALM_LANDMARKS.length) * width, y: (y / PALM_LANDMARKS.length) * height };
}

/**
 * Places the wheel so its rim runs through both fists. Angles are measured in
 * pixels, not normalized landmark units, so non-square cameras stay accurate.
 */
export function wheelPoseFromHands(
  hands: readonly (readonly WheelPoint[])[],
  width: number,
  height: number,
): WheelPose | null {
  if (hands.length !== 2 || hands.some((hand) => hand.length <= PALM_LANDMARKS.at(-1)!)) {
    return null;
  }
  const [a, b] = hands.map((hand) => gripPoint(hand, width, height)).sort((p, q) => p.x - q.x);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    radius: Math.max(MIN_RADIUS, Math.hypot(dx, dy) / 2),
    angle: Math.atan2(dy, dx),
  };
}

/** Where the ghost wheel waits for the player's hands. */
export function defaultWheelPose(width: number, height: number): WheelPose {
  return { x: width / 2, y: height * 0.56, radius: Math.min(width, height) * 0.3, angle: 0 };
}

/** Frame-rate independent smoothing; rotation always takes the shorter arc. */
export function smoothWheelPose(
  current: WheelPose,
  target: WheelPose,
  dt: number,
  rate = 16,
): WheelPose {
  const t = 1 - Math.exp(-rate * Math.max(0, dt));
  const turn = Math.atan2(
    Math.sin(target.angle - current.angle),
    Math.cos(target.angle - current.angle),
  );
  return {
    x: current.x + (target.x - current.x) * t,
    y: current.y + (target.y - current.y) * t,
    radius: current.radius + (target.radius - current.radius) * t,
    angle: current.angle + turn * t,
  };
}

function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

type Point = readonly [number, number];

function arcPoints(
  cx: number,
  cy: number,
  r: number,
  from: number,
  to: number,
  steps: number,
): Point[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = from + ((to - from) * index) / steps;
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r] as const;
  });
}

function linePoints(a: Point, b: Point, steps: number): Point[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as const;
  });
}

/** Each horn is a quarter-round top corner ending in a short inward stub. */
const HORN_SWEEP = Math.PI / 2;

/**
 * Centreline of the yoke rim in units of the grip radius (grips at x = +/-1,
 * y = 0, +y down). It runs from the left horn tip, down the left grip, across
 * the flat bottom and up to the right horn tip; the top is open.
 */
export function yokeOutline(): Point[] {
  const right: Point[] = [
    ...linePoints([0, 0.74], [0.6, 0.74], 6),
    ...arcPoints(0.6, 0.34, 0.4, Math.PI / 2, 0, 9).slice(1),
    ...linePoints([1, 0.34], [1, -0.3], 7).slice(1),
    ...arcPoints(0.78, -0.3, 0.22, 0, -HORN_SWEEP, 7).slice(1),
    ...linePoints([0.78, -0.52], [0.7, -0.52], 2).slice(1),
  ];
  const left = right
    .slice(1)
    .reverse()
    .map(([x, y]) => [-x, y] as const);
  return [...left, ...right];
}

const YOKE = yokeOutline();

function tracePath(
  context: CanvasRenderingContext2D,
  points: readonly Point[],
  scale: number,
  dx = 0,
  dy = 0,
): void {
  context.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) context.moveTo(x * scale + dx, y * scale + dy);
    else context.lineTo(x * scale + dx, y * scale + dy);
  });
}

/** The leading `fraction` of a polyline, measured by length. */
function partialPath(points: readonly Point[], fraction: number): Point[] {
  const lengths = points
    .slice(1)
    .map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  let remaining =
    lengths.reduce((sum, length) => sum + length, 0) * Math.min(1, Math.max(0, fraction));
  const out: Point[] = [points[0]];
  for (let index = 0; index < lengths.length && remaining > 0; index += 1) {
    const length = lengths[index];
    const [ax, ay] = points[index];
    const [bx, by] = points[index + 1];
    const t = Math.min(1, remaining / length);
    out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    remaining -= length;
  }
  return out;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

const carbonPatterns = new WeakMap<CanvasRenderingContext2D, CanvasPattern | null>();

/** A 2x2 twill weave tile, cached per context. */
function carbonPattern(context: CanvasRenderingContext2D): CanvasPattern | null {
  if (carbonPatterns.has(context)) return carbonPatterns.get(context)!;
  let pattern: CanvasPattern | null = null;
  if (typeof document !== 'undefined') {
    const tile = document.createElement('canvas');
    tile.width = 8;
    tile.height = 8;
    const weave = tile.getContext('2d');
    if (weave) {
      for (let cell = 0; cell < 4; cell += 1) {
        const x = (cell % 2) * 4;
        const y = Math.floor(cell / 2) * 4;
        const horizontal = cell === 0 || cell === 3;
        const sheen = horizontal
          ? weave.createLinearGradient(x, y, x, y + 4)
          : weave.createLinearGradient(x, y, x + 4, y);
        sheen.addColorStop(0, '#0d0f11');
        sheen.addColorStop(0.5, horizontal ? '#2c3136' : '#22262a');
        sheen.addColorStop(1, '#0d0f11');
        weave.fillStyle = sheen;
        weave.fillRect(x, y, 4, 4);
      }
      pattern = context.createPattern(tile, 'repeat');
    }
  }
  carbonPatterns.set(context, pattern);
  return pattern;
}

function drawCrossbar(
  context: CanvasRenderingContext2D,
  radius: number,
  tube: number,
  visual: WheelVisual,
): void {
  const r = radius;
  const reach = r - tube * 0.35;
  // Carbon-fibre spoke spanning grip to grip, deepening toward the centre pad.
  context.beginPath();
  context.moveTo(-reach, -0.17 * r);
  context.quadraticCurveTo(0, -0.07 * r, reach, -0.17 * r);
  context.lineTo(reach, 0.25 * r);
  context.quadraticCurveTo(0.56 * r, 0.27 * r, 0.35 * r, 0.37 * r);
  context.lineTo(-0.35 * r, 0.37 * r);
  context.quadraticCurveTo(-0.56 * r, 0.27 * r, -reach, 0.25 * r);
  context.closePath();
  const carbon = carbonPattern(context);
  if (carbon) {
    carbon.setTransform?.(new DOMMatrix().scale(Math.max(0.6, r / 140)));
    context.fillStyle = carbon;
  } else {
    context.fillStyle = '#1a1d21';
  }
  context.fill();
  // Clear-coat sheen over the weave.
  const gloss = context.createLinearGradient(0, -0.17 * r, 0, 0.37 * r);
  gloss.addColorStop(0, 'rgba(255, 255, 255, 0.16)');
  gloss.addColorStop(0.45, 'rgba(255, 255, 255, 0.02)');
  gloss.addColorStop(1, 'rgba(0, 0, 0, 0.25)');
  context.fillStyle = gloss;
  context.fill();
  context.strokeStyle = 'rgba(0, 0, 0, 0.7)';
  context.lineWidth = Math.max(1, tube * 0.08);
  context.stroke();

  // Scroll wheels with capacitive buttons above and below, on both spokes.
  for (const side of [-1, 1]) {
    const cx = side * 0.66 * r;
    const wheelWidth = 0.1 * r;
    const wheelHeight = 0.24 * r;
    const knurl = context.createLinearGradient(cx - wheelWidth / 2, 0, cx + wheelWidth / 2, 0);
    knurl.addColorStop(0, '#2b3035');
    knurl.addColorStop(0.5, '#9ca5ac');
    knurl.addColorStop(1, '#2b3035');
    roundedRect(
      context,
      cx - wheelWidth / 2,
      0.04 * r - wheelHeight / 2,
      wheelWidth,
      wheelHeight,
      wheelWidth / 2,
    );
    context.fillStyle = knurl;
    context.fill();
    context.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    context.lineWidth = Math.max(0.8, r * 0.006);
    for (let ridge = -4; ridge <= 4; ridge += 1) {
      const y = 0.04 * r + (ridge / 5) * (wheelHeight / 2);
      context.beginPath();
      context.moveTo(cx - wheelWidth * 0.42, y);
      context.lineTo(cx + wheelWidth * 0.42, y);
      context.stroke();
    }
    context.fillStyle = 'rgba(232, 238, 242, 0.55)';
    for (const dy of [-0.16, 0.2]) {
      context.beginPath();
      context.arc(cx + side * 0.13 * r, dy * r, Math.max(1, r * 0.022), 0, TAU);
      context.fill();
    }
    context.beginPath();
    context.arc(cx - side * 0.15 * r, 0.04 * r, Math.max(1, r * 0.018), 0, TAU);
    context.fill();
  }

  // Glossy centre pad with the Driftline emblem.
  const padWidth = 0.62 * r;
  const padHeight = 0.36 * r;
  const padY = 0.08 * r;
  roundedRect(context, -padWidth / 2, padY - padHeight / 2, padWidth, padHeight, padHeight * 0.32);
  const pad = context.createLinearGradient(0, padY - padHeight / 2, 0, padY + padHeight / 2);
  pad.addColorStop(0, '#2d3238');
  pad.addColorStop(0.5, '#0e1013');
  pad.addColorStop(1, '#050607');
  context.fillStyle = pad;
  context.fill();
  context.strokeStyle = 'rgba(160, 170, 178, 0.45)';
  context.lineWidth = Math.max(1, tube * 0.07);
  context.stroke();

  if (visual.brakePressure > 0) {
    context.save();
    const brake = visual.brakePressure >= 1 ? ACCENTS.braking : '#ffb020';
    context.shadowColor = brake;
    context.shadowBlur = padHeight;
    context.fillStyle = withAlpha(brake, 0.32 + 0.45 * visual.brakePressure);
    roundedRect(
      context,
      -padWidth / 2,
      padY - padHeight / 2,
      padWidth,
      padHeight,
      padHeight * 0.32,
    );
    context.fill();
    context.restore();
  }

  const size = padHeight * 0.26;
  context.strokeStyle = BRAND;
  context.lineWidth = Math.max(1.2, size * 0.22);
  context.beginPath();
  context.moveTo(0, padY - size);
  context.lineTo(size, padY);
  context.lineTo(0, padY + size);
  context.lineTo(-size, padY);
  context.closePath();
  context.stroke();
}

function drawRim(
  context: CanvasRenderingContext2D,
  radius: number,
  tube: number,
  angle: number,
): void {
  context.lineCap = 'round';
  context.lineJoin = 'round';
  tracePath(context, YOKE, radius);
  context.strokeStyle = '#050607';
  context.lineWidth = tube * 1.12;
  context.stroke();
  context.strokeStyle = '#23282d';
  context.lineWidth = tube;
  context.stroke();
  // Inner body tone gives the grips a rounded, padded section.
  context.strokeStyle = '#30363c';
  context.lineWidth = tube * 0.55;
  context.stroke();

  // Perforated leather and contrast stitching where the fists hold the grips.
  for (const side of [-1, 1]) {
    const x = side * radius;
    context.setLineDash([0.01, tube * 0.2]);
    context.strokeStyle = 'rgba(8, 9, 11, 0.85)';
    context.lineWidth = Math.max(1, tube * 0.11);
    for (const offset of [-0.18, 0, 0.18]) {
      context.beginPath();
      context.moveTo(x + offset * tube, -0.22 * radius);
      context.lineTo(x + offset * tube, 0.28 * radius);
      context.stroke();
    }
    context.setLineDash([tube * 0.2, tube * 0.18]);
    context.strokeStyle = 'rgba(214, 222, 228, 0.38)';
    context.lineWidth = Math.max(0.8, tube * 0.06);
    for (const offset of [-0.4, 0.4]) {
      context.beginPath();
      context.moveTo(x + offset * tube, -0.27 * radius);
      context.lineTo(x + offset * tube, 0.33 * radius);
      context.stroke();
    }
  }
  context.setLineDash([]);

  // Specular highlight biased toward the top of the screen as the yoke turns.
  const lightX = Math.sin(angle) * tube * -0.24;
  const lightY = Math.cos(angle) * tube * -0.24;
  tracePath(context, YOKE, radius, lightX, lightY);
  context.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  context.lineWidth = tube * 0.16;
  context.stroke();
}

export function drawSteeringWheel(
  context: CanvasRenderingContext2D,
  pose: WheelPose,
  visual: WheelVisual,
): void {
  const radius = Math.max(MIN_RADIUS, pose.radius);
  const tube = Math.max(6, radius * 0.17);
  const accent =
    visual.state === 'braking' && visual.brakePressure < 1
      ? '#ffb020'
      : visual.state === 'idle'
        ? undefined
        : ACCENTS[visual.state];

  context.save();
  context.globalAlpha = Math.max(0, Math.min(1, visual.alpha));

  // Soft shadow below the yoke gives it depth over the camera feed.
  context.save();
  context.translate(pose.x + radius * 0.02, pose.y + radius * 0.07);
  context.rotate(pose.angle);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  tracePath(context, YOKE, radius);
  context.strokeStyle = 'rgba(0, 0, 0, 0.34)';
  context.lineWidth = tube * 1.15;
  context.stroke();
  context.restore();

  context.translate(pose.x, pose.y);
  context.rotate(pose.angle);

  if (accent) {
    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.shadowColor = accent;
    context.shadowBlur = radius * 0.22;
    tracePath(context, YOKE, radius);
    context.strokeStyle = withAlpha(accent, 0.5);
    context.lineWidth = tube * 0.7;
    context.stroke();
    context.restore();
  }

  drawCrossbar(context, radius, tube, visual);
  drawRim(context, radius, tube, pose.angle);

  if (visual.state === 'calibrating' && visual.calibration > 0) {
    // Fill along the yoke clockwise as the player sees it, even when mirrored.
    const path = visual.mirrored ? YOKE : [...YOKE].reverse();
    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.shadowColor = BRAND;
    context.shadowBlur = tube;
    tracePath(context, partialPath(path, visual.calibration), radius);
    context.strokeStyle = BRAND;
    context.lineWidth = tube * 0.32;
    context.stroke();
    context.restore();
  }

  // Lock rings around each fist confirm the yoke is held.
  if (accent) {
    context.strokeStyle = withAlpha(accent, 0.9);
    context.lineWidth = Math.max(1.5, tube * 0.12);
    for (const grip of [-radius, radius]) {
      context.beginPath();
      context.arc(grip, 0, tube * 0.95, 0, TAU);
      context.stroke();
    }
  }
  context.restore();
}
