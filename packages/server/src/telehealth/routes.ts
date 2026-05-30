// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticateRequest } from '../oauth/middleware';
import { getAuthenticatedContext } from '../context';
import { sendOutcome } from '../fhir/outcomes';
import { notFound } from '@medplum/core';

function param(req: Request, key: string): string {
  const v = req.params[key];
  if (Array.isArray(v)) return v[0];
  return v;
}

// ──────────────────────────────────────────────
// STORES
// ──────────────────────────────────────────────
interface Appointment {
  id: string; patientAccountId: string; doctorProfileId: string;
  scheduledStartsAt: Date; scheduledEndsAt: Date; consultationMode: 'video'|'phone';
  status: 'pending_payment'|'confirmed'|'in_progress'|'completed'|'cancelled_patient'|'cancelled_doctor'|'no_show_patient';
  pricePerMinute: number; createdAt: Date;
}
const appointments: Map<string, Appointment> = new Map();

interface DoctorProfile {
  id: string; accountId: string; displayName: string; specialty: string; legalName?: string; phone?: string;
  consultationMode: 'video'|'phone'|'both'; verificationStatus: 'draft'|'pending'|'verified'|'rejected';
  availabilityWindows: { id: string; dayOfWeek: number; startTime: string; endTime: string }[]; createdAt: Date;
}
const doctorProfiles: Map<string, DoctorProfile> = new Map();

interface PatientProfile {
  id: string; accountId: string; displayName: string;
  hasMedicalProfile: boolean; createdAt: Date;
}
const patientProfiles: Map<string, PatientProfile> = new Map();

interface ClinicalNote {
  id: string; consultationId: string; authorId: string; status: 'draft'|'finalized'; createdAt: Date;
}
const clinicalNotes: Map<string, ClinicalNote> = new Map();

interface Prescription {
  id: string; consultationId: string; authorId: string; medications: any[]; status: 'draft'|'issued'; createdAt: Date;
}
const prescriptions: Map<string, Prescription> = new Map();

interface Consultation {
  id: string; appointmentId: string; status: 'created'|'active'|'ended'; startedAt?: Date; endedAt?: Date; createdAt: Date;
}
const consultations: Map<string, Consultation> = new Map();

interface Ticket {
  id: string; userId: string; subject: string; category: string; priority: 'low'|'medium'|'high';
  message: string; status: 'open'|'in_progress'|'resolved';
  messages: { id: string; senderId: string; content: string; timestamp: Date }[];
  createdAt: Date;
}
const tickets: Map<string, Ticket> = new Map();

interface Notification { id: string; userId: string; title: string; body: string; read: boolean; createdAt: Date; }
const notificationsList: Notification[] = [];

interface Wallet { userId: string; balanceCents: number; currency: string; createdAt: Date; }
const wallets: Map<string, Wallet> = new Map();
const ledger: { id: string; userId: string; type: string; amountCents: number; description: string; createdAt: Date }[] = [];
const auditLog: { id: string; actorId: string; action: string; target: string; targetId: string; metadata: Record<string, any>; timestamp: Date }[] = [];

function uid(_req: Request): string {
  return getAuthenticatedContext().authState.membership.profile.reference as string;
}

function audit(req: Request, action: string, target: string, targetId: string, meta: Record<string, any> = {}): void {
  auditLog.push({ id: uuidv4(), actorId: uid(req), action, target, targetId, metadata: meta, timestamp: new Date() });
}

// ──────────────────────────────────────────────
// PLATFORM ROUTER — /api/platform/*
// ──────────────────────────────────────────────
const platform = Router();

platform.get('/appointments/my-appointments', (req: Request, res: Response) => {
  const u = uid(req);
  res.json(Array.from(appointments.values()).filter(a => a.patientAccountId === u || a.doctorProfileId === u));
});

platform.get('/appointments/:appointmentId', (req: Request, res: Response) => {
  const apt = appointments.get(param(req, 'appointmentId'));
  if (!apt) { sendOutcome(res, notFound); return; }
  res.json(apt);
});

