// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { DatabaseMode, getDatabasePool } from '../../database';

export interface DailyDataPoint {
  day: string; // ISO date string YYYY-MM-DD
  count: number;
}

export interface DailyRevenuePoint {
  day: string;
  totalCents: number;
}

export interface StatusBreakdown {
  status: string;
  count: number;
}

export interface SpecialtyBreakdown {
  specialty: string;
  count: number;
}

export interface AnalyticsSummary {
  totalPatients: number;
  totalDoctors: number;
  totalAppointments: number;
  completedAppointments: number;
  activeConsultations: number;
  totalRevenueCents: number;
}

export async function getSummary(): Promise<AnalyticsSummary> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const [patients, doctors, appointments, completed, active, revenue] = await Promise.all([
    pool.query<{ count: string }>('SELECT COUNT(*) AS count FROM th_patient_profiles'),
    pool.query<{ count: string }>('SELECT COUNT(*) AS count FROM th_doctor_profiles'),
    pool.query<{ count: string }>('SELECT COUNT(*) AS count FROM th_appointments'),
    pool.query<{ count: string }>("SELECT COUNT(*) AS count FROM th_appointments WHERE status = 'completed'"),
    pool.query<{ count: string }>("SELECT COUNT(*) AS count FROM th_consultations WHERE status = 'active'"),
    pool.query<{ total: string }>('SELECT COALESCE(SUM("amountCents"),0) AS total FROM th_ledger WHERE type = \'debit\''),
  ]);
  return {
    totalPatients: parseInt(patients.rows[0].count, 10),
    totalDoctors: parseInt(doctors.rows[0].count, 10),
    totalAppointments: parseInt(appointments.rows[0].count, 10),
    completedAppointments: parseInt(completed.rows[0].count, 10),
    activeConsultations: parseInt(active.rows[0].count, 10),
    totalRevenueCents: parseInt(revenue.rows[0].total, 10),
  };
}

export async function getDailyConsultations(days = 30): Promise<DailyDataPoint[]> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<{ day: Date; count: string }>(
    `SELECT DATE_TRUNC('day', "createdAt") AS day, COUNT(*) AS count
     FROM th_consultations
     WHERE "createdAt" >= NOW() - INTERVAL '${days} days'
     GROUP BY day ORDER BY day`,
  );
  return rows.map(r => ({ day: r.day.toISOString().split('T')[0], count: parseInt(r.count, 10) }));
}

export async function getDailyNewPatients(days = 30): Promise<DailyDataPoint[]> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<{ day: Date; count: string }>(
    `SELECT DATE_TRUNC('day', "createdAt") AS day, COUNT(*) AS count
     FROM th_patient_profiles
     WHERE "createdAt" >= NOW() - INTERVAL '${days} days'
     GROUP BY day ORDER BY day`,
  );
  return rows.map(r => ({ day: r.day.toISOString().split('T')[0], count: parseInt(r.count, 10) }));
}

export async function getDailyRevenue(days = 30): Promise<DailyRevenuePoint[]> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<{ day: Date; total: string }>(
    `SELECT DATE_TRUNC('day', "createdAt") AS day, COALESCE(SUM("amountCents"),0) AS total
     FROM th_ledger
     WHERE type = 'debit' AND "createdAt" >= NOW() - INTERVAL '${days} days'
     GROUP BY day ORDER BY day`,
  );
  return rows.map(r => ({ day: r.day.toISOString().split('T')[0], totalCents: parseInt(r.total, 10) }));
}

export async function getAppointmentStatusBreakdown(): Promise<StatusBreakdown[]> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<{ status: string; count: string }>(
    `SELECT status, COUNT(*) AS count FROM th_appointments GROUP BY status ORDER BY count DESC`,
  );
  return rows.map(r => ({ status: r.status, count: parseInt(r.count, 10) }));
}

export async function getDoctorSpecialtyBreakdown(): Promise<SpecialtyBreakdown[]> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<{ specialty: string; count: string }>(
    `SELECT COALESCE(specialty, 'Unknown') AS specialty, COUNT(*) AS count
     FROM th_doctor_profiles GROUP BY specialty ORDER BY count DESC LIMIT 10`,
  );
  return rows.map(r => ({ specialty: r.specialty, count: parseInt(r.count, 10) }));
}

export async function getConsultationDurationStats(): Promise<{ avgMinutes: number; p95Minutes: number }> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<{ avg: string; p95: string }>(
    `SELECT
       ROUND(AVG(EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) / 60)) AS avg,
       ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) / 60)) AS p95
     FROM th_consultations
     WHERE status = 'ended' AND "startedAt" IS NOT NULL AND "endedAt" IS NOT NULL`,
  );
  return {
    avgMinutes: parseFloat(rows[0]?.avg ?? '0'),
    p95Minutes: parseFloat(rows[0]?.p95 ?? '0'),
  };
}
