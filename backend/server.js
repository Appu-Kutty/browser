require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const passport = require('passport');

const connectDB = require('./config/db');
const initPassport = require('./config/passport');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const userRoutes = require('./routes/user');

const app = express();

// Initialize
connectDB().catch((err) => {
  console.error('Mongo connection failed', err);
  // Keep server running so API can return friendly errors instead of crashing
});
initPassport();

// Security
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',')
      : '*',
    credentials: false,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Guest-Session']
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
});
app.use(limiter);


app.get("/", (req, res) => {
  res.send("AI Backend Running ✅");
});

// Body parsing
app.use(express.json({ limit: '1mb' }));

// Logging
app.use(logger);

// Passport
app.use(passport.initialize());

// Routes
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/auth', authRoutes);
app.use('/chat', chatRoutes);
app.use('/user', userRoutes);

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});