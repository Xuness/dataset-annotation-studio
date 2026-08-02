export const DIAL_CENTER = 500;
export const DIAL_NUMBER_RADIUS = 444;
export const DIAL_INNER_RATIO = -0.42;
export const DIAL_PREVIEW_INTENT_MS = 56;

export const DIAL_SEGMENT_REST_ANGLES = [-198, -144, -90, -36, 18, 72] as const;
export const DIAL_GAP_REST_ANGLE = 126;
export const DIAL_NUMBER_REST_ANGLES = [...DIAL_SEGMENT_REST_ANGLES, DIAL_GAP_REST_ANGLE] as const;

export type DialPoint = readonly [x: number, y: number];

export function polarPoint(radius: number, degrees: number): DialPoint {
  const angle = (degrees * Math.PI) / 180;
  return [DIAL_CENTER + radius * Math.cos(angle), DIAL_CENTER + radius * Math.sin(angle)];
}

function pathPoint(radius: number, degrees: number): string {
  return polarPoint(radius, degrees)
    .map((value) => value.toFixed(2))
    .join(" ");
}

export function arcPath(radius: number, startDegrees: number, endDegrees: number): string {
  const [startX, startY] = polarPoint(radius, startDegrees);
  const [endX, endY] = polarPoint(radius, endDegrees);
  const largeArc = Math.abs(endDegrees - startDegrees) > 180 ? 1 : 0;
  return `M ${startX.toFixed(2)} ${startY.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${endX.toFixed(2)} ${endY.toFixed(2)}`;
}

export function ringSectorPath(
  innerRadius: number,
  outerRadius: number,
  startDegrees: number,
  endDegrees: number,
): string {
  const largeArc = Math.abs(endDegrees - startDegrees) > 180 ? 1 : 0;
  return (
    `M ${pathPoint(outerRadius, startDegrees)} ` +
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${pathPoint(outerRadius, endDegrees)} ` +
    `L ${pathPoint(innerRadius, endDegrees)} ` +
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${pathPoint(innerRadius, startDegrees)} Z`
  );
}

export function readerWedgePath(): string {
  const outerRadius = 430;
  const middleRadius = 402;
  const innerRadius = 360;
  const outerStart = -108;
  const outerEnd = -72;
  const innerStart = -103.5;
  const innerEnd = -76.5;

  return (
    `M ${pathPoint(outerRadius, outerStart)} ` +
    `A ${outerRadius} ${outerRadius} 0 0 1 ${pathPoint(outerRadius, outerEnd)} ` +
    `L ${pathPoint(middleRadius, outerEnd)} ` +
    `A ${middleRadius} ${middleRadius} 0 0 0 ${pathPoint(middleRadius, innerEnd)} ` +
    `L ${pathPoint(innerRadius, innerEnd)} ` +
    `A ${innerRadius} ${innerRadius} 0 0 0 ${pathPoint(innerRadius, innerStart)} ` +
    `L ${pathPoint(middleRadius, innerStart)} ` +
    `A ${middleRadius} ${middleRadius} 0 0 0 ${pathPoint(middleRadius, outerStart)} Z`
  );
}

export function dialRotationForIndex(index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= DIAL_SEGMENT_REST_ANGLES.length) {
    throw new RangeError(`Invalid dial space index: ${index}`);
  }
  return (2 - index) * 54;
}

export function dialNumberPoint(index: number, rotation: number): DialPoint {
  const restAngle = DIAL_NUMBER_REST_ANGLES[index];
  if (restAngle === undefined) throw new RangeError(`Invalid dial number index: ${index}`);
  return polarPoint(DIAL_NUMBER_RADIUS, restAngle + rotation);
}

export function degreesFrom(step: number): readonly number[] {
  return Object.freeze(Array.from({ length: Math.ceil(360 / step) }, (_, index) => index * step));
}
