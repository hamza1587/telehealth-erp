import { Router, Request, Response } from 'express';
import * as CallRepository from './repositories/CallRepository';

const router = Router();

function callId(req: Request): string {
  const v = req.params.id;
  return Array.isArray(v) ? v[0] : v;
}

router.post('/signal', async (req: Request, res: Response): Promise<void> => {
  try {
    const { type, data, targetId, senderId } = req.body;
    if (!type || !data || !targetId || !senderId) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }
    res.json({ success: true, message: 'Signal sent', timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('[consultation] signal error:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: 'Failed to send signal' });
  }
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { patientId, doctorId, recordingConsent = false } = req.body;
    if (!patientId || !doctorId) {
      res.status(400).json({ error: 'Patient ID and Doctor ID are required' });
      return;
    }
    const call = await CallRepository.create(patientId, doctorId, recordingConsent);
    res.status(201).json(call);
  } catch (error) {
    console.error('[consultation] create call error:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: 'Failed to create call' });
  }
});

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const call = await CallRepository.findById(callId(req));
    if (!call) { res.status(404).json({ error: 'Call not found' }); return; }
    res.json(call);
  } catch (error) {
    console.error('[consultation] get call error:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: 'Failed to get call' });
  }
});

router.post('/:id/join', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = callId(req);
    const call = await CallRepository.findById(id);
    if (!call) { res.status(404).json({ error: 'Call not found' }); return; }
    if (call.status === 'completed') { res.status(400).json({ error: 'Call has ended' }); return; }

    const updated = await CallRepository.join(id);
    const token = `token-${updated?.roomId ?? id}-${Date.now()}`;
    res.json({ token, roomId: updated?.roomId ?? call.roomId, call: updated ?? call });
  } catch (error) {
    console.error('[consultation] join call error:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: 'Failed to join call' });
  }
});

router.post('/:id/end', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = callId(req);
    const call = await CallRepository.end(id);
    if (!call) { res.status(404).json({ error: 'Call not found' }); return; }
    res.json({ success: true, call });
  } catch (error) {
    console.error('[consultation] end call error:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: 'Failed to end call' });
  }
});

router.get('/:id/chat', async (req: Request, res: Response): Promise<void> => {
  try {
    const messages = await CallRepository.getChatMessages(callId(req));
    res.json(messages);
  } catch (error) {
    console.error('[consultation] get chat error:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: 'Failed to get chat messages' });
  }
});

router.post('/:id/chat', async (req: Request, res: Response): Promise<void> => {
  try {
    const { content } = req.body;
    const senderId = typeof req.headers['x-user-id'] === 'string' ? req.headers['x-user-id'] : '';
    const senderName = typeof req.headers['x-user-name'] === 'string' ? req.headers['x-user-name'] : '';

    if (!content || !senderId || !senderName) {
      res.status(400).json({ error: 'Content, sender ID, and sender name are required' });
      return;
    }

    const msg = await CallRepository.addChatMessage(callId(req), senderId, senderName, content);
    res.status(201).json(msg);
  } catch (error) {
    console.error('[consultation] send chat error:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: 'Failed to send message' });
  }
});

router.post('/:id/recording/start', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = callId(req);
    const call = await CallRepository.findById(id);
    if (!call) { res.status(404).json({ error: 'Call not found' }); return; }
    if (!call.recordingConsent) { res.status(403).json({ error: 'Recording consent required' }); return; }
    await CallRepository.setRecording(id, true);
    res.json({ success: true, message: 'Recording started' });
  } catch (error) {
    console.error('[consultation] start recording error:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: 'Failed to start recording' });
  }
});

router.post('/:id/recording/stop', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = callId(req);
    const call = await CallRepository.findById(id);
    if (!call) { res.status(404).json({ error: 'Call not found' }); return; }
    await CallRepository.setRecording(id, false);
    const recording = await CallRepository.addRecording(id, `https://storage.example.com/recordings/${id}.mp4`, 0, true);
    res.json({ success: true, recording });
  } catch (error) {
    console.error('[consultation] stop recording error:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: 'Failed to stop recording' });
  }
});

router.get('/:id/recording', async (req: Request, res: Response): Promise<void> => {
  try {
    const recordings = await CallRepository.getRecordings(callId(req));
    res.json(recordings);
  } catch (error) {
    console.error('[consultation] get recordings error:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: 'Failed to get recordings' });
  }
});

export { router as consultationRouter };
