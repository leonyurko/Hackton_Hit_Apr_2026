const { Router } = require('express');
const { body, query, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const mind = require('../services/mindService');

const router = Router();
router.use(authenticate);

// POST /api/mind/checkin
router.post(
  '/checkin',
  [body('text').notEmpty().withMessage('text is required'), body('language').optional().isIn(['he', 'en'])],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    try {
      const result = await mind.analyzeMood(req.user.id, req.body.text, req.body.language || 'he');
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/mind/checkin/history
router.get('/checkin/history', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 14;
    const result = await mind.getMoodHistory(req.user.id, { page, limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/mind/coping/toolkit
router.get('/coping/toolkit', async (req, res, next) => {
  try {
    const result = await mind.getCopingToolkit(req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/mind/coping/complete
router.post(
  '/coping/complete',
  [body('type').notEmpty().withMessage('type is required')],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    try {
      const result = await mind.completeCopingSession(req.user.id, req.body.type);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
