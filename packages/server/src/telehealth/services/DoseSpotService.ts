// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
// DoseSpot REST API v1 client — e-prescriptions, drug interactions, pharmacy search

import { getDoseSpotCredentials } from './GatewayConfig';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DoseSpotPrescriptionInput {
  patientId: string;
  doctorId: string;
  medicationName: string;
  dosage: string;
  quantity: string;
  daysSupply: number;
  refills: number;
  instructions: string;
  isControlledSubstance?: boolean;
  deaNumber?: string;
}

export interface DoseSpotPrescriptionResult {
  gatewayPrescriptionId: string;
  status: string;
  nationalPrescriptionId?: string;
}

export interface DrugInteraction {
  medication1: string;
  medication2: string;
  severity: 'Low' | 'Moderate' | 'High';
  description: string;
  recommendation: string;
}

export interface DoseSpotPharmacy {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  acceptsEPrescriptions: boolean;
  isOnline: boolean;
}

// ── Token cache ───────────────────────────────────────────────────────────────

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

async function getAuthToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }
  const creds = getDoseSpotCredentials();
  const res = await fetch(`${creds.baseUrl}/api/v1/login/clinician`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Clinic: { ClinicKey: creds.clinicKey },
      Clinician: { ClinicianKey: creds.clinicianKey },
    }),
  });
  if (!res.ok) throw new Error(`DoseSpot auth failed: HTTP ${res.status}`);
  const data = await res.json() as { Token: string; Expires: string };
  tokenCache = { token: data.Token, expiresAt: new Date(data.Expires).getTime() };
  return tokenCache.token;
}

async function dsPost<T>(path: string, body: unknown): Promise<T> {
  const [token, creds] = await Promise.all([getAuthToken(), Promise.resolve(getDoseSpotCredentials())]);
  const res = await fetch(`${creds.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`DoseSpot POST ${path} failed: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function dsGet<T>(path: string): Promise<T> {
  const [token, creds] = await Promise.all([getAuthToken(), Promise.resolve(getDoseSpotCredentials())]);
  const res = await fetch(`${creds.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`DoseSpot GET ${path} failed: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// ── API surface ───────────────────────────────────────────────────────────────

export async function submitPrescription(rx: DoseSpotPrescriptionInput): Promise<DoseSpotPrescriptionResult> {
  const result = await dsPost<{ PrescriptionId: string; Status: string; NationalPrescriptionId?: string }>(
    '/api/v1/prescriptions',
    {
      PatientId: rx.patientId,
      PrescriberId: rx.doctorId,
      MedicationName: rx.medicationName,
      Quantity: rx.quantity,
      DaysSupply: rx.daysSupply,
      Refills: rx.refills,
      Directions: rx.instructions,
      IsControlledSubstance: rx.isControlledSubstance ?? false,
      DeaNumber: rx.deaNumber ?? '',
    },
  );
  return {
    gatewayPrescriptionId: result.PrescriptionId,
    status: result.Status,
    nationalPrescriptionId: result.NationalPrescriptionId,
  };
}

export async function getPrescriptionStatus(gatewayId: string): Promise<{ status: string; nationalId?: string }> {
  const result = await dsGet<{ Status: string; NationalPrescriptionId?: string }>(`/api/v1/prescriptions/${gatewayId}`);
  return { status: result.Status, nationalId: result.NationalPrescriptionId };
}

export async function checkDrugInteractions(
  existingMedications: string[],
  newMedications: string[],
): Promise<DrugInteraction[]> {
  const result = await dsPost<{
    Interactions: { Drug1: string; Drug2: string; Severity: string; Description: string; Recommendation: string }[];
  }>('/api/v1/drug-interactions', { ExistingMedications: existingMedications, NewMedications: newMedications });
  return (result.Interactions ?? []).map(i => ({
    medication1: i.Drug1,
    medication2: i.Drug2,
    severity: i.Severity as DrugInteraction['severity'],
    description: i.Description,
    recommendation: i.Recommendation,
  }));
}

export async function searchPharmacies(city: string, state: string): Promise<DoseSpotPharmacy[]> {
  const result = await dsGet<{
    Pharmacies: {
      PharmacyId: string;
      PharmacyName: string;
      Address1: string;
      City: string;
      State: string;
      ZipCode: string;
      PrimaryPhone: string;
      IsMailOrder: boolean;
    }[];
  }>(`/api/v1/pharmacies/search?City=${encodeURIComponent(city)}&State=${encodeURIComponent(state)}`);
  return (result.Pharmacies ?? []).map(p => ({
    id: p.PharmacyId,
    name: p.PharmacyName,
    address: p.Address1,
    city: p.City,
    state: p.State,
    zip: p.ZipCode,
    phone: p.PrimaryPhone,
    acceptsEPrescriptions: true,
    isOnline: p.IsMailOrder,
  }));
}
