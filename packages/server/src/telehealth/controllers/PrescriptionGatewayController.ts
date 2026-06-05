// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Router, Request, Response } from 'express';
import { getAuthenticatedContext } from '../../context';
import { getAllConfigs, setCountryConfig } from '../services/GatewayConfig';
import * as Gateway from '../services/PrescriptionGatewayService';
import type { LabOrderInput } from '../services/HealthGorillaService';

const router = Router();

function uid(_req: Request): string {
  return getAuthenticatedContext().authState.membership.profile.reference as string;
}

// POST /gateway/prescription/submit
router.post('/prescription/submit', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Gateway.GatewayPrescriptionInput;
    if (!body.patientId || !body.countryCode || !Array.isArray(body.medications) || !body.medications.length) {
      res.status(400).json({ error: 'patientId, countryCode, and medications[] are required' });
      return;
    }
    const doctorId = body.doctorId || uid(req);
    const result = await Gateway.submitPrescription({ ...body, doctorId });
    res.json(result);
  } catch (error) {
    console.error('[gateway] submit prescription:', error instanceof Error ? error.message : String(error));
    res.status(502).json({ error: 'Gateway error', detail: error instanceof Error ? error.message : String(error) });
  }
});

// GET /gateway/prescription/:gateway/:id/status
router.get('/prescription/:gateway/:id/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const gateway = Array.isArray(req.params.gateway) ? req.params.gateway[0] : req.params.gateway;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const status = await Gateway.getPrescriptionStatus(gateway, id);
    res.json(status);
  } catch (error) {
    console.error('[gateway] prescription status:', error instanceof Error ? error.message : String(error));
    res.status(502).json({ error: 'Gateway error' });
  }
});

// POST /gateway/drug-interactions/check
router.post('/drug-interactions/check', async (req: Request, res: Response): Promise<void> => {
  try {
    const { existingMedications, newMedications, countryCode = 'DE' } = req.body as {
      existingMedications: string[];
      newMedications: string[];
      countryCode?: string;
    };
    if (!Array.isArray(existingMedications) || !Array.isArray(newMedications)) {
      res.status(400).json({ error: 'existingMedications and newMedications must be arrays' });
      return;
    }
    const interactions = await Gateway.checkDrugInteractions(existingMedications, newMedications, countryCode);
    res.json(interactions);
  } catch (error) {
    console.error('[gateway] drug interactions:', error instanceof Error ? error.message : String(error));
    res.status(502).json({ error: 'Gateway error' });
  }
});

// GET /gateway/pharmacies/nearby?countryCode=DE&city=Berlin
router.get('/pharmacies/nearby', async (req: Request, res: Response): Promise<void> => {
  try {
    const countryCode = String(req.query.countryCode ?? 'DE');
    const city = String(req.query.city ?? '');
    if (!city) { res.status(400).json({ error: 'city is required' }); return; }
    const pharmacies = await Gateway.searchPharmacies(countryCode, city);
    res.json(pharmacies);
  } catch (error) {
    console.error('[gateway] pharmacy search:', error instanceof Error ? error.message : String(error));
    res.status(502).json({ error: 'Gateway error' });
  }
});

// POST /gateway/lab-orders/submit
router.post('/lab-orders/submit', async (req: Request, res: Response): Promise<void> => {
  try {
    const { countryCode = 'DE', patientId, testCode, testDisplay, priority = 'routine', notes } = req.body as {
      countryCode?: string;
      patientId: string;
      testCode: string;
      testDisplay: string;
      priority?: 'routine' | 'urgent' | 'asap';
      notes?: string;
    };
    if (!patientId || !testCode || !testDisplay) {
      res.status(400).json({ error: 'patientId, testCode, and testDisplay are required' });
      return;
    }
    const order: LabOrderInput = { patientId, requesterId: uid(req), testCode, testDisplay, priority, notes };
    const result = await Gateway.submitLabOrder(order, countryCode);
    res.status(201).json(result);
  } catch (error) {
    console.error('[gateway] lab order submit:', error instanceof Error ? error.message : String(error));
    res.status(502).json({ error: 'Gateway error', detail: error instanceof Error ? error.message : String(error) });
  }
});

// GET /gateway/lab-orders/:id/results?countryCode=DE
router.get('/lab-orders/:id/results', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const countryCode = String(req.query.countryCode ?? 'DE');
    const results = await Gateway.getLabResults(id, countryCode);
    res.json(results ?? null);
  } catch (error) {
    console.error('[gateway] lab results:', error instanceof Error ? error.message : String(error));
    res.status(502).json({ error: 'Gateway error' });
  }
});

// GET /gateway/lab-orders/:id/status?countryCode=DE
router.get('/lab-orders/:id/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const countryCode = String(req.query.countryCode ?? 'DE');
    const status = await Gateway.getLabOrderStatus(id, countryCode);
    res.json({ status });
  } catch (error) {
    console.error('[gateway] lab order status:', error instanceof Error ? error.message : String(error));
    res.status(502).json({ error: 'Gateway error' });
  }
});

// GET /gateway/config  (admin — returns all country configs)
router.get('/config', (_req: Request, res: Response): void => {
  res.json(getAllConfigs());
});

// PUT /gateway/config/:countryCode  (admin — override gateway for one country)
router.put('/config/:countryCode', (req: Request, res: Response): void => {
  const countryCode = Array.isArray(req.params.countryCode) ? req.params.countryCode[0] : req.params.countryCode;
  const { prescriptionGateway, labGateway } = req.body as {
    prescriptionGateway: 'dosespot' | 'none';
    labGateway: 'health_gorilla' | 'none';
  };
  if (!prescriptionGateway || !labGateway) {
    res.status(400).json({ error: 'prescriptionGateway and labGateway are required' });
    return;
  }
  setCountryConfig(countryCode, { prescriptionGateway, labGateway });
  res.json({ success: true, countryCode: countryCode.toUpperCase(), prescriptionGateway, labGateway });
});

export { router as gatewayRouter };
