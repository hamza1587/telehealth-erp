// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
// Gateway factory — routes prescription/lab operations to the correct provider by country

import { getEffectiveCountryConfig } from './GatewayConfig';
import * as DoseSpot from './DoseSpotService';
import * as HealthGorilla from './HealthGorillaService';

export type { DrugInteraction, DoseSpotPharmacy as Pharmacy, DoseSpotPrescriptionResult } from './DoseSpotService';
export type { LabOrderInput, LabOrder, LabResult } from './HealthGorillaService';

// ── Prescription ──────────────────────────────────────────────────────────────

export interface GatewayMedication {
  name: string;
  dosage: string;
  quantity: string;
  daysSupply: number;
  refills: number;
  instructions: string;
  isControlledSubstance?: boolean;
}

export interface GatewayPrescriptionInput {
  patientId: string;
  doctorId: string;
  countryCode: string;
  medications: GatewayMedication[];
  deaNumber?: string;
}

export interface GatewayPrescriptionResult {
  gateway: string;
  results: DoseSpot.DoseSpotPrescriptionResult[];
}

export async function submitPrescription(input: GatewayPrescriptionInput): Promise<GatewayPrescriptionResult> {
  const config = getEffectiveCountryConfig(input.countryCode);
  if (config.prescriptionGateway === 'dosespot') {
    const results = await Promise.all(
      input.medications.map(m =>
        DoseSpot.submitPrescription({
          patientId: input.patientId,
          doctorId: input.doctorId,
          medicationName: m.name,
          dosage: m.dosage,
          quantity: m.quantity,
          daysSupply: m.daysSupply,
          refills: m.refills,
          instructions: m.instructions,
          isControlledSubstance: m.isControlledSubstance,
          deaNumber: input.deaNumber,
        }),
      ),
    );
    return { gateway: 'dosespot', results };
  }
  throw new Error(`No prescription gateway configured for country: ${input.countryCode}`);
}

export async function getPrescriptionStatus(
  gateway: string,
  gatewayId: string,
): Promise<{ status: string; nationalId?: string }> {
  if (gateway === 'dosespot') return DoseSpot.getPrescriptionStatus(gatewayId);
  throw new Error(`Unknown prescription gateway: ${gateway}`);
}

// ── Drug interactions ─────────────────────────────────────────────────────────

export async function checkDrugInteractions(
  existingMedications: string[],
  newMedications: string[],
  countryCode: string,
): Promise<DoseSpot.DrugInteraction[]> {
  const config = getEffectiveCountryConfig(countryCode);
  if (config.prescriptionGateway === 'dosespot') {
    return DoseSpot.checkDrugInteractions(existingMedications, newMedications);
  }
  return [];
}

// ── Pharmacies ────────────────────────────────────────────────────────────────

export async function searchPharmacies(
  countryCode: string,
  city: string,
): Promise<DoseSpot.DoseSpotPharmacy[]> {
  const config = getEffectiveCountryConfig(countryCode);
  if (config.prescriptionGateway === 'dosespot') {
    return DoseSpot.searchPharmacies(city, countryCode);
  }
  return [];
}

// ── Lab orders ────────────────────────────────────────────────────────────────

export async function submitLabOrder(
  order: HealthGorilla.LabOrderInput,
  countryCode: string,
): Promise<HealthGorilla.LabOrder> {
  const config = getEffectiveCountryConfig(countryCode);
  if (config.labGateway === 'health_gorilla') return HealthGorilla.submitLabOrder(order);
  throw new Error(`No lab gateway configured for country: ${countryCode}`);
}

export async function getLabResults(
  orderId: string,
  countryCode: string,
): Promise<HealthGorilla.LabResult | undefined> {
  const config = getEffectiveCountryConfig(countryCode);
  if (config.labGateway === 'health_gorilla') return HealthGorilla.getLabResults(orderId);
  return undefined;
}

export async function getLabOrderStatus(orderId: string, countryCode: string): Promise<string> {
  const config = getEffectiveCountryConfig(countryCode);
  if (config.labGateway === 'health_gorilla') return HealthGorilla.getLabOrderStatus(orderId);
  return 'unavailable';
}
