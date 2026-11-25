export const MOVEMENT_SPEEDS = Object.freeze({
  walk: 45,
  run: 65,
} as const);

export type MovementMode = keyof typeof MOVEMENT_SPEEDS;

export function movementSpeed(mode: string): number {
  return mode === "run" ? MOVEMENT_SPEEDS.run : MOVEMENT_SPEEDS.walk;
}
