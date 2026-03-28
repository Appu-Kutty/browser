const express = require('express');
const Joi = require('joi');
const Chat = require('../models/Chat');
const resolveAuth = require('../middleware/resolveAuth');
const guestHourlyLimiter = require('../middleware/guestHourlyLimiter');
const validate = require('../middleware/validate');
const { prepareAsk, generateAnswer, streamTokens } = require('../services/aiService');

const router = express.Router();

const askSchema = {
  schema: Joi.object({
    body: Joi.object({
      url: Joi.string().uri().required(),
      domain: Joi.string().required(),
      pageContent: Joi.string().allow('').default(''),
      selectionText: Joi.string().allow('').optional().max(8000),
      question: Joi.string().min(1).max(2000).required(),
      language: Joi.string()
        .valid('en', 'ta', 'hi', 'es', 'fr', 'de', 'zh', 'ja', 'ar', 'pt', 'ru', 'ko', 'auto')
        .default('en')
    })
  })
};

// POST /chat/ask  (non-streaming)
router.post('/ask', resolveAuth, guestHourlyLimiter, validate(askSchema), async (req, res) => {
  try {
    const { url, domain, pageContent, question, language, selectionText } = req.body;

    const result = await generateAnswer({
      pageContent,
      question,
      language,
      url,
      domain,
      selectionText
    });

    await Chat.create({
      userId: req.auth.type === 'user' ? req.auth.userId : undefined,
      guestSessionId: req.auth.type === 'guest' ? req.auth.guestSessionId : undefined,
      domain,
      url,
      question,
      answer: result.answer,
      language,
      source: result.source
    });

    res.json(result);
  } catch (err) {
    console.error('[chat/ask]', err);
    const msg = err.message || 'Something went wrong';
    const status = err.status || 502;
    res.status(status).json({ error: true, message: msg, source: 'error' });
  }
});

// POST /chat/ask-stream  (SSE streaming)
router.post('/ask-stream', resolveAuth, guestHourlyLimiter, validate(askSchema), async (req, res, next) => {
  try {
    const { url, domain, pageContent, question, language, selectionText } = req.body;

    const { source, modelInput } = await prepareAsk({
      pageContent,
      question,
      language,
      url,
      domain,
      selectionText
    });

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.flushHeaders();

    res.write(`data: ${JSON.stringify({ meta: { source } })}\n\n`);

    let fullAnswer = '';
    let clientGone = false;

    req.on('close', () => {
      clientGone = true;
    });

    (async () => {
      try {
        for await (const chunk of streamTokens(modelInput)) {
          if (clientGone) break;
          fullAnswer += chunk;
          res.write(`data: ${JSON.stringify({ delta: chunk })}\n\n`);
        }

        if (!clientGone) {
          await Chat.create({
            userId: req.auth.type === 'user' ? req.auth.userId : undefined,
            guestSessionId: req.auth.type === 'guest' ? req.auth.guestSessionId : undefined,
            domain,
            url,
            question,
            answer: fullAnswer,
            language,
            source
          });
          res.write(`data: ${JSON.stringify({ done: true, source })}\n\n`);
        }
        res.end();
      } catch (err) {
        console.error('[chat/ask-stream]', err);
        if (!res.writableEnded) {
          res.write(
            `data: ${JSON.stringify({
              error: err.message || 'Streaming error',
              source: 'error'
            })}\n\n`
          );
          res.end();
        }
      }
    })();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
