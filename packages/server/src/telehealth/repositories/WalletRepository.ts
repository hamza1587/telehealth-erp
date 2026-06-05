// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { v4 as uuidv4 } from 'uuid';
import { DatabaseMode, getDatabasePool } from '../../database';

export interface Wallet {
  userId: string;
  balanceCents: number;
  currency: string;
  createdAt: Date;
}

export interface LedgerEntry {
  id: string;
  userId: string;
  type: string;
  amountCents: number;
  description: string;
  createdAt: Date;
}

const DEFAULT_BALANCE_CENTS = 200_000; // €2000 for testing

export async function getOrCreate(userId: string): Promise<Wallet> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  // Upsert: create wallet with default balance if it doesn't exist
  const { rows } = await pool.query<Wallet>(
    `INSERT INTO th_wallets ("userId", "balanceCents", currency, "createdAt")
     VALUES ($1,$2,'EUR',NOW())
     ON CONFLICT ("userId") DO UPDATE SET "userId" = EXCLUDED."userId"
     RETURNING *`,
    [userId, DEFAULT_BALANCE_CENTS],
  );
  return rows[0];
}

export async function getByUserId(userId: string): Promise<Wallet | undefined> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<Wallet>(`SELECT * FROM th_wallets WHERE "userId" = $1`, [userId]);
  return rows[0];
}

export async function getLedger(userId: string): Promise<LedgerEntry[]> {
  const pool = getDatabasePool(DatabaseMode.READER);
  const { rows } = await pool.query<LedgerEntry>(
    `SELECT * FROM th_ledger WHERE "userId" = $1 ORDER BY "createdAt" DESC`,
    [userId],
  );
  return rows;
}

/** Atomically debit the wallet and append a ledger entry. Returns updated wallet or undefined if insufficient balance. */
export async function debit(userId: string, amountCents: number, description: string): Promise<{ wallet: Wallet; ledgerEntry: LedgerEntry } | undefined> {
  const pool = getDatabasePool(DatabaseMode.WRITER);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: walletRows } = await client.query<Wallet>(
      `UPDATE th_wallets SET "balanceCents" = "balanceCents" - $1
       WHERE "userId" = $2 AND "balanceCents" >= $1
       RETURNING *`,
      [amountCents, userId],
    );

    if (!walletRows[0]) {
      await client.query('ROLLBACK');
      return undefined;
    }

    const ledgerId = uuidv4();
    const { rows: ledgerRows } = await client.query<LedgerEntry>(
      `INSERT INTO th_ledger (id, "userId", type, "amountCents", description, "createdAt")
       VALUES ($1,$2,'debit',$3,$4,NOW()) RETURNING *`,
      [ledgerId, userId, amountCents, description],
    );

    await client.query('COMMIT');
    return { wallet: walletRows[0], ledgerEntry: ledgerRows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