platform.post('/bookings', async (req: Request, res: Response) => {
  try {
    const u = uid(req);
    const body = req.body as { doctorProfileId: string; scheduledStartsAt: string; scheduledEndsAt?: string; consultationMode?: string; pricePerMinute?: number };
    if (!body.doctorProfileId || !body.scheduledStartsAt) { sendOutcome(res, notFound); return; }
    const apt: Appointment = {
      id: uuidv4(), patientAccountId: u, doctorProfileId: body.doctorProfileId,
      scheduledStartsAt: new Date(body.scheduledStartsAt),
      scheduledEndsAt: new Date(body.scheduledEndsAt ?? body.scheduledStartsAt),
      consultationMode: (body.consultationMode as 'video'|'phone') ?? 'video',
      status: 'pending_payment', pricePerMinute: body.pricePerMinute ?? 1.5, createdAt: new Date(),
    };
    appointments.set(apt.id, apt);
    audit(req, 'appointment.book', 'Appointment', apt.id);
    res.status(201).json(apt);
  } catch {
    sendOutcome(res, notFound);
  }
});

platform.post('/appointments/:id/cancel', (req: Request, res: Response) => {
  const apt = appointments.get(param(req, 'id'));
  if (!apt) { sendOutcome(res, notFound); return; }
  apt.status = 'cancelled_patient';
  audit(req, 'appointment.cancel', 'Appointment', apt.id);
  res.json({ success: true, apt });
});

platform.post('/appointments/:id/reschedule', (req: Request, res: Response) => {
  const apt = appointments.get(param(req, 'id'));
  if (!apt) { sendOutcome(res, notFound); return; }
  const { scheduledStartsAt, scheduledEndsAt } = req.body as { scheduledStartsAt: string; scheduledEndsAt?: string };
  apt.scheduledStartsAt = new Date(scheduledStartsAt);
  apt.scheduledEndsAt = new Date(scheduledEndsAt ?? scheduledStartsAt);
  apt.status = 'confirmed';
  audit(req, 'appointment.reschedule', 'Appointment', apt.id);
  res.json({ success: true, apt });
});

// Discovery
platform.get('/discovery/doctors', (req: Request, res: Response) => {
  const q = String(req.query.q ?? '');
  const specialty = String(req.query.specialty ?? '');
  let list = Array.from(doctorProfiles.values()).filter(d => d.verificationStatus === 'verified');
  if (specialty) list = list.filter(d => d.specialty.toLowerCase().includes(specialty.toLowerCase()));
  if (q) list = list.filter(d => d.displayName.toLowerCase().includes(q.toLowerCase()));
  res.json(list);
});

platform.get('/discovery/doctors/:doctorId', (req: Request, res: Response) => {
  const doc = doctorProfiles.get(param(req, 'doctorId'));
  res.json(doc ?? { error: 'Not found' });
});

// Notifications
platform.get('/notifications/my-notifications', (req: Request, res: Response) => {
  res.json(notificationsList.filter(n => n.userId === uid(req)));
});

platform.get('/notifications/my-preferences', (_req: Request, res: Response) => res.json({ email: true, push: true, sms: true }));

platform.post('/notifications/:notifId/read', (req: Request, res: Response) => {
  const n = notificationsList.find(n => n.id === param(req, 'notifId'));
  if (n) n.read = true;
  res.json({ success: true });
});

platform.post('/notifications/read-all', (req: Request, res: Response) => {
  notificationsList.filter(n => n.userId === uid(req)).forEach(n => { n.read = true; });
  res.json({ success: true });
});

platform.put('/notifications/my-preferences', (req: Request, res: Response) => res.json({ success: true, preferences: req.body }));

// Support
platform.get('/support/my-tickets', (req: Request, res: Response) => res.json(Array.from(tickets.values()).filter(t => t.userId === uid(req))));
platform.get('/support/tickets/:ticketId', (req: Request, res: Response) => {
  const t = tickets.get(param(req, 'ticketId'));
  res.json(t ?? { error: 'Not found' });
});

platform.post('/support/tickets', async (req: Request, res: Response) => {
  try {
    const u = uid(req);
    const body = req.body as { subject: string; category: string; priority?: string; message: string };
    const t: Ticket = {
      id: uuidv4(), userId: u, subject: body.subject, category: body.category,
      priority: (body.priority as 'low'|'medium'|'high') ?? 'medium',
      message: body.message, status: 'open',
      messages: [{ id: uuidv4(), senderId: u, content: body.message, timestamp: new Date() }],
      createdAt: new Date(),
    };
    tickets.set(t.id, t);
    audit(req, 'ticket.create', 'Ticket', t.id);
    res.status(201).json(t);
  } catch {
    sendOutcome(res, notFound);
  }
});

