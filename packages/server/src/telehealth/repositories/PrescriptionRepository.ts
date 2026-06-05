// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { v4 as uuidv4 } from 'uuid';
import { DatabaseMode, getDatabasePool } from '../../database';

export interface Prescription {
  id: string;
  consultationId: string;
  authorId: string;
  medications: unknown[];
  status: 'draft' | 'issued';
  createdAt: Date;
  [key: string]: unknown;
}

interface RxRow {
  id: string;
  consultationId: string;
  authorId: string;
  medications: unknown[];
  status: string;
  rxData: Record<string, unknown> | null;
  createdAt: Date;
}

function rowToRx(row: RxRow): Prescription {
  return {
    ...(row.rxData ?? {}),
    id: row.id,
    consultationId: row.consultationId,
    authorId: row.authorId,
    medications: row.medications ?? [],
    status: row.status as Prescription['status'],
    createdAt: row.createdAt,
  };
}

export async function findByConsultationId(consultationId: string): Promise<Prescription | undefined> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<RxRow>(
    `SELECT * FROM th_prescriptions WHERE "consultationId" = $1 LIMIT 1`,
    [consultationId],
  );
  return rows[0] ? rowToRx(rows[0]) : undefined;
}

export async function findById(id: string): Promise<Prescription | undefined> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<RxRow>(`SELECT * FROM th_prescriptions WHERE id = $1`, [id]);
  return rows[0] ? rowToRx(rows[0]) : undefined;
}

export async function create(consultationId: string, authorId: string, data: Record<string, unknown>): Promise<Prescription> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const medications = Array.isArray(data.medications) ? data.medications : [];
  const { medications: _med, ...rest } = data;
  const { rows } = await pool.query<RxRow>(
    `INSERT INTO th_prescriptions (id, "consultationId", "authorId", medications, status, "rxData", "createdAt")
     VALUES ($1,$2,$3,$4,'draft',$5,NOW()) RETURNING *`,
    [uuidv4(), consultationId, authorId, JSON.stringify(medications), Object.keys(rest).length ? JSON.stringify(rest) : null],
  );
  return rowToRx(rows[0]);
}

export async function update(id: string, data: Record<string, unknown>): Promise<Prescription | undefined> {
  const existing = await findById(id);
  if (!existing) return undefined;
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const medications = Array.isArray(data.medications) ? data.medications : existing.medications;
  const { medications: _med, ...rest } = data;
  const { rows } = await pool.query<RxRow>(
    `UPDATE th_prescriptions SET medications = $1, "rxData" = $2 WHERE id = $3 RETURNING *`,
    [JSON.stringify(medications), JSON.stringify({ ...(existing as Record<string, unknown>), ...rest }), id],
  );
  return rows[0] ? rowToRx(rows[0]) : undefined;
}

export async function issue(id: string): Promise<Prescription | undefined> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const { rows } = await pool.query<RxRow>(
    `UPDATE th_prescriptions SET status = 'issued' WHERE id = $1 RETURNING *`,
    [id],
  );
  return rows[0] ? rowToRx(rows[0]) : undefined;
}
