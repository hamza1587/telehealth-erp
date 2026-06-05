// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { v4 as uuidv4 } from 'uuid';
import { DatabaseMode, getDatabasePool } from '../../database';

export interface Notification {
  id: string;
  userId: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: Date;
}

export async function findByUser(userId: string): Promise<Notification[]> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<Notification>(
    `SELECT * FROM th_notifications WHERE "userId" = $1 ORDER BY "createdAt" DESC`,
    [userId],
  );
  return rows;
}

export async function findById(id: string): Promise<Notification | undefined> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<Notification>(`SELECT * FROM th_notifications WHERE id = $1`, [id]);
  return rows[0];
}

export async function create(userId: string, title: string, body: string): Promise<Notification> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const { rows } = await pool.query<Notification>(
    `INSERT INTO th_notifications (id, "userId", title, body, "read", "createdAt") VALUES ($1,$2,$3,$4,FALSE,NOW()) RETURNING *`,
    [uuidv4(), userId, title, body],
  );
  return rows[0];
}

export async function markRead(id: string): Promise<void> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  await pool.query(`UPDATE th_notifications SET "read" = TRUE WHERE id = $1`, [id]);
}

export async function markAllRead(userId: string): Promise<void> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  await pool.query(`UPDATE th_notifications SET "read" = TRUE WHERE "userId" = $1`, [userId]);
}
