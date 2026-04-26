/**
 * memory.js — REST API for Consensual Trauma Memory
 *
 * Endpoints:
 *   POST   /api/memory/session/start           — create session
 *   POST   /api/memory/message                 — save message (real-time)
 *   POST   /api/memory/session/end             — end session + generate summary
 *   GET    /api/memory/sessions/:userId        — list all sessions
 *   GET    /api/memory/progress/:userId        — progress report
 *   PATCH  /api/memory/session/:sessionId/share — toggle share with AI
 *   DELETE /api/memory/session/:sessionId      — delete one session
 *   DELETE /api/memory/all/:userId             — delete all memory
 */

const { Router } = require('express');
const mem = require('../services/memoryService');

const router = Router();

// Helper: quick userId validation (must be UUID-like, non-empty)
function validId(id) {
  return typeof id === 'string' && id.length >= 8;
}

// ── Start session ─────────────────────────────────────────────────────────────
router.post('/session/start', async (req, res, next) => {
  try {
    const { userId, module = 'guide' } = req.body;
    if (!validId(userId)) return res.status(422).json({ error: 'userId is required' });

    const sessionId = await mem.startSession(userId, module);
    res.json({ sessionId });
  } catch (err) { next(err); }
});

// ── Save message (real-time) ──────────────────────────────────────────────────
router.post('/message', async (req, res, next) => {
  try {
    const { sessionId, userId, role, content, module = 'guide' } = req.body;
    if (!validId(sessionId) || !validId(userId) || !content || !role) {
      return res.status(422).json({ error: 'sessionId, userId, role, content are required' });
    }
    await mem.saveMessage(sessionId, userId, role, content, module);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── End session + summarize ───────────────────────────────────────────────────
router.post('/session/end', async (req, res, next) => {
  try {
    const { sessionId, userId, module = 'guide', backend = 'nvidia' } = req.body;
    if (!validId(sessionId) || !validId(userId)) {
      return res.status(422).json({ error: 'sessionId and userId are required' });
    }
    const summary = await mem.endSession(sessionId, userId, module, backend);
    res.json({ ok: true, summary });
  } catch (err) { next(err); }
});

// ── List sessions ─────────────────────────────────────────────────────────────
router.get('/sessions/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (!validId(userId)) return res.status(422).json({ error: 'invalid userId' });

    const sessions = await mem.listSessions(userId);
    res.json({ sessions });
  } catch (err) { next(err); }
});

// ── Progress report ───────────────────────────────────────────────────────────
router.get('/progress/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const period = req.query.period || 'week'; // 'week' | 'month' | 'all'
    if (!validId(userId)) return res.status(422).json({ error: 'invalid userId' });

    const sessions = await mem.getProgress(userId, period);
    res.json({ sessions, period });
  } catch (err) { next(err); }
});

// ── Toggle share with AI ──────────────────────────────────────────────────────
router.patch('/session/:sessionId/share', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { userId, shared } = req.body;
    if (!validId(sessionId) || !validId(userId) || typeof shared !== 'boolean') {
      return res.status(422).json({ error: 'sessionId, userId, shared (boolean) required' });
    }
    await mem.toggleShare(sessionId, userId, shared);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Delete one session ────────────────────────────────────────────────────────
router.delete('/session/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { userId } = req.body;
    if (!validId(sessionId) || !validId(userId)) {
      return res.status(422).json({ error: 'sessionId and userId required' });
    }
    await mem.deleteSession(sessionId, userId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Delete ALL memory ─────────────────────────────────────────────────────────
router.delete('/all/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (!validId(userId)) return res.status(422).json({ error: 'invalid userId' });
    await mem.deleteAllMemory(userId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
