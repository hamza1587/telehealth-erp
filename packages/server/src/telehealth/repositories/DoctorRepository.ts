// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { v4 as uuidv4 } from 'uuid';
import { DatabaseMode, getDatabasePool } from '../../database';

export interface AvailabilityWindow {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface DoctorProfile {
  id: string;
  accountId: string;
  displayName: string;
  specialty: string;
  legalName?: string;
  phone?: string;
  consultationMode: 'video' | 'phone' | 'both';
  verificationStatus: 'draft' | 'pending' | 'verified' | 'rejected';
  availabilityWindows: AvailabilityWindow[];
  createdAt: Date;
  [key: string]: unknown;
}

interface DoctorRow {
  id: string;
  accountId: string;
  displayName: string;
  specialty: string;
  legalName: string | null;
  phone: string | null;
  consultationMode: string;
  verificationStatus: string;
  availabilityWindows: AvailabilityWindow[];
  profileData: Record<string, unknown> | null;
  createdAt: Date;
}

function rowToProfile(row: DoctorRow): DoctorProfile {
  return {
    ...(row.profileData ?? {}),
    id: row.id,
    accountId: row.accountId,
    displayName: row.displayName,
    specialty: row.specialty,
    legalName: row.legalName ?? undefined,
    phone: row.phone ?? undefined,
    consultationMode: row.consultationMode as DoctorProfile['consultationMode'],
    verificationStatus: row.verificationStatus as DoctorProfile['verificationStatus'],
    availabilityWindows: row.availabilityWindows ?? [],
    createdAt: row.createdAt,
  };
}

export async function findByAccountId(accountId: string): Promise<DoctorProfile | undefined> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<DoctorRow>(`SELECT * FROM th_doctor_profiles WHERE "accountId" = $1`, [accountId]);
  return rows[0] ? rowToProfile(rows[0]) : undefined;
}

export async function findById(id: string): Promise<DoctorProfile | undefined> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<DoctorRow>(`SELECT * FROM th_doctor_profiles WHERE id = $1`, [id]);
  return rows[0] ? rowToProfile(rows[0]) : undefined;
}

export async function findAllVerified(specialty?: string, q?: string): Promise<DoctorProfile[]> {
  const pool = getDatabasePool(DatabaseMode.READER);
  let query = `SELECT * FROM th_doctor_profiles WHERE "verificationStatus" = 'verified'`;
  const params: string[] = [];
  if (specialty) {
    params.push(`%${specialty.toLowerCase()}%`);
    query += ` AND LOWER(specialty) LIKE $${params.length}`;
  }
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    query += ` AND LOWER("displayName") LIKE $${params.length}`;
  }
  const { rows } = await pool.query<DoctorRow>(query, params);
  return rows.map(rowToProfile);
}

export async function create(accountId: string, data: Partial<DoctorProfile>): Promise<DoctorProfile> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const { id: _id, createdAt: _createdAt, accountId: _accountId, displayName, specialty, legalName, phone,
    consultationMode, verificationStatus, availabilityWindows, ...rest } = data;
  const { rows } = await pool.query<DoctorRow>(
    `INSERT INTO th_doctor_profiles (id, "accountId", "displayName", specialty, "legalName", phone,
       "consultationMode", "verificationStatus", "availabilityWindows", "profileData", "createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING *`,
    [uuidv4(), accountId, displayName ?? '', specialty ?? '', legalName ?? null, phone ?? null,
     consultationMode ?? 'video', verificationStatus ?? 'draft',
     JSON.stringify(availabilityWindows ?? []), Object.keys(rest).length ? JSON.stringify(rest) : null],
  );
  return rowToProfile(rows[0]);
}

export async function update(accountId: string, data: Partial<DoctorProfile>): Promise<DoctorProfile | undefined> {
  const existing = await findByAccountId(accountId);
  if (!existing) return undefined;

  const merged = { ...existing, ...data };
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const { id: _id, createdAt: _createdAt, accountId: _acct, displayName, specialty, legalName, phone,
    consultationMode, verificationStatus, availabilityWindows, ...rest } = merged;

  const { rows } = await pool.query<DoctorRow>(
    `UPDATE th_doctor_profiles SET "displayName" = $1, specialty = $2, "legalName" = $3, phone = $4,
       "consultationMode" = $5, "verificationStatus" = $6, "availabilityWindows" = $7, "profileData" = $8
     WHERE "accountId" = $9 RETURNING *`,
    [displayName, specialty, legalName ?? null, phone ?? null,
     consultationMode, verificationStatus,
     JSON.stringify(availabilityWindows ?? []),
     Object.keys(rest).length ? JSON.stringify(rest) : null,
     accountId],
  );
  return rows[0] ? rowToProfile(rows[0]) : undefined;
}

export async function updateAvailability(accountId: string, windows: AvailabilityWindow[]): Promise<DoctorProfile | undefined> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const { rows } = await pool.query<DoctorRow>(
    `UPDATE th_doctor_profiles SET "availabilityWindows" = $1 WHERE "accountId" = $2 RETURNING *`,
    [JSON.stringify(windows), accountId],
  );
  return rows[0] ? rowToProfile(rows[0]) : undefined;
}

export async function count(): Promise<number> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM th_doctor_profiles`);
  return parseInt(rows[0].count, 10);
}

export async function findAll(): Promise<DoctorProfile[]> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<DoctorRow>(`SELECT * FROM th_doctor_profiles ORDER BY "createdAt" DESC`);
  return rows.map(rowToProfile);
}
