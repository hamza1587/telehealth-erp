// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
// Health Gorilla FHIR R4 client — lab order submission and results retrieval

import { getHealthGorillaCredentials } from './GatewayConfig';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LabOrderInput {
  patientId: string;
  requesterId: string;
  testCode: string;
  testDisplay: string;
  priority: 'routine' | 'urgent' | 'asap';
  notes?: string;
}

export interface LabOrder {
  id: string;
  status: string;
  testCode: string;
  testDisplay: string;
  createdAt: string;
}

export interface LabResultObservation {
  code: string;
  display: string;
  value: string;
  unit: string;
  referenceRange?: string;
  interpretation?: string;
}

export interface LabResult {
  id: string;
  orderId: string;
  status: string;
  conclusion?: string;
  results: LabResultObservation[];
  issuedAt?: string;
}

// ── FHIR shapes (minimal) ─────────────────────────────────────────────────────

interface FhirServiceRequest {
  id?: string;
  status?: string;
  code?: { coding?: { code?: string; display?: string }[] };
  authoredOn?: string;
}

interface FhirObservation {
  code?: { coding?: { code?: string; display?: string }[] };
  valueQuantity?: { value?: number; unit?: string };
  valueString?: string;
  referenceRange?: { text?: string }[];
  interpretation?: { coding?: { code?: string }[] }[];
}

interface FhirDiagnosticReport {
  id?: string;
  status?: string;
  conclusion?: string;
  issued?: string;
  result?: { reference?: string }[];
}

interface FhirBundle<T> {
  entry?: { resource?: T }[];
}

// ── Token cache ───────────────────────────────────────────────────────────────

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }
  const creds = getHealthGorillaCredentials();
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope: 'fhirUser patient/*.write patient/*.read',
  });
  const res = await fetch(creds.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Health Gorilla auth failed: HTTP ${res.status}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  tokenCache = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return tokenCache.accessToken;
}

async function hgPost<T>(path: string, body: unknown): Promise<T> {
  const [token, creds] = await Promise.all([getAccessToken(), Promise.resolve(getHealthGorillaCredentials())]);
  const res = await fetch(`${creds.baseUrl}/fhir/R4${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/fhir+json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Health Gorilla POST ${path} failed: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function hgGet<T>(path: string): Promise<T> {
  const [token, creds] = await Promise.all([getAccessToken(), Promise.resolve(getHealthGorillaCredentials())]);
  const res = await fetch(`${creds.baseUrl}/fhir/R4${path}`, {
    headers: { Accept: 'application/fhir+json', Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Health Gorilla GET ${path} failed: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// ── API surface ───────────────────────────────────────────────────────────────

export async function submitLabOrder(order: LabOrderInput): Promise<LabOrder> {
  const fhirOrder = {
    resourceType: 'ServiceRequest',
    status: 'active',
    intent: 'order',
    priority: order.priority,
    subject: { reference: `Patient/${order.patientId}` },
    requester: { reference: `Practitioner/${order.requesterId}` },
    code: { coding: [{ system: 'http://loinc.org', code: order.testCode, display: order.testDisplay }] },
    note: order.notes ? [{ text: order.notes }] : undefined,
    authoredOn: new Date().toISOString(),
  };
  const result = await hgPost<FhirServiceRequest>('/ServiceRequest', fhirOrder);
  return {
    id: result.id ?? '',
    status: result.status ?? 'active',
    testCode: result.code?.coding?.[0]?.code ?? order.testCode,
    testDisplay: result.code?.coding?.[0]?.display ?? order.testDisplay,
    createdAt: result.authoredOn ?? new Date().toISOString(),
  };
}

export async function getLabOrderStatus(orderId: string): Promise<string> {
  const order = await hgGet<FhirServiceRequest>(`/ServiceRequest/${orderId}`);
  return order.status ?? 'unknown';
}

export async function getLabResults(orderId: string): Promise<LabResult | undefined> {
  const bundle = await hgGet<FhirBundle<FhirDiagnosticReport>>(`/DiagnosticReport?based-on=ServiceRequest/${orderId}`);
  const report = bundle.entry?.[0]?.resource;
  if (!report) return undefined;

  // Fetch individual observations if result references exist
  const observations: LabResultObservation[] = [];
  for (const ref of report.result ?? []) {
    if (!ref.reference) continue;
    try {
      const obs = await hgGet<FhirObservation>(`/${ref.reference}`);
      const value = obs.valueQuantity
        ? `${obs.valueQuantity.value ?? ''} ${obs.valueQuantity.unit ?? ''}`.trim()
        : (obs.valueString ?? '');
      observations.push({
        code: obs.code?.coding?.[0]?.code ?? '',
        display: obs.code?.coding?.[0]?.display ?? '',
        value,
        unit: obs.valueQuantity?.unit ?? '',
        referenceRange: obs.referenceRange?.[0]?.text,
        interpretation: obs.interpretation?.[0]?.coding?.[0]?.code,
      });
    } catch {
      // Skip observations that fail to load
    }
  }

  return {
    id: report.id ?? '',
    orderId,
    status: report.status ?? 'unknown',
    conclusion: report.conclusion,
    results: observations,
    issuedAt: report.issued,
  };
}
