// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { v4 as uuidv4 } from 'uuid';
import { DatabaseMode, getDatabasePool } from '../../database';

export interface Call {
  id: string;
  roomId: string;
  patientId: string;
  doctorId: string;
  status: 'waiting' | 'active' | 'completed';
  startTime?: Date;
  endTime?: Date;
  isRecording: boolean;
  recordingConsent: boolean;
  createdAt: Date;
}

export interface ChatMessage {
  id: string;
  callId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: Date;
}

export interface Recording {
  id: string;
  callId: string;
  url: string;
  duration: number;
  consentGiven: boolean;
  createdAt: Date;
}

export async function findById(id: string): Promise<Call | undefined> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<Call>(`SELECT * FROM th_calls WHERE id = $1`, [id]);
  return rows[0];
}

export async function create(patientId: string, doctorId: string, recordingConsent: boolean): Promise<Call> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const roomId = `room-${uuidv4()}`;
  const { rows } = await pool.query<Call>(
    `INSERT INTO th_calls (id, "roomId", "patientId", "doctorId", status, "isRecording", "recordingConsent", "createdAt")
     VALUES ($1,$2,$3,$4,'waiting',FALSE,$5,NOW()) RETURNING *`,
    [uuidv4(), roomId, patientId, doctorId, recordingConsent],
  );
  return rows[0];
}

export async function join(id: string): Promise<Call | undefined> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const { rows } = await pool.query<Call>(
    `UPDATE th_calls SET status = 'active', "startTime" = NOW()
     WHERE id = $1 AND status = 'waiting' RETURNING *`,
    [id],
  );
  if (rows[0]) return rows[0];
  // If already active, just return it
  return findById(id);
}

export async function end(id: string): Promise<Call | undefined> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const { rows } = await pool.query<Call>(
    `UPDATE th_calls SET status = 'completed', "endTime" = NOW(), "isRecording" = FALSE WHERE id = $1 RETURNING *`,
    [id],
  );
  return rows[0];
}

export async function setRecording(id: string, recording: boolean): Promise<void> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  await pool.query(`UPDATE th_calls SET "isRecording" = $1 WHERE id = $2`, [recording, id]);
}

// Chat messages
export async function getChatMessages(callId: string): Promise<ChatMessage[]> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<ChatMessage>(
    `SELECT * FROM th_chat_messages WHERE "callId" = $1 ORDER BY timestamp`,
    [callId],
  );
  return rows;
}

export async function addChatMessage(callId: string, senderId: string, senderName: string, content: string): Promise<ChatMessage> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const { rows } = await pool.query<ChatMessage>(
    `INSERT INTO th_chat_messages (id, "callId", "senderId", "senderName", content, timestamp)
     VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *`,
    [uuidv4(), callId, senderId, senderName, content],
  );
  return rows[0];
}

// Recordings
export async function getRecordings(callId: string): Promise<Recording[]> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<Recording>(`SELECT * FROM th_recordings WHERE "callId" = $1`, [callId]);
  return rows;
}

export async function addRecording(callId: string, url: string, duration: number, consentGiven: boolean): Promise<Recording> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const { rows } = await pool.query<Recording>(
    `INSERT INTO th_recordings (id, "callId", url, duration, "consentGiven", "createdAt")
     VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *`,
    [uuidv4(), callId, url, duration, consentGiven],
  );
  return rows[0];
}
