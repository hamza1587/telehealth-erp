// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { v4 as uuidv4 } from 'uuid';

export type Comparator = 'gt' | 'lt' | 'gte' | 'lte' | 'eq';

export interface AlertRule {
  id: string;
  name: string;
  metric: string;
  threshold: number;
  comparator: Comparator;
  enabled: boolean;
  description?: string;
  createdAt: Date;
}

export interface ActiveAlert {
  ruleId: string;
  ruleName: string;
  metric: string;
  currentValue: number;
  threshold: number;
  comparator: Comparator;
  firedAt: Date;
}

// In-memory rule store — persisted to DB in a future milestone
const rules = new Map<string, AlertRule>();

// Seed with sensible defaults
const DEFAULTS: Omit<AlertRule, 'id' | 'createdAt'>[] = [
  { name: 'High active consultations', metric: 'activeConsultations', threshold: 100, comparator: 'gte', enabled: true, description: 'Alert when concurrent consultations exceed 100' },
  { name: 'Low daily registrations', metric: 'dailyNewPatients', threshold: 1, comparator: 'lt', enabled: true, description: 'Alert when fewer than 1 new patient registered today' },
  { name: 'Revenue drop', metric: 'dailyRevenueCents', threshold: 0, comparator: 'lte', enabled: true, description: 'Alert when daily revenue is zero' },
];

for (const d of DEFAULTS) {
  const rule: AlertRule = { id: uuidv4(), createdAt: new Date(), ...d };
  rules.set(rule.id, rule);
}

export function listRules(): AlertRule[] {
  return Array.from(rules.values());
}

export function getRule(id: string): AlertRule | undefined {
  return rules.get(id);
}

export function createRule(data: Omit<AlertRule, 'id' | 'createdAt'>): AlertRule {
  const rule: AlertRule = { id: uuidv4(), createdAt: new Date(), ...data };
  rules.set(rule.id, rule);
  return rule;
}

export function updateRule(id: string, data: Partial<Omit<AlertRule, 'id' | 'createdAt'>>): AlertRule | undefined {
  const existing = rules.get(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...data };
  rules.set(id, updated);
  return updated;
}

export function deleteRule(id: string): boolean {
  return rules.delete(id);
}

function evaluate(value: number, comparator: Comparator, threshold: number): boolean {
  switch (comparator) {
    case 'gt': return value > threshold;
    case 'lt': return value < threshold;
    case 'gte': return value >= threshold;
    case 'lte': return value <= threshold;
    case 'eq': return value === threshold;
  }
}

/**
 * Check all enabled alert rules against the provided metrics snapshot.
 * Returns only the rules that are currently firing.
 */
export function checkAlerts(metrics: Record<string, number>): ActiveAlert[] {
  const active: ActiveAlert[] = [];
  for (const rule of rules.values()) {
    if (!rule.enabled) continue;
    const value = metrics[rule.metric];
    if (value === undefined) continue;
    if (evaluate(value, rule.comparator, rule.threshold)) {
      active.push({
        ruleId: rule.id,
        ruleName: rule.name,
        metric: rule.metric,
        currentValue: value,
        threshold: rule.threshold,
        comparator: rule.comparator,
        firedAt: new Date(),
      });
    }
  }
  return active;
}