platform.post('/support/tickets/:ticketId/reply', (req: Request, res: Response) => {
  const t = tickets.get(param(req, 'ticketId'));
  if (!t) { sendOutcome(res, notFound); return; }
  t.messages.push({ id: uuidv4(), senderId: uid(req), content: req.body.content, timestamp: new Date() });
  res.json(t);
});

platform.post('/support/tickets/:ticketId/close', (req: Request, res: Response) => {
  const t = tickets.get(param(req, 'ticketId'));
  if (!t) { sendOutcome(res, notFound); return; }
  t.status = 'resolved';
  audit(req, 'ticket.close', 'Ticket', t.id);
  res.json({ success: true });
});

// Clinical Notes
platform.get('/clinical-notes/consultation/:consultationId', (req: Request, res: Response) => {
  const cId = param(req, 'consultationId');
  const n = Array.from(clinicalNotes.values()).find(n => n.consultationId === cId);
  res.json(n ?? null);
});

platform.post('/clinical-notes/consultation/:consultationId', async (req: Request, res: Response) => {
  try {
    const u = uid(req);
    const cId = param(req, 'consultationId');
    const existing = Array.from(clinicalNotes.values()).find(n => n.consultationId === cId);
    if (existing) {
      if (existing.status === 'finalized') { sendOutcome(res, notFound); return; }
      Object.assign(existing, req.body as Record<string, any>);
      res.json(existing); return;
    }
    const note: ClinicalNote = { id: uuidv4(), consultationId: cId, authorId: u, status: 'draft', createdAt: new Date(), ...(req.body as Record<string, any>) };
    clinicalNotes.set(note.id, note);
    res.status(201).json(note);
  } catch {
    sendOutcome(res, notFound);
  }
});

platform.post('/clinical-notes/:noteId/finalize', (req: Request, res: Response) => {
  const note = clinicalNotes.get(param(req, 'noteId'));
  if (!note) { sendOutcome(res, notFound); return; }
  note.status = 'finalized';
  audit(req, 'clinical.finalize', 'ClinicalNote', note.id);
  res.json({ success: true, note });
});

// Prescriptions
platform.get('/prescriptions/consultation/:consultationId', (req: Request, res: Response) => {
  const cId = param(req, 'consultationId');
  const rx = Array.from(prescriptions.values()).find(p => p.consultationId === cId);
  res.json(rx ?? null);
});

platform.post('/prescriptions/consultation/:consultationId', async (req: Request, res: Response) => {
  try {
    const u = uid(req);
    const cId = param(req, 'consultationId');
    const existing = Array.from(prescriptions.values()).find(p => p.consultationId === cId);
    if (existing) {
      if (existing.status === 'issued') { sendOutcome(res, notFound); return; }
      Object.assign(existing, req.body as Record<string, any>);
      res.json(existing); return;
    }
    const rx: Prescription = { id: uuidv4(), consultationId: cId, authorId: u, medications: [], status: 'draft', createdAt: new Date(), ...(req.body as Record<string, any>) };
    prescriptions.set(rx.id, rx);
    res.status(201).json(rx);
  } catch {
    sendOutcome(res, notFound);
  }
});

platform.post('/prescriptions/:rxId/issue', (req: Request, res: Response) => {
  const rx = prescriptions.get(param(req, 'rxId'));
  if (!rx) { sendOutcome(res, notFound); return; }
  rx.status = 'issued';
  audit(req, 'rx.issue', 'Prescription', rx.id);
  res.json({ success: true, prescription: rx });
});

// Consultations
platform.post('/consultations/appointment/:appointmentId', async (req: Request, res: Response) => {
  try {
    const c: Consultation = { id: uuidv4(), appointmentId: param(req, 'appointmentId'), status: 'created', createdAt: new Date() };
    consultations.set(c.id, c);
    res.status(201).json(c);
  } catch {
    sendOutcome(res, notFound);
  }
});

platform.get('/consultations/:consultationId', (req: Request, res: Response) => {
  const c = consultations.get(param(req, 'consultationId'));
  res.json(c ?? { error: 'Not found' });
});

