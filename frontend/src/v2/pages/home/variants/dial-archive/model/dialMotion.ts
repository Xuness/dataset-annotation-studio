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

export function formatDialDegrees(value: number): string {
  const sign = value < 0 ? "-" : "+";
  return `${sign}${Math.abs(value).toFixed(1).padStart(5, "0")}°`;
}
