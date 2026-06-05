// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticateRequest } from '../oauth/middleware';
import { getAuthenticatedContext } from '../context';
import { sendOutcome } from '../fhir/outcomes';
import { notFound } from '@medplum/core';
import * as AppointmentRepo from './repositories/AppointmentRepository';
import * as DoctorRepo from './repositories/DoctorRepository';
import * as PatientRepo from './repositories/PatientRepository';
import * as ClinicalNoteRepo from './repositories/ClinicalNoteRepository';
import * as PrescriptionRepo from './repositories/PrescriptionRepository';
import * as ConsultationRepo from './repositories/ConsultationRepository';
import * as TicketRepo from './repositories/TicketRepository';
import * as NotificationRepo from './repositories/NotificationRepository';
import * as WalletRepo from './repositories/WalletRepository';
import * as AuditLogRepo from './repositories/AuditLogRepository';

function param(req: Request, key: string): string {
  const v = req.params[key];
  if (Array.isArray(v)) return v[0];
  return v;
}

function uid(_req: Request): string {
  return getAuthenticatedContext().authState.membership.profile.reference as string;
}

async function audit(req: Request, action: string, target: string, targetId: string, meta: Record<string, unknown> = {}): Promise<void> {
  await AuditLogRepo.append(uid(req), action, target, targetId, meta);
}

// ──────────────────────────────────────────────
// PLATFORM ROUTER — /api/platform/*
// ──────────────────────────────────────────────
const platform = Router();

