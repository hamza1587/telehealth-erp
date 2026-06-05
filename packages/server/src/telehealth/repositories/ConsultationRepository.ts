// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { v4 as uuidv4 } from 'uuid';
import { DatabaseMode, getDatabasePool } from '../../database';

export interface Consultation {
  id: string;
  appointmentId: string;
  status: 'created' | 'active' | 'ended';
  startedAt?: Date;
  endedAt?: Date;
  createdAt: Date;
}

export async function findById(id: string): Promise<Consultation | undefined> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<Consultation>(`SELECT * FROM th_consultations WHERE id = $1`, [id]);
  return rows[0];
}

export async function create(appointmentId: string): Promise<Consultation> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const { rows } = await pool.query<Consultation>(
    `INSERT INTO th_consultations (id, "appointmentId", status, "createdAt")
     VALUES ($1,$2,'created',NOW()) RETURNING *`,
    [uuidv4(), appointmentId],
  );
  return rows[0];
}

export async function join(id: string): Promise<Consultation | undefined> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const { rows } = await pool.query<Consultation>(
    `UPDATE th_consultations SET status = 'active', "startedAt" = NOW()
     WHERE id = $1 AND status <> 'ended' RETURNING *`,
    [id],
  );
  return rows[0];
}

export async function end(id: string): Promise<Consultation | undefined> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const { rows } = await pool.query<Consultation>(
    `UPDATE th_consultations SET status = 'ended', "endedAt" = NOW() WHERE id = $1 RETURNING *`,
    [id],
  );
  return rows[0];
}

export async function findAll(): Promise<Consultation[]> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<Consultation>(`SELECT * FROM th_consultations ORDER BY "createdAt" DESC`);
  return rows;
}
