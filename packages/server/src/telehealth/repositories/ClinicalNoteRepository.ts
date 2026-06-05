// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { v4 as uuidv4 } from 'uuid';
import { DatabaseMode, getDatabasePool } from '../../database';

export interface ClinicalNote {
  id: string;
  consultationId: string;
  authorId: string;
  status: 'draft' | 'finalized';
  createdAt: Date;
  [key: string]: unknown;
}

interface NoteRow {
  id: string;
  consultationId: string;
  authorId: string;
  status: string;
  noteData: Record<string, unknown> | null;
  createdAt: Date;
}

function rowToNote(row: NoteRow): ClinicalNote {
  return {
    ...(row.noteData ?? {}),
    id: row.id,
    consultationId: row.consultationId,
    authorId: row.authorId,
    status: row.status as ClinicalNote['status'],
    createdAt: row.createdAt,
  };
}

export async function findByConsultationId(consultationId: string): Promise<ClinicalNote | undefined> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<NoteRow>(
    `SELECT * FROM th_clinical_notes WHERE "consultationId" = $1 LIMIT 1`,
    [consultationId],
  );
  return rows[0] ? rowToNote(rows[0]) : undefined;
}

export async function findById(id: string): Promise<ClinicalNote | undefined> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<NoteRow>(`SELECT * FROM th_clinical_notes WHERE id = $1`, [id]);
  return rows[0] ? rowToNote(rows[0]) : undefined;
}

export async function create(consultationId: string, authorId: string, data: Record<string, unknown>): Promise<ClinicalNote> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const { rows } = await pool.query<NoteRow>(
    `INSERT INTO th_clinical_notes (id, "consultationId", "authorId", status, "noteData", "createdAt")
     VALUES ($1,$2,$3,'draft',$4,NOW()) RETURNING *`,
    [uuidv4(), consultationId, authorId, JSON.stringify(data)],
  );
  return rowToNote(rows[0]);
}

export async function update(id: string, data: Record<string, unknown>): Promise<ClinicalNote | undefined> {
  const existing = await findById(id);
  if (!existing) return undefined;
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const { rows } = await pool.query<NoteRow>(
    `UPDATE th_clinical_notes SET "noteData" = $1 WHERE id = $2 RETURNING *`,
    [JSON.stringify({ ...(existing as Record<string, unknown>), ...data }), id],
  );
  return rows[0] ? rowToNote(rows[0]) : undefined;
}

export async function finalize(id: string): Promise<ClinicalNote | undefined> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const { rows } = await pool.query<NoteRow>(
    `UPDATE th_clinical_notes SET status = 'finalized' WHERE id = $1 RETURNING *`,
    [id],
  );
  return rows[0] ? rowToNote(rows[0]) : undefined;
}
