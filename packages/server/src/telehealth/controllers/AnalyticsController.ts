// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Router, Request, Response } from 'express';
import * as Aggregation from '../services/AnalyticsAggregationService';
import * as Privacy from '../services/AnalyticsPrivacyService';
import * as Alerts from '../services/AlertService';
import { forecastDemand } from '../services/PredictiveDemandService';

const router = Router();

// ── Summary ───────────────────────────────────────────────────────────────────

router.get('/summary', async (_req: Request, res: Response): Promise<void> => {
  try {
    const summary = await Aggregation.getSummary();
    res.json(summary);
  } catch (error) {
    console.error('[analytics] summary error:', error instanceof Error ? error.message : String(error));
    res.json({ totalPatients: 0, totalDoctors: 0, totalAppointments: 0, completedAppointments: 0, activeConsultations: 0, totalRevenueCents: 0 });
  }
});

// ── Time-series ───────────────────────────────────────────────────────────────

router.get('/daily', async (req: Request, res: Response): Promise<void> => {
  try {
    const days = Math.min(parseInt(String(req.query.days ?? '30'), 10), 365);
    const [consultations, patients] = await Promise.all([
      Aggregation.getDailyConsultations(days),
      Aggregation.getDailyNewPatients(days),
    ]);
    res.json({
      consultations: Privacy.noiseDailyCounts(consultations),
      patients: Privacy.noiseDailyCounts(patients),
    });
  } catch (error) {
    console.error('[analytics] daily error:', error instanceof Error ? error.message : String(error));
    res.json({ consultations: [], patients: [] });
  }
});

router.get('/revenue', async (req: Request, res: Response): Promise<void> => {
  try {
    const days = Math.min(parseInt(String(req.query.days ?? '30'), 10), 365);
    const raw = await Aggregation.getDailyRevenue(days);
    // Max revenue sensitivity: assume max single transaction is €500 = 50000 cents
    const noised = raw.map(p => ({
      ...p,
      totalCents: Privacy.noiseSum(p.totalCents, 50_000),
    }));
    res.json(noised);
  } catch (error) {
    console.error('[analytics] revenue error:', error instanceof Error ? error.message : String(error));
    res.json([]);
  }
});

// ── Breakdowns ────────────────────────────────────────────────────────────────

router.get('/status-breakdown', async (_req: Request, res: Response): Promise<void> => {
  try {
    const breakdown = await Aggregation.getAppointmentStatusBreakdown();
    res.json(Privacy.noiseBreakdown(breakdown));
  } catch (error) {
    console.error('[analytics] status breakdown error:', error instanceof Error ? error.message : String(error));
    res.json([]);
  }
});

router.get('/specialty-breakdown', async (_req: Request, res: Response): Promise<void> => {
  try {
    const breakdown = await Aggregation.getDoctorSpecialtyBreakdown();
    res.json(Privacy.noiseBreakdown(breakdown));
  } catch (error) {
    console.error('[analytics] specialty breakdown error:', error instanceof Error ? error.message : String(error));
    res.json([]);
  }
});

router.get('/consultation-duration', async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json(await Aggregation.getConsultationDurationStats());
  } catch (error) {
    console.error('[analytics] duration error:', error instanceof Error ? error.message : String(error));
    res.json({ avgMinutes: 0, p95Minutes: 0 });
  }
});

// ── Demand forecast ───────────────────────────────────────────────────────────

router.get('/demand-forecast', async (req: Request, res: Response): Promise<void> => {
  try {
    const days = Math.min(parseInt(String(req.query.days ?? '30'), 10), 365);
    const horizon = Math.min(parseInt(String(req.query.horizon ?? '7'), 10), 30);
    const history = await Aggregation.getDailyConsultations(days);
    const forecast = forecastDemand(history, horizon);
    res.json(forecast);
  } catch (error) {
    console.error('[analytics] demand forecast error:', error instanceof Error ? error.message : String(error));
    res.json([]);
  }
});

// ── Alerts ────────────────────────────────────────────────────────────────────

router.get('/alerts/rules', (_req: Request, res: Response): void => {
  res.json(Alerts.listRules());
});

router.post('/alerts/rules', (req: Request, res: Response): void => {
  const { name, metric, threshold, comparator, enabled = true, description } = req.body as {
    name: string; metric: string; threshold: number; comparator: Alerts.Comparator;
    enabled?: boolean; description?: string;
  };
  if (!name || !metric || threshold === undefined || !comparator) {
    res.status(400).json({ error: 'name, metric, threshold, comparator are required' });
    return;
  }
  res.status(201).json(Alerts.createRule({ name, metric, threshold, comparator, enabled, description }));
});

router.put('/alerts/rules/:id', (req: Request, res: Response): void => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const updated = Alerts.updateRule(id, req.body as Partial<Alerts.AlertRule>);
  if (!updated) { res.status(404).json({ error: 'Rule not found' }); return; }
  res.json(updated);
});

router.delete('/alerts/rules/:id', (req: Request, res: Response): void => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  res.json({ success: Alerts.deleteRule(id) });
});

router.get('/alerts/active', async (_req: Request, res: Response): Promise<void> => {
  try {
    const summary = await Aggregation.getSummary();
    const dailyConsultations = await Aggregation.getDailyConsultations(1);
    const dailyRevenue = await Aggregation.getDailyRevenue(1);
    const metrics: Record<string, number> = {
      activeConsultations: summary.activeConsultations,
      totalPatients: summary.totalPatients,
      dailyNewPatients: dailyConsultations[0]?.count ?? 0,
      dailyRevenueCents: dailyRevenue[0]?.totalCents ?? 0,
    };
    res.json(Alerts.checkAlerts(metrics));
  } catch (error) {
    console.error('[analytics] active alerts error:', error instanceof Error ? error.message : String(error));
    res.json([]);
  }
});

// ── Patients analytics (for admin) ────────────────────────────────────────────

router.get('/patients', async (_req: Request, res: Response): Promise<void> => {
  try {
    const pool = (await import('../../database')).getDatabasePool((await import('../../database')).DatabaseMode.READER);
    const { rows } = await pool.query('SELECT * FROM th_patient_profiles ORDER BY "createdAt" DESC');
    res.json(rows);
  } catch (error) {
    console.error('[analytics] patients error:', error instanceof Error ? error.message : String(error));
    res.json([]);
  }
});

router.get('/consultations', async (_req: Request, res: Response): Promise<void> => {
  try {
    const pool = (await import('../../database')).getDatabasePool((await import('../../database')).DatabaseMode.READER);
    const { rows } = await pool.query('SELECT * FROM th_consultations ORDER BY "createdAt" DESC');
    res.json(rows);
  } catch (error) {
    console.error('[analytics] consultations error:', error instanceof Error ? error.message : String(error));
    res.json([]);
  }
});

export { router as analyticsRouter };
