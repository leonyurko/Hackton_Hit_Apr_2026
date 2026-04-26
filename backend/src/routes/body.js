const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const body_ = require('../services/bodyService');

const router = Router();
router.use(authenticate);

// POST /api/body/pain-log
router.post(
  '/pain-log',
  [
    body('painLevel').isInt({ min: 1, max: 10 }).withMessage('painLevel must be 1–10'),
    body('location').notEmpty().withMessage('location is required'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    try {
      const result = await body_.logPain(req.user.id, {
        painLevel: req.body.painLevel,
        location: req.body.location,
        notes: req.body.notes,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/body/wearable
router.post(
  '/wearable',
  [body('source').notEmpty().withMessage('source is required')],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    try {
      const result = await body_.logWearableSnapshot(req.user.id, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/body/workout/today
router.get('/workout/today', async (req, res, next) => {
  try {
    const result = await body_.getTodayWorkout(req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/body/workout/generate  — force-regenerate
router.post('/workout/generate', async (req, res, next) => {
  try {
    const result = await body_.generateWorkoutPlan(req.user.id);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/body/workout/complete
router.post(
  '/workout/complete',
  [body('planId').notEmpty().withMessage('planId is required')],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    try {
      const result = await body_.logWorkoutCompletion(req.user.id, req.body.planId, {
        painAfter: req.body.painAfter,
        energyAfter: req.body.energyAfter,
        notes: req.body.notes,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/body/pt/report
router.get('/pt/report', async (req, res, next) => {
  try {
    // ptUserId is optional — can be supplied as query param
    const result = await body_.generatePTReport(req.user.id, req.query.ptUserId || null);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