platform.get('/appointments/my-appointments', async (req: Request, res: Response): Promise<void> => {
  try {
    const appointments = await AppointmentRepo.findByUser(uid(req));
    res.json(appointments);
  } catch (error) {
    console.error('[platform] my-appointments error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

platform.get('/appointments/:appointmentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const apt = await AppointmentRepo.findById(param(req, 'appointmentId'));
    if (!apt) { sendOutcome(res, notFound); return; }
    res.json(apt);
  } catch (error) {
    console.error('[platform] get appointment error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

platform.post('/bookings', async (req: Request, res: Response): Promise<void> => {
  try {
    const u = uid(req);
    const body = req.body as { doctorProfileId: string; scheduledStartsAt: string; scheduledEndsAt?: string; consultationMode?: string; pricePerMinute?: number };
    if (!body.doctorProfileId || !body.scheduledStartsAt) { sendOutcome(res, notFound); return; }
    const apt = await AppointmentRepo.create({
      patientAccountId: u,
      doctorProfileId: body.doctorProfileId,
      scheduledStartsAt: new Date(body.scheduledStartsAt),
      scheduledEndsAt: new Date(body.scheduledEndsAt ?? body.scheduledStartsAt),
      consultationMode: (body.consultationMode as 'video' | 'phone') ?? 'video',
      pricePerMinute: body.pricePerMinute ?? 1.5,
      status: 'pending_payment',
    });
    await audit(req, 'appointment.book', 'Appointment', apt.id);
    res.status(201).json(apt);
  } catch (error) {
    console.error('[platform] book appointment error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

platform.post('/appointments/:id/cancel', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = param(req, 'id');
    const apt = await AppointmentRepo.updateStatus(id, 'cancelled_patient');
    if (!apt) { sendOutcome(res, notFound); return; }
    await audit(req, 'appointment.cancel', 'Appointment', id);
    res.json({ success: true, apt });
  } catch (error) {
    console.error('[platform] cancel appointment error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

platform.post('/appointments/:id/reschedule', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = param(req, 'id');
    const { scheduledStartsAt, scheduledEndsAt } = req.body as { scheduledStartsAt: string; scheduledEndsAt?: string };
    const apt = await AppointmentRepo.reschedule(id, new Date(scheduledStartsAt), new Date(scheduledEndsAt ?? scheduledStartsAt));
    if (!apt) { sendOutcome(res, notFound); return; }
    await audit(req, 'appointment.reschedule', 'Appointment', id);
    res.json({ success: true, apt });
  } catch (error) {
    console.error('[platform] reschedule error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

// Discovery
platform.get('/discovery/doctors', async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query.q ? String(req.query.q) : undefined;
    const specialty = req.query.specialty ? String(req.query.specialty) : undefined;
    const list = await DoctorRepo.findAllVerified(specialty, q);
    res.json(list);
  } catch (error) {
    console.error('[platform] discovery doctors error:', error instanceof Error ? error.message : String(error));
    res.json([]);
  }
});

platform.get('/discovery/doctors/:doctorId', async (req: Request, res: Response): Promise<void> => {
  try {
    const doc = await DoctorRepo.findById(param(req, 'doctorId'));
    res.json(doc ?? { error: 'Not found' });
  } catch (error) {
    console.error('[platform] get doctor error:', error instanceof Error ? error.message : String(error));
    res.json({ error: 'Not found' });
  }
});

// Notifications
platform.get('/notifications/my-notifications', async (req: Request, res: Response): Promise<void> => {
  try {
    const notifications = await NotificationRepo.findByUser(uid(req));
    res.json(notifications);
  } catch (error) {
    console.error('[platform] notifications error:', error instanceof Error ? error.message : String(error));
    res.json([]);
  }
});

platform.get('/notifications/my-preferences', (_req: Request, res: Response): void => {
  res.json({ email: true, push: true, sms: true });
});

platform.post('/notifications/:notifId/read', async (req: Request, res: Response): Promise<void> => {
  try {
    await NotificationRepo.markRead(param(req, 'notifId'));
    res.json({ success: true });
  } catch (error) {
    console.error('[platform] mark read error:', error instanceof Error ? error.message : String(error));
    res.json({ success: false });
  }
});

platform.post('/notifications/read-all', async (req: Request, res: Response): Promise<void> => {
  try {
    await NotificationRepo.markAllRead(uid(req));
    res.json({ success: true });
  } catch (error) {
    console.error('[platform] mark all read error:', error instanceof Error ? error.message : String(error));
    res.json({ success: false });
  }
});

platform.put('/notifications/my-preferences', (req: Request, res: Response): void => {
  res.json({ success: true, preferences: req.body });
});

// Support
platform.get('/support/my-tickets', async (req: Request, res: Response): Promise<void> => {
  try {
    const tickets = await TicketRepo.findByUser(uid(req));
    res.json(tickets);
  } catch (error) {
    console.error('[platform] my-tickets error:', error instanceof Error ? error.message : String(error));
    res.json([]);
  }
});

platform.get('/support/tickets/:ticketId', async (req: Request, res: Response): Promise<void> => {
  try {
    const t = await TicketRepo.findById(param(req, 'ticketId'));
    res.json(t ?? { error: 'Not found' });
  } catch (error) {
    console.error('[platform] get ticket error:', error instanceof Error ? error.message : String(error));
    res.json({ error: 'Not found' });
  }
});

platform.post('/support/tickets', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as { subject: string; category: string; priority?: string; message: string };
    const t = await TicketRepo.create(uid(req), body);
    await audit(req, 'ticket.create', 'Ticket', t.id);
    res.status(201).json(t);
  } catch (error) {
    console.error('[platform] create ticket error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

platform.post('/support/tickets/:ticketId/reply', async (req: Request, res: Response): Promise<void> => {
  try {
    const t = await TicketRepo.addMessage(param(req, 'ticketId'), uid(req), req.body.content);
    if (!t) { sendOutcome(res, notFound); return; }
    res.json(t);
  } catch (error) {
    console.error('[platform] reply ticket error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

platform.post('/support/tickets/:ticketId/close', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = param(req, 'ticketId');
    await TicketRepo.close(id);
    await audit(req, 'ticket.close', 'Ticket', id);
    res.json({ success: true });
  } catch (error) {
    console.error('[platform] close ticket error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

// Clinical Notes
platform.get('/clinical-notes/consultation/:consultationId', async (req: Request, res: Response): Promise<void> => {
  try {
    const note = await ClinicalNoteRepo.findByConsultationId(param(req, 'consultationId'));
    res.json(note ?? null);
  } catch (error) {
    console.error('[platform] get notes error:', error instanceof Error ? error.message : String(error));
    res.json(null);
  }
});

platform.post('/clinical-notes/consultation/:consultationId', async (req: Request, res: Response): Promise<void> => {
  try {
    const u = uid(req);
    const cId = param(req, 'consultationId');
    const existing = await ClinicalNoteRepo.findByConsultationId(cId);
    if (existing) {
      if (existing.status === 'finalized') { sendOutcome(res, notFound); return; }
      const updated = await ClinicalNoteRepo.update(existing.id as string, req.body as Record<string, unknown>);
      res.json(updated); return;
    }
    const note = await ClinicalNoteRepo.create(cId, u, req.body as Record<string, unknown>);
    res.status(201).json(note);
  } catch (error) {
    console.error('[platform] upsert note error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

platform.post('/clinical-notes/:noteId/finalize', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = param(req, 'noteId');
    const note = await ClinicalNoteRepo.finalize(id);
    if (!note) { sendOutcome(res, notFound); return; }
    await audit(req, 'clinical.finalize', 'ClinicalNote', id);
    res.json({ success: true, note });
  } catch (error) {
    console.error('[platform] finalize note error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

// Prescriptions
platform.get('/prescriptions/consultation/:consultationId', async (req: Request, res: Response): Promise<void> => {
  try {
    const rx = await PrescriptionRepo.findByConsultationId(param(req, 'consultationId'));
    res.json(rx ?? null);
  } catch (error) {
    console.error('[platform] get rx error:', error instanceof Error ? error.message : String(error));
    res.json(null);
  }
});

platform.post('/prescriptions/consultation/:consultationId', async (req: Request, res: Response): Promise<void> => {
  try {
    const u = uid(req);
    const cId = param(req, 'consultationId');
    const existing = await PrescriptionRepo.findByConsultationId(cId);
    if (existing) {
      if (existing.status === 'issued') { sendOutcome(res, notFound); return; }
      const updated = await PrescriptionRepo.update(existing.id as string, req.body as Record<string, unknown>);
      res.json(updated); return;
    }
    const rx = await PrescriptionRepo.create(cId, u, req.body as Record<string, unknown>);
    res.status(201).json(rx);
  } catch (error) {
    console.error('[platform] upsert rx error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

platform.post('/prescriptions/:rxId/issue', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = param(req, 'rxId');
    const prescription = await PrescriptionRepo.issue(id);
    if (!prescription) { sendOutcome(res, notFound); return; }
    await audit(req, 'rx.issue', 'Prescription', id);
    res.json({ success: true, prescription });
  } catch (error) {
    console.error('[platform] issue rx error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

// Consultations
platform.post('/consultations/appointment/:appointmentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const c = await ConsultationRepo.create(param(req, 'appointmentId'));
    res.status(201).json(c);
  } catch (error) {
    console.error('[platform] create consultation error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

platform.get('/consultations/:consultationId', async (req: Request, res: Response): Promise<void> => {
  try {
    const c = await ConsultationRepo.findById(param(req, 'consultationId'));
    res.json(c ?? { error: 'Not found' });
  } catch (error) {
    console.error('[platform] get consultation error:', error instanceof Error ? error.message : String(error));
    res.json({ error: 'Not found' });
  }
});

platform.post('/consultations/:id/join', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = param(req, 'id');
    const c = await ConsultationRepo.findById(id);
    if (!c) { sendOutcome(res, notFound); return; }
    if (c.status === 'ended') { sendOutcome(res, notFound); return; }
    const updated = await ConsultationRepo.join(id);
    res.json({ token: `token-${id}-${Date.now()}`, sessionId: id, consultation: updated ?? c });
  } catch (error) {
    console.error('[platform] join consultation error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

platform.post('/consultations/:id/end', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = param(req, 'id');
    const consultation = await ConsultationRepo.end(id);
    if (!consultation) { sendOutcome(res, notFound); return; }
    await audit(req, 'consultation.end', 'Consultation', id);
    res.json({ success: true, consultation });
  } catch (error) {
    console.error('[platform] end consultation error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

// Research
platform.get('/research/studies', (_req: Request, res: Response): void => { res.json([]); });
platform.get('/research/my-studies', (_req: Request, res: Response): void => { res.json([]); });
platform.post('/research/studies/:studyId/enroll', (_req: Request, res: Response): void => { res.json({ success: true }); });
platform.post('/research/studies/:studyId/withdraw', (_req: Request, res: Response): void => { res.json({ success: true }); });

// Analytics
platform.get('/analytics/summary', async (_req: Request, res: Response): Promise<void> => {
  try {
    const [totalPatients, totalDoctors, totalAppointments, completedAppointments] = await Promise.all([
      PatientRepo.count(),
      DoctorRepo.count(),
      AppointmentRepo.count(),
      AppointmentRepo.countByStatus('completed'),
    ]);
    res.json({ totalPatients, totalDoctors, totalAppointments, completedAppointments });
  } catch (error) {
    console.error('[platform] analytics summary error:', error instanceof Error ? error.message : String(error));
    res.json({ totalPatients: 0, totalDoctors: 0, totalAppointments: 0, completedAppointments: 0 });
  }
});

platform.get('/analytics/consultations', async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json(await ConsultationRepo.findAll());
  } catch (error) {
    console.error('[platform] analytics consultations error:', error instanceof Error ? error.message : String(error));
    res.json([]);
  }
});

platform.get('/analytics/revenue', async (req: Request, res: Response): Promise<void> => {
  try {
    const ledger = await WalletRepo.getLedger(uid(req));
    const totalCents = ledger.filter(e => e.type === 'debit').reduce((s, e) => s + e.amountCents, 0);
    res.json({ totalRevenueCents: totalCents, currency: 'EUR' });
  } catch (error) {
    console.error('[platform] analytics revenue error:', error instanceof Error ? error.message : String(error));
    res.json({ totalRevenueCents: 0, currency: 'EUR' });
  }
});

platform.get('/analytics/patients', async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json(await PatientRepo.findAll());
  } catch (error) {
    console.error('[platform] analytics patients error:', error instanceof Error ? error.message : String(error));
    res.json([]);
  }
});

// Admin
platform.get('/admin/audit-log', async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json(await AuditLogRepo.findAll());
  } catch (error) {
    console.error('[platform] audit-log error:', error instanceof Error ? error.message : String(error));
    res.json([]);
  }
});

platform.get('/admin/users', async (_req: Request, res: Response): Promise<void> => {
  try {
    const [patients, doctors] = await Promise.all([PatientRepo.findAll(), DoctorRepo.findAll()]);
    const users = [
      ...patients.map(p => ({ id: p.accountId, type: 'patient', name: p.displayName })),
      ...doctors.map(d => ({ id: d.accountId, type: 'doctor', name: d.displayName })),
    ];
    res.json(users);
  } catch (error) {
    console.error('[platform] admin users error:', error instanceof Error ? error.message : String(error));
    res.json([]);
  }
});

platform.put('/admin/users/:userId/status', async (req: Request, res: Response): Promise<void> => {
  try {
    await audit(req, 'admin.userStatus', 'User', param(req, 'userId'), { status: req.body.status });
    res.json({ success: true });
  } catch (error) {
    console.error('[platform] admin user status error:', error instanceof Error ? error.message : String(error));
    res.json({ success: false });
  }
});

// GDPR
platform.post('/gdpr/export-data', async (req: Request, res: Response): Promise<void> => {
  try {
    const u = uid(req);
    await audit(req, 'gdpr.export', 'User', u);
    res.json({ downloadUrl: `/api/platform/gdpr/export-data/${u}/${uuidv4()}` });
  } catch (error) {
    console.error('[platform] gdpr export error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

// ──────────────────────────────────────────────
// TELEHEALTH ROUTER — /api/telehealth/*
// Patients, Doctors, Wallets, Billing
// ──────────────────────────────────────────────
const telehealth = Router();
telehealth.use(authenticateRequest);

telehealth.post('/patients/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const u = uid(req);
    const body = req.body as { displayName: string };
    if (!body.displayName) { sendOutcome(res, notFound); return; }
    const existing = await PatientRepo.findByAccountId(u);
    if (existing) { res.json(existing); return; }
    const prof = await PatientRepo.create(u, body.displayName);
    await audit(req, 'patient.register', 'PatientProfile', u);
    res.json(prof);
  } catch (error) {
    console.error('[telehealth] patient register error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

telehealth.put('/patients/onboarding', async (req: Request, res: Response): Promise<void> => {
  try {
    const u = uid(req);
    const prof = await PatientRepo.updateOnboarding(u, req.body as Record<string, unknown>);
    if (!prof) { sendOutcome(res, notFound); return; }
    await audit(req, 'patient.onboarding', 'PatientProfile', prof.id);
    res.json(prof);
  } catch (error) {
    console.error('[telehealth] patient onboarding error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

telehealth.get('/patients/me', async (req: Request, res: Response): Promise<void> => {
  try {
    const prof = await PatientRepo.findByAccountId(uid(req));
    res.json(prof ?? null);
  } catch (error) {
    console.error('[telehealth] patient me error:', error instanceof Error ? error.message : String(error));
    res.json(null);
  }
});

telehealth.put('/patients/profile', async (req: Request, res: Response): Promise<void> => {
  try {
    const prof = await PatientRepo.update(uid(req), req.body as Record<string, unknown>);
    if (!prof) { sendOutcome(res, notFound); return; }
    res.json(prof);
  } catch (error) {
    console.error('[telehealth] patient profile update error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

telehealth.post('/doctors/onboarding', async (req: Request, res: Response): Promise<void> => {
  try {
    const u = uid(req);
    const existing = await DoctorRepo.findByAccountId(u);
    if (existing) { sendOutcome(res, notFound); return; }
    const body = req.body as Record<string, unknown>;
    const prof = await DoctorRepo.create(u, body);
    await audit(req, 'doctor.onboarding', 'DoctorProfile', prof.id);
    res.status(201).json(prof);
  } catch (error) {
    console.error('[telehealth] doctor onboarding error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

telehealth.put('/doctors/profile', async (req: Request, res: Response): Promise<void> => {
  try {
    const prof = await DoctorRepo.update(uid(req), req.body as Record<string, unknown>);
    if (!prof) { sendOutcome(res, notFound); return; }
    res.json(prof);
  } catch (error) {
    console.error('[telehealth] doctor profile error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

telehealth.put('/doctors/availability', async (req: Request, res: Response): Promise<void> => {
  try {
    const u = uid(req);
    const { availabilityWindows } = req.body as { availabilityWindows?: { id: string; dayOfWeek: number; startTime: string; endTime: string }[] };
    const windows = Array.isArray(availabilityWindows) ? availabilityWindows : [];
    await DoctorRepo.updateAvailability(u, windows);
    await audit(req, 'doctor.availability', 'DoctorProfile', u);
    res.json({ success: true, availabilityWindows: windows });
  } catch (error) {
    console.error('[telehealth] doctor availability error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

telehealth.put('/doctors/verification', async (req: Request, res: Response): Promise<void> => {
  try {
    const prof = await DoctorRepo.update(uid(req), req.body as Record<string, unknown>);
    if (!prof) { sendOutcome(res, notFound); return; }
    res.json(prof);
  } catch (error) {
    console.error('[telehealth] doctor verification error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

telehealth.get('/doctors/:doctorId/availability', async (req: Request, res: Response): Promise<void> => {
  try {
    const doc = await DoctorRepo.findById(param(req, 'doctorId'));
    res.json(doc ? { availabilityWindows: doc.availabilityWindows } : { error: 'Not found' });
  } catch (error) {
    console.error('[telehealth] doctor availability get error:', error instanceof Error ? error.message : String(error));
    res.json({ error: 'Not found' });
  }
});

// Wallets
telehealth.get('/wallets/my-wallet', async (req: Request, res: Response): Promise<void> => {
  try {
    const wallet = await WalletRepo.getOrCreate(uid(req));
    res.json(wallet);
  } catch (error) {
    console.error('[telehealth] get wallet error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

telehealth.get('/wallets/my-wallet/ledger', async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await WalletRepo.getLedger(uid(req)));
  } catch (error) {
    console.error('[telehealth] ledger error:', error instanceof Error ? error.message : String(error));
    res.json([]);
  }
});

telehealth.post('/wallets/reserve', async (req: Request, res: Response): Promise<void> => {
  try {
    const u = uid(req);
    const costCents = Math.round(((req.body.estimatedSeconds ?? 60) * (req.body.pricePerSecond ?? 0.025)) * 100);
    await WalletRepo.getOrCreate(u);
    const result = await WalletRepo.debit(u, costCents, String(req.body.appointmentId ?? 'reserve'));
    if (!result) { sendOutcome(res, notFound); return; }
    await audit(req, 'wallet.reserve', 'Wallet', u, { amountCents: costCents });
    res.json({ success: true, billingSessionId: uuidv4(), balanceCents: result.wallet.balanceCents });
  } catch (error) {
    console.error('[telehealth] wallet reserve error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

telehealth.post('/billing/:billingSessionId/finalize', async (req: Request, res: Response): Promise<void> => {
  try {
    const actualCents = Math.round(((req.body.actualSeconds ?? 60) * (req.body.pricePerSecond ?? 0.025)) * 100);
    const wallet = await WalletRepo.getByUserId(uid(req));
    res.json({ success: true, finalCostCents: actualCents, balanceCents: wallet?.balanceCents ?? 0 });
  } catch (error) {
    console.error('[telehealth] billing finalize error:', error instanceof Error ? error.message : String(error));
    sendOutcome(res, notFound);
  }
});

export { platform as platformRouter, telehealth as telehealthRouter };