platform.post('/consultations/:id/join', (req: Request, res: Response) => {
  const c = consultations.get(param(req, 'id'));
  if (!c) { sendOutcome(res, notFound); return; }
  if (c.status === 'ended') { sendOutcome(res, notFound); return; }
  c.status = 'active'; c.startedAt = new Date();
  res.json({ token: `token-${c.id}-${Date.now()}`, sessionId: c.id, consultation: c });
});

platform.post('/consultations/:id/end', (req: Request, res: Response) => {
  const c = consultations.get(param(req, 'id'));
  if (!c) { sendOutcome(res, notFound); return; }
  c.status = 'ended'; c.endedAt = new Date();
  audit(req, 'consultation.end', 'Consultation', c.id);
  res.json({ success: true, consultation: c });
});

// Research
platform.get('/research/studies', (_req: Request, res: Response) => res.json([]));
platform.get('/research/my-studies', (_req: Request, res: Response) => res.json([]));
platform.post('/research/studies/:studyId/enroll', (req: Request, res: Response) => res.json({ success: true }));
platform.post('/research/studies/:studyId/withdraw', (req: Request, res: Response) => res.json({ success: true }));

// Analytics
platform.get('/analytics/summary', (_req: Request, res: Response) => {
  res.json({
    totalPatients: patientProfiles.size,
    totalDoctors: doctorProfiles.size,
    totalAppointments: appointments.size,
    completedAppointments: Array.from(appointments.values()).filter(a => a.status === 'completed').length,
  });
});
platform.get('/analytics/consultations', (_req: Request, res: Response) => res.json(Array.from(consultations.values())));
platform.get('/analytics/revenue', (_req: Request, res: Response) => {
  const totalCents = ledger.filter(e => e.type === 'debit').reduce((s, e) => s + e.amountCents, 0);
  res.json({ totalRevenueCents: totalCents, currency: 'EUR' });
});
platform.get('/analytics/patients', (_req: Request, res: Response) => res.json(Array.from(patientProfiles.values())));

// Admin
platform.get('/admin/audit-log', (_req: Request, res: Response) => res.json(auditLog));
platform.get('/admin/users', (_req: Request, res: Response) => {
  const users = [
    ...Array.from(patientProfiles.values()).map(p => ({ id: p.accountId, type: 'patient', name: p.displayName })),
    ...Array.from(doctorProfiles.values()).map(d => ({ id: d.accountId, type: 'doctor', name: d.displayName })),
  ];
  res.json(users);
});
platform.put('/admin/users/:userId/status', (req: Request, res: Response) => {
  audit(req, 'admin.userStatus', 'User', param(req, 'userId'), { status: req.body.status });
  res.json({ success: true });
});

// GDPR
platform.post('/gdpr/export-data', (req: Request, res: Response) => {
  audit(req, 'gdpr.export', 'User', uid(req));
  res.json({ downloadUrl: `/api/platform/gdpr/export-data/${uid(req)}/${uuidv4()}` });
});

// ──────────────────────────────────────────────
// TELEHEALTH ROUTER — /api/telehealth/*
// Patients, Doctors, Wallets, Billing
// ──────────────────────────────────────────────
const telehealth = Router();
telehealth.use(authenticateRequest);

telehealth.post('/patients/register', async (req: Request, res: Response) => {
  try {
    const u = uid(req);
    const body = req.body as { displayName: string };
    if (!body.displayName) { sendOutcome(res, notFound); return; }
    if (!patientProfiles.has(u)) {
      patientProfiles.set(u, { id: uuidv4(), accountId: u, displayName: body.displayName, hasMedicalProfile: false, createdAt: new Date() });
      audit(req, 'patient.register', 'PatientProfile', u);
    }
    res.json(patientProfiles.get(u));
  } catch {
    sendOutcome(res, notFound);
  }
});

telehealth.put('/patients/onboarding', (req: Request, res: Response) => {
  const prof = patientProfiles.get(uid(req));
  if (!prof) { sendOutcome(res, notFound); return; }
  Object.assign(prof, req.body as Record<string, any>, { hasMedicalProfile: true });
  audit(req, 'patient.onboarding', 'PatientProfile', prof.id);
  res.json(prof);
});

telehealth.get('/patients/me', (req: Request, res: Response) => {
  const prof = patientProfiles.get(uid(req));
  res.json(prof ?? null);
});

