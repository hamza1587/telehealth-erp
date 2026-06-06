// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
// Differential privacy via the Laplace mechanism (epsilon-DP).
// All aggregated values are noised before returning to clients.

const GLOBAL_EPSILON = 1.0; // Privacy budget (max epsilon per query)
const MIN_COUNT_THRESHOLD = 5; // Suppress results with fewer than 5 individuals (k-anonymity floor)

/**
 * Draw a sample from the Laplace(0, scale) distribution.
 * Uses the inverse CDF method: if U ~ Uniform(0,1), then
 * L = -scale * sgn(U - 0.5) * ln(1 - 2|U - 0.5|)
 */
function laplaceSample(scale: number): number {
  const u = Math.random() - 0.5;
  return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}

/**
 * Add Laplace noise to a count query result.
 * Sensitivity of a count = 1 (adding/removing one row changes count by ≤1).
 * @param value - The raw aggregate count
 * @param epsilon - Privacy budget; capped at GLOBAL_EPSILON
 */
export function noiseCount(value: number, epsilon = GLOBAL_EPSILON): number {
  const eps = Math.min(Math.abs(epsilon), GLOBAL_EPSILON);
  const scale = 1.0 / eps; // sensitivity / epsilon
  const noised = Math.round(value + laplaceSample(scale));
  // Suppress small groups entirely (k-anonymity)
  if (value < MIN_COUNT_THRESHOLD) return 0;
  return Math.max(0, noised);
}

/**
 * Add Laplace noise to a sum query result.
 * Caller must supply the L1 sensitivity (max contribution per individual).
 * @param value - The raw aggregate sum (in whatever unit, e.g. cents)
 * @param sensitivity - Max change in sum when one record is added/removed
 * @param epsilon - Privacy budget
 */
export function noiseSum(value: number, sensitivity: number, epsilon = GLOBAL_EPSILON): number {
  const eps = Math.min(Math.abs(epsilon), GLOBAL_EPSILON);
  const scale = sensitivity / eps;
  return Math.max(0, Math.round(value + laplaceSample(scale)));
}

/**
 * Apply differential privacy to a list of DailyDataPoints.
 * Each count is independently noised.
 */
export function noiseDailyCounts<T extends { count: number }>(points: T[], epsilon = GLOBAL_EPSILON): T[] {
  return points.map(p => ({ ...p, count: noiseCount(p.count, epsilon) }));
}

/**
 * Apply differential privacy to a list of status/specialty breakdowns.
 * Suppress groups below the k-anonymity threshold.
 */
export function noiseBreakdown<T extends { count: number }>(items: T[], epsilon = GLOBAL_EPSILON): T[] {
  return items
    .map(item => ({ ...item, count: noiseCount(item.count, epsilon) }))
    .filter(item => item.count > 0);
}

/**
 * Clamp a value to a plausible range to limit sensitivity and prevent
 * negative outputs that would reveal the true value.
 */
export function clampToNonNegative(value: number): number {
  return Math.max(0, value);
}

export const EPSILON = GLOBAL_EPSILON;
