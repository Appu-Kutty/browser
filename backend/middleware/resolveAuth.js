const jwt = require('jsonwebtoken');
const User = require('../models/User');

function looksLikeJwt(s) {
  return typeof s === 'string' && s.split('.').length === 3;
}

/**
 * Allows signed-in users (JWT) or guests (no / invalid JWT + optional X-Guest-Session).
 * Sets req.auth = { type, user?, userId?, isGuest, guestSessionId }
 */
module.exports = async function resolveAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  const guestSession = String(req.headers['x-guest-session'] || '').trim();

  if (bearer && looksLikeJwt(bearer)) {
    try {
      const payload = jwt.verify(bearer, process.env.JWT_SECRET);
      const user = await User.findById(payload.sub);
      if (user) {
        req.auth = {
          type: 'user',
          user,
          userId: user._id,
          isGuest: false,
          guestSessionId: null
        };
        return next();
      }
    } catch (e) {
      console.warn('[resolveAuth] JWT invalid', e.message);
    }
  }

  req.auth = {
    type: 'guest',
    id: guestSession || 'anonymous',
    isGuest: true,
    user: null,
    userId: null,
    guestSessionId: guestSession || null
  };
  next();
};
