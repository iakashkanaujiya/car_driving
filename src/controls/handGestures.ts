import type { HandPoint } from './handWorkerTypes';

const pointDistance = (a: HandPoint, b: HandPoint): number => Math.hypot(a.x - b.x, a.y - b.y);

export function isClosedHand(landmarks: HandPoint[]): boolean {
  if (landmarks.length < 21) return false;
  const wrist = landmarks[0];
  const tips = [8, 12, 16, 20];
  const mcps = [5, 9, 13, 17];
  let folded = 0;
  for (let index = 0; index < tips.length; index += 1) {
    const tipDistance = pointDistance(landmarks[tips[index]], wrist);
    const mcpDistance = pointDistance(landmarks[mcps[index]], wrist);
    if (tipDistance < mcpDistance * 1.58) folded += 1;
  }
  return folded >= 3;
}

export function isThumbUp(landmarks: HandPoint[]): boolean {
  if (!isClosedHand(landmarks)) return false;

  const wrist = landmarks[0];
  const thumbMcp = landmarks[2];
  const thumbIp = landmarks[3];
  const thumbTip = landmarks[4];
  const handScale = pointDistance(wrist, landmarks[9]);
  if (handScale <= 0) return false;

  const verticalRise = thumbIp.y - thumbTip.y;
  const horizontalDrift = Math.abs(thumbTip.x - thumbIp.x);
  const knuckleTop = Math.min(landmarks[5].y, landmarks[17].y);

  return (
    verticalRise > handScale * 0.22 &&
    thumbTip.y < thumbMcp.y - handScale * 0.12 &&
    thumbTip.y < knuckleTop - handScale * 0.12 &&
    horizontalDrift < verticalRise * 1.15
  );
}
