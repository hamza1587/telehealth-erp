// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { PoolClient } from 'pg';
import * as fns from '../migrate-functions';

export async function run(client: PoolClient): Promise<void> {
  const results: { name: string; durationMs: number }[] = [];

  // ── Appointments ────────────────────────────────────────────────────────────
  await fns.query(client, results, `
    CREATE TABLE IF NOT EXISTS "th_appointments" (
      "id"               UUID        PRIMARY KEY,
      "patientAccountId" TEXT        NOT NULL,
      "doctorProfileId"  TEXT        NOT NULL,
      "scheduledStartsAt" TIMESTAMPTZ NOT NULL,
      "scheduledEndsAt"  TIMESTAMPTZ NOT NULL,
      "consultationMode" TEXT        NOT NULL DEFAULT 'video',
      "status"           TEXT        NOT NULL DEFAULT 'pending_payment',
      "pricePerMinute"   NUMERIC(10,4) NOT NULL DEFAULT 1.5,
      "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await fns.query(client, results, `CREATE INDEX IF NOT EXISTS "th_appointments_patient_idx" ON "th_appointments" ("patientAccountId")`);
  await fns.query(client, results, `CREATE INDEX IF NOT EXISTS "th_appointments_doctor_idx"  ON "th_appointments" ("doctorProfileId")`);

  // ── Doctor profiles ─────────────────────────────────────────────────────────
  await fns.query(client, results, `
    CREATE TABLE IF NOT EXISTS "th_doctor_profiles" (
      "id"                  UUID    PRIMARY KEY,
      "accountId"           TEXT    NOT NULL UNIQUE,
      "displayName"         TEXT    NOT NULL DEFAULT '',
      "specialty"           TEXT    NOT NULL DEFAULT '',
      "legalName"           TEXT,
      "phone"               TEXT,
      "consultationMode"    TEXT    NOT NULL DEFAULT 'video',
      "verificationStatus"  TEXT    NOT NULL DEFAULT 'draft',
      "availabilityWindows" JSONB   NOT NULL DEFAULT '[]',
      "profileData"         JSONB,
      "createdAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await fns.query(client, results, `CREATE INDEX IF NOT EXISTS "th_doctor_profiles_account_idx" ON "th_doctor_profiles" ("accountId")`);

  // ── Patient profiles ────────────────────────────────────────────────────────
  await fns.query(client, results, `
    CREATE TABLE IF NOT EXISTS "th_patient_profiles" (
      "id"               UUID    PRIMARY KEY,
      "accountId"        TEXT    NOT NULL UNIQUE,
      "displayName"      TEXT    NOT NULL DEFAULT '',
      "hasMedicalProfile" BOOLEAN NOT NULL DEFAULT FALSE,
      "profileData"      JSONB,
      "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await fns.query(client, results, `CREATE INDEX IF NOT EXISTS "th_patient_profiles_account_idx" ON "th_patient_profiles" ("accountId")`);

  // ── Clinical notes ──────────────────────────────────────────────────────────
  await fns.query(client, results, `
    CREATE TABLE IF NOT EXISTS "th_clinical_notes" (
      "id"             UUID    PRIMARY KEY,
      "consultationId" UUID    NOT NULL,
      "authorId"       TEXT    NOT NULL,
      "status"         TEXT    NOT NULL DEFAULT 'draft',
      "noteData"       JSONB,
      "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await fns.query(client, results, `CREATE INDEX IF NOT EXISTS "th_clinical_notes_consultation_idx" ON "th_clinical_notes" ("consultationId")`);

  // ── Prescriptions ───────────────────────────────────────────────────────────
  await fns.query(client, results, `
    CREATE TABLE IF NOT EXISTS "th_prescriptions" (
      "id"             UUID   PRIMARY KEY,
      "consultationId" UUID   NOT NULL,
      "authorId"       TEXT   NOT NULL,
      "medications"    JSONB  NOT NULL DEFAULT '[]',
      "status"         TEXT   NOT NULL DEFAULT 'draft',
      "rxData"         JSONB,
      "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await fns.query(client, results, `CREATE INDEX IF NOT EXISTS "th_prescriptions_consultation_idx" ON "th_prescriptions" ("consultationId")`);

  // ── Consultations ───────────────────────────────────────────────────────────
  await fns.query(client, results, `
    CREATE TABLE IF NOT EXISTS "th_consultations" (
      "id"            UUID    PRIMARY KEY,
      "appointmentId" UUID    NOT NULL,
      "status"        TEXT    NOT NULL DEFAULT 'created',
      "startedAt"     TIMESTAMPTZ,
      "endedAt"       TIMESTAMPTZ,
      "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await fns.query(client, results, `CREATE INDEX IF NOT EXISTS "th_consultations_appointment_idx" ON "th_consultations" ("appointmentId")`);

  // ── Support tickets ─────────────────────────────────────────────────────────
  await fns.query(client, results, `
    CREATE TABLE IF NOT EXISTS "th_tickets" (
      "id"       UUID    PRIMARY KEY,
      "userId"   TEXT    NOT NULL,
      "subject"  TEXT    NOT NULL,
      "category" TEXT    NOT NULL,
      "priority" TEXT    NOT NULL DEFAULT 'medium',
      "message"  TEXT    NOT NULL,
      "status"   TEXT    NOT NULL DEFAULT 'open',
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await fns.query(client, results, `CREATE INDEX IF NOT EXISTS "th_tickets_user_idx" ON "th_tickets" ("userId")`);

  await fns.query(client, results, `
    CREATE TABLE IF NOT EXISTS "th_ticket_messages" (
      "id"        UUID    PRIMARY KEY,
      "ticketId"  UUID    NOT NULL REFERENCES "th_tickets"("id") ON DELETE CASCADE,
      "senderId"  TEXT    NOT NULL,
      "content"   TEXT    NOT NULL,
      "timestamp" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await fns.query(client, results, `CREATE INDEX IF NOT EXISTS "th_ticket_messages_ticket_idx" ON "th_ticket_messages" ("ticketId")`);

  // ── Notifications ────────────────────────────────────────────────────────────
  await fns.query(client, results, `
    CREATE TABLE IF NOT EXISTS "th_notifications" (
      "id"        UUID    PRIMARY KEY,
      "userId"    TEXT    NOT NULL,
      "title"     TEXT    NOT NULL,
      "body"      TEXT    NOT NULL,
      "read"      BOOLEAN NOT NULL DEFAULT FALSE,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await fns.query(client, results, `CREATE INDEX IF NOT EXISTS "th_notifications_user_idx" ON "th_notifications" ("userId")`);

  // ── Wallets ──────────────────────────────────────────────────────────────────
  await fns.query(client, results, `
    CREATE TABLE IF NOT EXISTS "th_wallets" (
      "userId"       TEXT   PRIMARY KEY,
      "balanceCents" BIGINT NOT NULL DEFAULT 0,
      "currency"     TEXT   NOT NULL DEFAULT 'EUR',
      "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ── Ledger (append-only) ────────────────────────────────────────────────────
  await fns.query(client, results, `
    CREATE TABLE IF NOT EXISTS "th_ledger" (
      "id"          UUID   PRIMARY KEY,
      "userId"      TEXT   NOT NULL,
      "type"        TEXT   NOT NULL,
      "amountCents" BIGINT NOT NULL,
      "description" TEXT   NOT NULL,
      "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await fns.query(client, results, `CREATE INDEX IF NOT EXISTS "th_ledger_user_idx" ON "th_ledger" ("userId")`);

  // ── Audit log (append-only, immutable) ──────────────────────────────────────
  await fns.query(client, results, `
    CREATE TABLE IF NOT EXISTS "th_audit_log" (
      "id"        UUID    PRIMARY KEY,
      "actorId"   TEXT    NOT NULL,
      "action"    TEXT    NOT NULL,
      "target"    TEXT    NOT NULL,
      "targetId"  TEXT    NOT NULL,
      "metadata"  JSONB   NOT NULL DEFAULT '{}',
      "timestamp" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await fns.query(client, results, `CREATE INDEX IF NOT EXISTS "th_audit_log_actor_idx"     ON "th_audit_log" ("actorId")`);
  await fns.query(client, results, `CREATE INDEX IF NOT EXISTS "th_audit_log_timestamp_idx" ON "th_audit_log" ("timestamp")`);

  // ── Video calls (consultation service) ──────────────────────────────────────
  await fns.query(client, results, `
    CREATE TABLE IF NOT EXISTS "th_calls" (
      "id"               UUID    PRIMARY KEY,
      "roomId"           TEXT    NOT NULL UNIQUE,
      "patientId"        TEXT    NOT NULL,
      "doctorId"         TEXT    NOT NULL,
      "status"           TEXT    NOT NULL DEFAULT 'waiting',
      "startTime"        TIMESTAMPTZ,
      "endTime"          TIMESTAMPTZ,
      "isRecording"      BOOLEAN NOT NULL DEFAULT FALSE,
      "recordingConsent" BOOLEAN NOT NULL DEFAULT FALSE,
      "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ── Chat messages ────────────────────────────────────────────────────────────
  await fns.query(client, results, `
    CREATE TABLE IF NOT EXISTS "th_chat_messages" (
      "id"         UUID    PRIMARY KEY,
      "callId"     UUID    NOT NULL,
      "senderId"   TEXT    NOT NULL,
      "senderName" TEXT    NOT NULL,
      "content"    TEXT    NOT NULL,
      "timestamp"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await fns.query(client, results, `CREATE INDEX IF NOT EXISTS "th_chat_messages_call_idx" ON "th_chat_messages" ("callId")`);

  // ── Recordings ───────────────────────────────────────────────────────────────
  await fns.query(client, results, `
    CREATE TABLE IF NOT EXISTS "th_recordings" (
      "id"           UUID    PRIMARY KEY,
      "callId"       UUID    NOT NULL,
      "url"          TEXT    NOT NULL,
      "duration"     INTEGER NOT NULL DEFAULT 0,
      "consentGiven" BOOLEAN NOT NULL DEFAULT FALSE,
      "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await fns.query(client, results, `CREATE INDEX IF NOT EXISTS "th_recordings_call_idx" ON "th_recordings" ("callId")`);
}
