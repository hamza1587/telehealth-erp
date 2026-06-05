// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

export type PrescriptionGateway = 'dosespot' | 'none';
export type LabGateway = 'health_gorilla' | 'none';

export interface CountryGatewayConfig {
  prescriptionGateway: PrescriptionGateway;
  labGateway: LabGateway;
}

// Default country-to-gateway mapping
const DEFAULT_COUNTRY_CONFIG: Record<string, CountryGatewayConfig> = {
  US: { prescriptionGateway: 'dosespot', labGateway: 'health_gorilla' },
  DE: { prescriptionGateway: 'dosespot', labGateway: 'health_gorilla' },
  FR: { prescriptionGateway: 'dosespot', labGateway: 'health_gorilla' },
  GB: { prescriptionGateway: 'dosespot', labGateway: 'health_gorilla' },
  AT: { prescriptionGateway: 'dosespot', labGateway: 'health_gorilla' },
  CH: { prescriptionGateway: 'dosespot', labGateway: 'health_gorilla' },
  NL: { prescriptionGateway: 'dosespot', labGateway: 'health_gorilla' },
  BE: { prescriptionGateway: 'dosespot', labGateway: 'health_gorilla' },
  ES: { prescriptionGateway: 'dosespot', labGateway: 'health_gorilla' },
  IT: { prescriptionGateway: 'dosespot', labGateway: 'health_gorilla' },
  _DEFAULT: { prescriptionGateway: 'none', labGateway: 'none' },
};

// Runtime overrides set by admin (in-memory; a production system would persist these to DB)
const runtimeOverrides = new Map<string, CountryGatewayConfig>();

export function getEffectiveCountryConfig(countryCode: string): CountryGatewayConfig {
  const key = countryCode.toUpperCase();
  return runtimeOverrides.get(key) ?? DEFAULT_COUNTRY_CONFIG[key] ?? DEFAULT_COUNTRY_CONFIG._DEFAULT;
}

export function setCountryConfig(countryCode: string, config: CountryGatewayConfig): void {
  runtimeOverrides.set(countryCode.toUpperCase(), config);
}

export function getAllConfigs(): Record<string, CountryGatewayConfig> {
  const merged: Record<string, CountryGatewayConfig> = { ...DEFAULT_COUNTRY_CONFIG };
  for (const [k, v] of runtimeOverrides) {
    merged[k] = v;
  }
  delete merged._DEFAULT;
  return merged;
}

// ── Credentials ───────────────────────────────────────────────────────────────

export interface DoseSpotCredentials {
  baseUrl: string;
  clinicKey: string;
  clinicianKey: string;
}

export interface HealthGorillaCredentials {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
}

export function getDoseSpotCredentials(): DoseSpotCredentials {
  return {
    baseUrl: process.env.DOSESPOT_BASE_URL ?? 'https://my.dosespot.com',
    clinicKey: process.env.DOSESPOT_CLINIC_KEY ?? '',
    clinicianKey: process.env.DOSESPOT_CLINICIAN_KEY ?? '',
  };
}

export function getHealthGorillaCredentials(): HealthGorillaCredentials {
  return {
    baseUrl: process.env.HEALTH_GORILLA_BASE_URL ?? 'https://api.healthgorilla.com',
    clientId: process.env.HEALTH_GORILLA_CLIENT_ID ?? '',
    clientSecret: process.env.HEALTH_GORILLA_CLIENT_SECRET ?? '',
    tokenUrl: process.env.HEALTH_GORILLA_TOKEN_URL ?? 'https://api.healthgorilla.com/oauth2/token',
  };
}
