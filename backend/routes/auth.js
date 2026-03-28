const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const passport = require('passport');
const User = require('../models/User');
const validate = require('../middleware/validate');

const router = express.Router();

const registerSchema = {
  schema: Joi.object({
    body: Joi.object({
      name: Joi.string().min(2).max(100).required(),
      email: Joi.string().email().required(),
      password: Joi.string().min(8).max(128).required(),
    })
  })
};

const loginSchema = {
  schema: Joi.object({
    body: Joi.object({
      email: Joi.string().email().required(),
      password: Joi.string().min(8).max(128).required(),
    })
  })
};

const googleAccessTokenSchema = {
  schema: Joi.object({
    body: Joi.object({
      accessToken: Joi.string().min(20).required()
    })
  })
};

function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// POST /auth/register
router.post('/register', validate(registerSchema), async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ error: true, message: 'Email already in use' });

    // Use bcryptjs (sync) to avoid native module vulnerabilities
    const hash = bcrypt.hashSync(password, 12);

    const user = await User.create({
      name,
      email,
      passwordHash: hash
    });

    const token = signToken(user);
    return res.status(201).json({
      token,
      user: { id: user._id, name: user.name, email: user.email }
    });
  } catch (err) {
    next(err);
  }
});

// POST /auth/login
router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: true, message: 'Invalid credentials' });
    }

    const ok = bcrypt.compareSync(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: true, message: 'Invalid credentials' });

    const token = signToken(user);
    return res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email }
    });
  } catch (err) {
    next(err);
  }
});

// POST /auth/google-token — verify OAuth2 access token from chrome.identity.getAuthToken
router.post('/google-token', validate(googleAccessTokenSchema), async (req, res) => {
  try {
    const { accessToken } = req.body;
    const profileResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!profileResp.ok) {
      return res.status(401).json({ error: true, message: 'Google rejected access token' });
    }
    const profile = await profileResp.json();
    const sub = profile.sub;
    const email = profile.email;
    const name = profile.name || email || 'Google User';

    if (!sub) {
      return res.status(401).json({ error: true, message: 'Invalid Google token response' });
    }

    let user = await User.findOne({ googleId: sub });
    if (!user && email) {
      user = await User.findOne({ email: email.toLowerCase() });
    }
    if (!user) {
      user = await User.create({
        googleId: sub,
        name,
        email: email ? email.toLowerCase() : `user-${sub}@google.local`
      });
    } else if (!user.googleId) {
      user.googleId = sub;
      await user.save();
    }

    const token = signToken(user);
    return res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email }
    });
  } catch (err) {
    console.error('[auth/google-token]', err.message);
    return res.status(502).json({
      error: true,
      message: 'Could not verify Google token. Sign in again.'
    });
  }
});

// GET /auth/google (legacy web OAuth; optional for server-side flows)
router.get(
  '/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
  })
);

// GET /auth/google/callback
router.get(
  '/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/auth/google/failure' }),
  async (req, res) => {
    try {
      const { user, token } = req.user; // from Strategy's done()
      const redirectBase = process.env.EXTENSION_REDIRECT_URL;
      if (!redirectBase) {
        // Fallback: show token on screen (for debugging only)
        return res.send(`
<!DOCTYPE html>
<html>
  <body>
    <h1>Login successful</h1>
    <p>Copy this token into your extension:</p>
    <textarea style="width:100%;height:120px;">${token}</textarea>
  </body>
</html>
        `);
      }

      // Redirect back to extension with JWT in fragment
      const redirectUrl = `${redirectBase}#token=${encodeURIComponent(token)}`;
      return res.redirect(redirectUrl);
    } catch (err) {
      console.error(err);
      return res.status(500).send('OAuth error');
    }
  }
);

router.get('/google/failure', (req, res) => {
  res.status(401).send('Google authentication failed');
});

module.exports = router;