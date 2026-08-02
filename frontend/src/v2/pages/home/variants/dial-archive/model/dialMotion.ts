export interface SpringState {
  position: number;
  velocity: number;
}

export interface SpringSpecification {
  angularFrequency: number;
  dampingRatio: number;
  maximumVelocity: number;
}

export const OUTER_DIAL_SPRING: SpringSpecification = Object.freeze({
  angularFrequency: 9.4,
  dampingRatio: 0.92,
  maximumVelocity: 560,
});

export const INNER_DIAL_SPRING: SpringSpecification = Object.freeze({
  angularFrequency: 6.4,
  dampingRatio: 0.78,
  maximumVelocity: 360,
});

export const IDLE_FRAME_DEGREES_PER_SECOND = 2.4;
export const IDLE_INNER_DEGREES_PER_SECOND = -3.2;

export function integrateSpring(
  state: SpringState,
  target: number,
  elapsedSeconds: number,
  specification: SpringSpecification,
): void {
  const boundedElapsed = Math.max(0, elapsedSeconds);
  const slices = Math.max(1, Math.ceil(boundedElapsed / (1 / 120)));
  const stepSeconds = boundedElapsed / slices;

  for (let index = 0; index < slices; index += 1) {
    const acceleration =
      specification.angularFrequency ** 2 * (target - state.position) -
      2 * specification.dampingRatio * specification.angularFrequency * state.velocity;
    state.velocity = Math.max(
      -specification.maximumVelocity,
      Math.min(specification.maximumVelocity, state.velocity + acceleration * stepSeconds),
    );
    state.position += state.velocity * stepSeconds;
  }
}

export function springIsSettled(state: SpringState, target: number): boolean {
  return Math.abs(target - state.position) < 0.05 && Math.abs(state.velocity) < 0.6;
}

export function dampedValue(
  current: number,
  target: number,
  elapsedSeconds: number,
  response = 5,
): number {
  const elapsed = Math.max(0, elapsedSeconds);
  return target + (current - target) * Math.exp(-response * elapsed);
}

export function nearestEquivalentAngle(target: number, current: number): number {
  return target + 360 * Math.round((current - target) / 360);
}

export function normalizeDegrees(value: number): number {
  const normalized = ((((value + 180) % 360) + 360) % 360) - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function formatDialDegrees(value: number): string {
  const sign = value < 0 ? "-" : "+";
  return `${sign}${Math.abs(value).toFixed(1).padStart(5, "0")}°`;
}
