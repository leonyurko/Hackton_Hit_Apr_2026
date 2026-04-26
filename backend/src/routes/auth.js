const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const supabase = require('../config/supabase');
const { authenticate } = require('../middleware/auth');

const router = Router();

// GET /api/auth/me
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (error) return res.status(404).json({ error: 'Profile not found' });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/profile  — save onboarding data after Supabase signup
router.post(
  '/profile',
  authenticate,
  [
    body('full_name').notEmpty().withMessage('full_name is required'),
    body('injury_type').notEmpty().withMessage('injury_type is required'),
    body('mobility_level').isInt({ min: 1, max: 5 }).withMessage('mobility_level must be 1–5'),
    body('language').optional().isIn(['he', 'en']),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    try {
      const { full_name, injury_type, mobility_level, region, interests, career_goal, language, role } = req.body;

      const { data, error } = await supabase
        .from('profiles')
        .upsert(
          {
            id: req.user.id,
            full_name,
            injury_type,
            mobility_level,
            region,
            interests: interests || [],
            career_goal,
            language: language || 'he',
            role: role || 'soldier',
            onboarded_at: new Date().toISOString(),
          },
          { onConflict: 'id' }
        )
        .select()
        .single();

      if (error) throw error;
      res.status(201).json(data);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
