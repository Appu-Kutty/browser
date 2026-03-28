const rateLimit = require('express-rate-limit');

/** ~100 requests/hour per guest session (signed-in users skip). */
module.exports = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const gs = req.auth?.guestSessionId || req.headers['x-guest-session'] || '';
    return gs ? `guest:${gs}` : `ip:${req.ip}`;
  },
  skip: (req) => req.auth?.type === 'user',
  message: { error: 'Guest rate limit reached. Try again later or sign in.' }
});
