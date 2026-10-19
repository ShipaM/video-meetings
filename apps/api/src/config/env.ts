/**
 * A numeric setting from the environment: `fallback` when unset or empty, otherwise a finite
 * number of at least `min` (default: anything above 0). A bad value fails at startup.
 */
export function numberEnv(name: string, fallback: number, min = Number.MIN_VALUE): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min) {
    const bound = min === Number.MIN_VALUE ? 'a positive number' : `a number of at least ${min}`;
    throw new Error(`${name} must be ${bound}, got "${raw}"`);
  }
  return value;
}
