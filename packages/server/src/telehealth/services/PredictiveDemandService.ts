// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
// Demand forecasting using Holt's double exponential smoothing (trend-adjusted EWA).

export interface ForecastPoint {
  day: string; // ISO date YYYY-MM-DD
  predicted: number;
  lower: number; // 80% prediction interval lower bound
  upper: number; // 80% prediction interval upper bound
}

interface HoltState {
  level: number;
  trend: number;
}

const ALPHA = 0.3; // Level smoothing
const BETA = 0.1; // Trend smoothing
const INTERVAL_MULTIPLIER = 1.28; // 80% prediction interval z-score

/**
 * Fit Holt's model to a series of observations and return final state.
 */
function holtFit(observations: number[]): HoltState {
  if (observations.length === 0) return { level: 0, trend: 0 };
  if (observations.length === 1) return { level: observations[0], trend: 0 };

  let level = observations[0];
  let trend = observations[1] - observations[0];

  for (let i = 1; i < observations.length; i++) {
    const prevLevel = level;
    level = ALPHA * observations[i] + (1 - ALPHA) * (level + trend);
    trend = BETA * (level - prevLevel) + (1 - BETA) * trend;
  }
  return { level, trend };
}

/**
 * Compute RMSE of one-step-ahead forecasts on the training data.
 */
function holtRmse(observations: number[]): number {
  if (observations.length < 3) return observations[0] ?? 1;
  let level = observations[0];
  let trend = observations[1] - observations[0];
  let sse = 0;

  for (let i = 1; i < observations.length; i++) {
    const forecast = level + trend;
    sse += (observations[i] - forecast) ** 2;
    const prevLevel = level;
    level = ALPHA * observations[i] + (1 - ALPHA) * (level + trend);
    trend = BETA * (level - prevLevel) + (1 - BETA) * trend;
  }
  return Math.sqrt(sse / (observations.length - 1));
}

function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

/**
 * Forecast the next `horizonDays` days of demand given historical daily counts.
 * @param history - Array of `{ day: string; count: number }` sorted ascending
 * @param horizonDays - Number of days to forecast (default 7)
 */
export function forecastDemand(
  history: { day: string; count: number }[],
  horizonDays = 7,
): ForecastPoint[] {
  if (history.length === 0) {
    const today = new Date().toISOString().split('T')[0];
    return Array.from({ length: horizonDays }, (_, i) => ({
      day: addDays(today, i + 1),
      predicted: 0,
      lower: 0,
      upper: 0,
    }));
  }

  const observations = history.map(h => h.count);
  const { level, trend } = holtFit(observations);
  const rmse = holtRmse(observations);
  const lastDay = history[history.length - 1].day;

  return Array.from({ length: horizonDays }, (_, h) => {
    const stepsAhead = h + 1;
    const predicted = Math.max(0, Math.round(level + trend * stepsAhead));
    const interval = INTERVAL_MULTIPLIER * rmse * Math.sqrt(stepsAhead);
    return {
      day: addDays(lastDay, stepsAhead),
      predicted,
      lower: Math.max(0, Math.round(predicted - interval)),
      upper: Math.round(predicted + interval),
    };
  });
}
