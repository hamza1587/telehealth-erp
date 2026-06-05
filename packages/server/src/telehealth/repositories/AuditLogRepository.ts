// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { v4 as uuidv4 } from 'uuid';
import { DatabaseMode, getDatabasePool } from '../../database';

export interface AuditEntry {
  id: string;
  actorId: string;
  action: string;
  target: string;
  targetId: string;
  metadata: Record<string, unknown>;
  timestamp: Date;
}

export async function append(
  actorId: string,
  action: string,
  target: string,
  targetId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  await pool.query(
    `INSERT INTO th_audit_log (id, "actorId", action, target, "targetId", metadata, timestamp)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
    [uuidv4(), actorId, action, target, targetId, JSON.stringify(metadata)],
  );
}

export async function findAll(opts?: { limit?: number; offset?: number }): Promise<AuditEntry[]> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const limit = opts?.limit ?? 500;
  const offset = opts?.offset ?? 0;
  const { rows } = await pool.query<AuditEntry>(
    `SELECT * FROM th_audit_log ORDER BY timestamp DESC LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows;
}

export async function findByActor(actorId: string): Promise<AuditEntry[]> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<AuditEntry>(
    `SELECT * FROM th_audit_log WHERE "actorId" = $1 ORDER BY timestamp DESC`,
    [actorId],
  );
  return rows;
}
