const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const link = require('../services/linkService');

const router = Router();
router.use(authenticate);

// POST /api/link/peer/match
router.post('/peer/match', async (req, res, next) => {
  try {
    const result = await link.matchPeerGroup(req.user.id);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/link/peer/my-group
router.get('/peer/my-group', async (req, res, next) => {
  try {
    const result = await link.getMyPeerGroup(req.user.id);
    if (!result) return res.status(404).json({ message: 'No peer group yet. POST /peer/match to get matched.' });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/link/buddy/match
router.post('/buddy/match', async (req, res, next) => {
  try {
    const result = await link.matchBuddy(req.user.id);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/link/buddy/mine
router.get('/buddy/mine', async (req, res, next) => {
  try {
    const result = await link.getMyBuddy(req.user.id);
    if (!result) return res.status(404).json({ message: 'No buddy match yet. POST /buddy/match to get matched.' });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/link/activities
router.get('/activities', async (req, res, next) => {
  try {
    const result = await link.getActivities(req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/link/community
router.get('/community', async (req, res, next) => {
  try {
    const result = await link.getCommunityFeed();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
