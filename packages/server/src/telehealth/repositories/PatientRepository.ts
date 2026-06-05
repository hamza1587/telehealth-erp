// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { v4 as uuidv4 } from 'uuid';
import { DatabaseMode, getDatabasePool } from '../../database';

export interface PatientProfile {
  id: string;
  accountId: string;
  displayName: string;
  hasMedicalProfile: boolean;
  createdAt: Date;
  [key: string]: unknown;
}

interface PatientRow {
  id: string;
  accountId: string;
  displayName: string;
  hasMedicalProfile: boolean;
  profileData: Record<string, unknown> | null;
  createdAt: Date;
}

function rowToProfile(row: PatientRow): PatientProfile {
  return {
    ...(row.profileData ?? {}),
    id: row.id,
    accountId: row.accountId,
    displayName: row.displayName,
    hasMedicalProfile: row.hasMedicalProfile,
    createdAt: row.createdAt,
  };
}

export async function findByAccountId(accountId: string): Promise<PatientProfile | undefined> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<PatientRow>(`SELECT * FROM th_patient_profiles WHERE "accountId" = $1`, [accountId]);
  return rows[0] ? rowToProfile(rows[0]) : undefined;
}

export async function create(accountId: string, displayName: string): Promise<PatientProfile> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const { rows } = await pool.query<PatientRow>(
    `INSERT INTO th_patient_profiles (id, "accountId", "displayName", "hasMedicalProfile", "createdAt")
     VALUES ($1,$2,$3,FALSE,NOW()) RETURNING *`,
    [uuidv4(), accountId, displayName],
  );
  return rowToProfile(rows[0]);
}

export async function updateOnboarding(accountId: string, data: Record<string, unknown>): Promise<PatientProfile | undefined> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const { rows } = await pool.query<PatientRow>(
    `UPDATE th_patient_profiles SET "hasMedicalProfile" = TRUE, "profileData" = $1 WHERE "accountId" = $2 RETURNING *`,
    [JSON.stringify(data), accountId],
  );
  return rows[0] ? rowToProfile(rows[0]) : undefined;
}

export async function update(accountId: string, data: Record<string, unknown>): Promise<PatientProfile | undefined> {
  const existing = await findByAccountId(accountId);
  if (!existing) return undefined;
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const { displayName, hasMedicalProfile, ...rest } = data;
  const { rows } = await pool.query<PatientRow>(
    `UPDATE th_patient_profiles
     SET "displayName" = COALESCE($1, "displayName"),
         "hasMedicalProfile" = COALESCE($2, "hasMedicalProfile"),
         "profileData" = $3
     WHERE "accountId" = $4 RETURNING *`,
    [typeof displayName === 'string' ? displayName : null,
     typeof hasMedicalProfile === 'boolean' ? hasMedicalProfile : null,
     JSON.stringify({ ...(existing as Record<string, unknown>), ...rest }),
     accountId],
  );
  return rows[0] ? rowToProfile(rows[0]) : undefined;
}

export async function count(): Promise<number> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM th_patient_profiles`);
  return parseInt(rows[0].count, 10);
}

export async function findAll(): Promise<PatientProfile[]> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<PatientRow>(`SELECT * FROM th_patient_profiles ORDER BY "createdAt" DESC`);
  return rows.map(rowToProfile);
}