telehealth.put('/patients/profile', (req: Request, res: Response) => {
  const prof = patientProfiles.get(uid(req));
  if (!prof) { sendOutcome(res, notFound); return; }
  Object.assign(prof, req.body as Record<string, any>);
  res.json(prof);
});

telehealth.post('/doctors/onboarding', async (req: Request, res: Response) => {
  try {
    const u = uid(req);
    if (doctorProfiles.has(u)) { sendOutcome(res, notFound); return; }
    const body = req.body as Partial<DoctorProfile>;
    const prof: DoctorProfile = { id: uuidv4(), accountId: u, displayName: body.displayName ?? '', specialty: body.specialty ?? '', verificationStatus: 'draft', availabilityWindows: [], createdAt: new Date(), consultationMode: 'video', ...(body as Record<string, any>) };
    doctorProfiles.set(u, prof);
    audit(req, 'doctor.onboarding', 'DoctorProfile', prof.id);
    res.status(201).json(prof);
  } catch {
    sendOutcome(res, notFound);
  }
});

telehealth.put('/doctors/profile', (req: Request, res: Response) => {
  const prof = doctorProfiles.get(uid(req));
  if (!prof) { sendOutcome(res, notFound); return; }
  Object.assign(prof, req.body as Record<string, any>);
  res.json(prof);
});

telehealth.put('/doctors/availability', (req: Request, res: Response) => {
  const prof = doctorProfiles.get(uid(req));
  if (!prof) { sendOutcome(res, notFound); return; }
  const { availabilityWindows } = req.body as { availabilityWindows?: { id: string; dayOfWeek: number; startTime: string; endTime: string }[] };
  if (Array.isArray(availabilityWindows)) prof.availabilityWindows = availabilityWindows;
  audit(req, 'doctor.availability', 'DoctorProfile', prof.id);
  res.json({ success: true, availabilityWindows: prof.availabilityWindows });
});

telehealth.put('/doctors/verification', (req: Request, res: Response) => {
  const prof = doctorProfiles.get(uid(req));
  if (!prof) { sendOutcome(res, notFound); return; }
  Object.assign(prof, req.body as Record<string, any>);
  res.json(prof);
});

telehealth.get('/doctors/:doctorId/availability', (req: Request, res: Response) => {
  const docId = param(req, 'doctorId');
  const doc = doctorProfiles.get(docId);
  res.json(doc ? { availabilityWindows: doc.availabilityWindows } : { error: 'Not found' });
});

// Wallets
telehealth.get('/wallets/my-wallet', (req: Request, res: Response) => {
  let w = wallets.get(uid(req));
  if (!w) { w = { userId: uid(req), balanceCents: 200000, currency: 'EUR', createdAt: new Date() }; wallets.set(uid(req), w); }
  res.json(w);
});

telehealth.get('/wallets/my-wallet/ledger', (req: Request, res: Response) => {
  res.json(ledger.filter(e => e.userId === uid(req)));
});

telehealth.post('/wallets/reserve', (req: Request, res: Response) => {
  const u = uid(req);
  const costCents = Math.round(((req.body.estimatedSeconds ?? 60) * (req.body.pricePerSecond ?? 0.025)) * 100);
  let w = wallets.get(u);
  if (!w) { w = { userId: u, balanceCents: 200000, currency: 'EUR', createdAt: new Date() }; wallets.set(u, w); }
  if (w.balanceCents < costCents) { sendOutcome(res, notFound); return; }
  w.balanceCents -= costCents;
  ledger.push({ id: uuidv4(), userId: u, type: 'debit', amountCents: costCents, description: String(req.body.appointmentId ?? 'reserve'), createdAt: new Date() });
  audit(req, 'wallet.reserve', 'Wallet', u, { amountCents: costCents });
  res.json({ success: true, billingSessionId: uuidv4(), balanceCents: w.balanceCents });
});

telehealth.post('/billing/:billingSessionId/finalize', (req: Request, res: Response) => {
  const actualCents = Math.round(((req.body.actualSeconds ?? 60) * (req.body.pricePerSecond ?? 0.025)) * 100);
  const bal = wallets.get(uid(req))?.balanceCents ?? 0;
  res.json({ success: true, finalCostCents: actualCents, balanceCents: bal });
});

export { platform as platformRouter, telehealth as telehealthRouter };
