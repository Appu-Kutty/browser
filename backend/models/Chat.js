const mongoose = require('mongoose');

// TTL index: chats auto-delete after 24h (configurable via env if desired)
const chatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  guestSessionId: { type: String, index: true },
  domain: { type: String, index: true },
  url: { type: String },
  question: { type: String },
  answer: { type: String },
  source: { type: String, enum: ['page', 'general', 'error'], default: 'page' },
  language: { type: String, default: 'en' },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 } // 24 hours
});

module.exports = mongoose.model('Chat', chatSchema);