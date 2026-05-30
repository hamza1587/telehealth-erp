import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

interface Call {
  id: string;
  roomId: string;
  patientId: string;
  doctorId: string;
  status: 'waiting' | 'active' | 'completed';
  startTime?: Date;
  endTime?: Date;
  isRecording: boolean;
  recordingConsent: boolean;
  createdAt: Date;
}

interface ChatMessage {
  id: string;
  callId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: Date;
}

interface Recording {
  id: string;
  callId: string;
  url: string;
  duration: number;
  consentGiven: boolean;
  createdAt: Date;
}

const calls: Map<string, Call> = new Map();
const chatMessages: Map<string, ChatMessage[]> = new Map();
const recordings: Map<string, Recording> = new Map();

router.post('/signal', async (req: Request, res: Response): Promise<void> => {
  try {
    const { type, data, targetId, senderId } = req.body;

    if (!type || !data || !targetId || !senderId) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    res.json({
      success: true,
      message: 'Signal sent',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Signal error:', error);
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

    const call: Call = {
      id: uuidv4(),
      roomId: `room-${uuidv4()}`,
      patientId,
      doctorId,
      status: 'waiting',
      isRecording: false,
      recordingConsent,
      createdAt: new Date()
    };

    calls.set(call.id, call);
    chatMessages.set(call.id, []);

    res.status(201).json(call);
  } catch (error) {
    console.error('Create call error:', error);
    res.status(500).json({ error: 'Failed to create call' });
  }
});

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const callId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const call = calls.get(callId);
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }
    res.json(call);
  } catch (error) {
    console.error('Get call error:', error);
    res.status(500).json({ error: 'Failed to get call' });
  }
});

router.post('/:id/join', async (req: Request, res: Response): Promise<void> => {
  try {
    const callId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const call = calls.get(callId);
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    if (call.status === 'completed') {
      res.status(400).json({ error: 'Call has ended' });
      return;
    }

    if (call.status === 'waiting') {
      call.status = 'active';
      call.startTime = new Date();
    }

    const token = `token-${call.roomId}-${Date.now()}`;

    res.json({ token, roomId: call.roomId, call });
  } catch (error) {
    console.error('Join call error:', error);
    res.status(500).json({ error: 'Failed to join call' });
  }
});

router.post('/:id/end', async (req: Request, res: Response): Promise<void> => {
  try {
    const callId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const call = calls.get(callId);
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    call.status = 'completed';
    call.endTime = new Date();
    call.isRecording = false;

    res.json({ success: true, call });
  } catch (error) {
    console.error('End call error:', error);
    res.status(500).json({ error: 'Failed to end call' });
  }
});

router.get('/:id/chat', async (req: Request, res: Response): Promise<void> => {
  try {
    const callId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const messages = chatMessages.get(callId) || [];
    res.json(messages);
  } catch (error) {
    console.error('Get chat error:', error);
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

    const callId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const messages = chatMessages.get(callId) || [];
    const newMessage: ChatMessage = {
      id: uuidv4(),
      callId,
      senderId,
      senderName,
      content,
      timestamp: new Date()
    };

    messages.push(newMessage);
    chatMessages.set(callId, messages);

    res.status(201).json(newMessage);
  } catch (error) {
    console.error('Send chat error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

router.post('/:id/recording/start', async (req: Request, res: Response): Promise<void> => {
  try {
    const callId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const call = calls.get(callId);
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    if (!call.recordingConsent) {
      res.status(403).json({ error: 'Recording consent required' });
      return;
    }

    call.isRecording = true;

    res.json({ success: true, message: 'Recording started' });
  } catch (error) {
    console.error('Start recording error:', error);
    res.status(500).json({ error: 'Failed to start recording' });
  }
});

router.post('/:id/recording/stop', async (req: Request, res: Response): Promise<void> => {
  try {
    const callId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const call = calls.get(callId);
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    call.isRecording = false;

    const recording: Recording = {
      id: uuidv4(),
      callId,
      url: `https://storage.example.com/recordings/${callId}.mp4`,
      duration: 0,
      consentGiven: true,
      createdAt: new Date()
    };

    recordings.set(recording.id, recording);

    res.json({ success: true, recording });
  } catch (error) {
    console.error('Stop recording error:', error);
    res.status(500).json({ error: 'Failed to stop recording' });
  }
});

router.get('/:id/recording', async (req: Request, res: Response): Promise<void> => {
  try {
    const callId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const callRecordings = Array.from(recordings.values())
      .filter(r => r.callId === callId);
    res.json(callRecordings);
  } catch (error) {
    console.error('Get recordings error:', error);
    res.status(500).json({ error: 'Failed to get recordings' });
  }
});

export { router as consultationRouter };