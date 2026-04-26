const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const reminder = require('../services/reminderService');

const router = Router();
router.use(authenticate);

// ---------------------------------------------------------------------------
// Push Subscription Registration
// ---------------------------------------------------------------------------

// POST /api/reminders/push/subscribe
// Body: { subscription: <PushSubscription object from browser> }
router.post('/push/subscribe', async (req, res, next) => {
  try {
    const { subscription } = req.body;
    if (!subscription?.endpoint) {
      return res.status(422).json({ error: 'Invalid push subscription object' });
    }
    const result = await reminder.registerPushSubscription(req.user.id, subscription);
    res.status(201).json({ message: 'Push subscription registered', id: result.id });
  } catch (err) {
    next(err);
  }
});

// GET /api/reminders/push/vapid-key
// Returns the VAPID public key — needed by the frontend to subscribe
router.get('/push/vapid-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// ---------------------------------------------------------------------------
// Reminder CRUD
// ---------------------------------------------------------------------------

// POST /api/reminders
router.post(
  '/',
  [
    body('title').notEmpty().withMessage('title is required'),
    body('recurrence').optional().isIn(['once', 'daily', 'weekly', 'weekdays']),
    body('recurrence_time')
      .optional()
      .matches(/^\d{2}:\d{2}$/)
      .withMessage('recurrence_time must be HH:MM'),
    body('recurrence_days')
      .optional()
      .isArray()
      .withMessage('recurrence_days must be an array of weekday numbers (0-6)'),
    body('type')
      .optional()
      .isIn(['prescription', 'appointment', 'break', 'exercise', 'hydration', 'therapy', 'custom']),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    try {
      const result = await reminder.createReminder(req.user.id, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/reminders
router.get('/', async (req, res, next) => {
  try {
    const activeOnly = req.query.all !== 'true';
    const result = await reminder.getReminders(req.user.id, { activeOnly });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/reminders/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const allowed = ['title', 'description', 'scheduled_at', 'recurrence_time', 'recurrence_days', 'is_active', 'type'];
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );
    if (Object.keys(updates).length === 0) {
      return res.status(422).json({ error: 'No valid fields to update' });
    }
    const result = await reminder.updateReminder(req.user.id, req.params.id, updates);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/reminders/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const result = await reminder.deleteReminder(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
