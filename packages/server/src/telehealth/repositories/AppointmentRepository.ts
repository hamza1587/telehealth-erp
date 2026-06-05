// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { v4 as uuidv4 } from 'uuid';
import { DatabaseMode, getDatabasePool } from '../../database';

export interface Appointment {
  id: string;
  patientAccountId: string;
  doctorProfileId: string;
  scheduledStartsAt: Date;
  scheduledEndsAt: Date;
  consultationMode: 'video' | 'phone';
  status: 'pending_payment' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled_patient' | 'cancelled_doctor' | 'no_show_patient';
  pricePerMinute: number;
  createdAt: Date;
}

export async function findByUser(userId: string): Promise<Appointment[]> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<Appointment>(
    `SELECT * FROM th_appointments WHERE "patientAccountId" = $1 OR "doctorProfileId" = $1 ORDER BY "scheduledStartsAt" DESC`,
    [userId],
  );
  return rows;
}

export async function findById(id: string): Promise<Appointment | undefined> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<Appointment>(`SELECT * FROM th_appointments WHERE id = $1`, [id]);
  return rows[0];
}

export async function create(data: Omit<Appointment, 'id' | 'createdAt'>): Promise<Appointment> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const { rows } = await pool.query<Appointment>(
    `INSERT INTO th_appointments (id, "patientAccountId", "doctorProfileId", "scheduledStartsAt", "scheduledEndsAt",
       "consultationMode", status, "pricePerMinute", "createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *`,
    [uuidv4(), data.patientAccountId, data.doctorProfileId, data.scheduledStartsAt, data.scheduledEndsAt,
     data.consultationMode, data.status, data.pricePerMinute],
  );
  return rows[0];
}

export async function updateStatus(id: string, status: Appointment['status']): Promise<Appointment | undefined> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const { rows } = await pool.query<Appointment>(
    `UPDATE th_appointments SET status = $1 WHERE id = $2 RETURNING *`,
    [status, id],
  );
  return rows[0];
}

export async function reschedule(id: string, scheduledStartsAt: Date, scheduledEndsAt: Date): Promise<Appointment | undefined> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const { rows } = await pool.query<Appointment>(
    `UPDATE th_appointments SET "scheduledStartsAt" = $1, "scheduledEndsAt" = $2, status = 'confirmed' WHERE id = $3 RETURNING *`,
    [scheduledStartsAt, scheduledEndsAt, id],
  );
  return rows[0];
}

export async function count(): Promise<number> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM th_appointments`);
  return parseInt(rows[0].count, 10);
}

export async function countByStatus(status: string): Promise<number> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM th_appointments WHERE status = $1`,
    [status],
  );
  return parseInt(rows[0].count, 10);
}
