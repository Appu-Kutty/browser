const express = require('express');
const Chat = require('../models/Chat');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /user/profile
router.get('/profile', auth, async (req, res) => {
  const user = req.user;
  res.json({
    id: user._id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt
  });
});

// GET /user/usage
router.get('/usage', auth, async (req, res, next) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const countLast24h = await Chat.countDocuments({
      userId: req.user._id,
      createdAt: { $gte: since }
    });

    const total = await Chat.countDocuments({ userId: req.user._id });

    res.json({
      totalChats: total,
      chatsLast24h: countLast24h
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;