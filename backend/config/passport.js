const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');
const User = require('../models/User');

module.exports = () => {
  const {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_CALLBACK_URL,
    JWT_SECRET,
  } = process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL) {
    console.warn('Google OAuth env vars not set; Google login will be disabled.');
    return;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          const name = profile.displayName;

          let user = await User.findOne({ googleId: profile.id });
          if (!user && email) {
            user = await User.findOne({ email });
          }

          if (!user) {
            user = await User.create({
              googleId: profile.id,
              name: name || 'Google User',
              email: email || `user-${profile.id}@example.com`,
            });
          } else if (!user.googleId) {
            user.googleId = profile.id;
            await user.save();
          }

          const token = jwt.sign(
            { sub: user._id.toString(), email: user.email },
            JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
          );

          return done(null, { user, token });
        } catch (err) {
          return done(err);
        }
      }
    )
  );
};