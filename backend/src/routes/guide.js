const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const guide = require('../services/guideService');

const router = Router();
router.use(authenticate);

// POST /api/guide/chat
router.post(
  '/chat',
  [body('message').notEmpty().withMessage('message is required')],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    try {
      const result = await guide.chat(req.user.id, req.body.message);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/guide/chat/history
router.get('/chat/history', async (req, res, next) => {
  try {
    const result = await guide.getHistory(req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/guide/chat/history
router.delete('/chat/history', async (req, res, next) => {
  try {
    const result = await guide.clearHistory(req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
