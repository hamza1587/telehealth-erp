// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { v4 as uuidv4 } from 'uuid';
import { DatabaseMode, getDatabasePool } from '../../database';

export interface TicketMessage {
  id: string;
  senderId: string;
  content: string;
  timestamp: Date;
}

export interface Ticket {
  id: string;
  userId: string;
  subject: string;
  category: string;
  priority: 'low' | 'medium' | 'high';
  message: string;
  status: 'open' | 'in_progress' | 'resolved';
  messages: TicketMessage[];
  createdAt: Date;
}

interface TicketRow {
  id: string;
  userId: string;
  subject: string;
  category: string;
  priority: string;
  message: string;
  status: string;
  createdAt: Date;
}

async function loadMessages(ticketId: string): Promise<TicketMessage[]> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<TicketMessage>(
    `SELECT id, "senderId", content, timestamp FROM th_ticket_messages WHERE "ticketId" = $1 ORDER BY timestamp`,
    [ticketId],
  );
  return rows;
}

async function rowToTicket(row: TicketRow): Promise<Ticket> {
  return {
    id: row.id,
    userId: row.userId,
    subject: row.subject,
    category: row.category,
    priority: row.priority as Ticket['priority'],
    message: row.message,
    status: row.status as Ticket['status'],
    messages: await loadMessages(row.id),
    createdAt: row.createdAt,
  };
}

export async function findByUser(userId: string): Promise<Ticket[]> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<TicketRow>(
    `SELECT * FROM th_tickets WHERE "userId" = $1 ORDER BY "createdAt" DESC`,
    [userId],
  );
  return Promise.all(rows.map(rowToTicket));
}

export async function findById(id: string): Promise<Ticket | undefined> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<TicketRow>(`SELECT * FROM th_tickets WHERE id = $1`, [id]);
  if (!rows[0]) return undefined;
  return rowToTicket(rows[0]);
}

export async function create(userId: string, data: { subject: string; category: string; priority?: string; message: string }): Promise<Ticket> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const ticketId = uuidv4();
  await pool.query(
    `INSERT INTO th_tickets (id, "userId", subject, category, priority, message, status, "createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,'open',NOW())`,
    [ticketId, userId, data.subject, data.category, data.priority ?? 'medium', data.message],
  );
  await pool.query(
    `INSERT INTO th_ticket_messages (id, "ticketId", "senderId", content, timestamp) VALUES ($1,$2,$3,$4,NOW())`,
    [uuidv4(), ticketId, userId, data.message],
  );
  return (await findById(ticketId))!;
}

export async function addMessage(ticketId: string, senderId: string, content: string): Promise<Ticket | undefined> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  await pool.query(
    `INSERT INTO th_ticket_messages (id, "ticketId", "senderId", content, timestamp) VALUES ($1,$2,$3,$4,NOW())`,
    [uuidv4(), ticketId, senderId, content],
  );
  return findById(ticketId);
}

export async function close(id: string): Promise<void> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  await pool.query(`UPDATE th_tickets SET status = 'resolved' WHERE id = $1`, [id]);
}
