const { GoogleGenAI } = require('@google/genai');
const { cleanPageContent } = require('../utils/text');
const translation = require('./translationService');

/** Default model for Gemini API (@google/genai uses current REST surface). */
function resolveGeminiModel(envValue) {
  const fallback = 'gemini-2.5-flash';
  const raw = (envValue || fallback).trim();
  const id = raw.replace(/^models\//, '');
  if (id === 'gemini-1.5-flash-latest') return fallback;
  return id || fallback;
}

const GEMINI_MODEL = resolveGeminiModel(process.env.GEMINI_MODEL);
/** Page text cap after cleaning (smaller = faster; env MAX_CONTEXT). */
const _ctx = parseInt(process.env.MAX_CONTEXT || '8000', 10);
const MAX_CONTEXT = Math.min(12000, Math.max(500, Number.isFinite(_ctx) ? _ctx : 8000));

const CHATGPT_STYLE =
  'Respond clearly, concisely, and helpfully like ChatGPT.';
const MIN_PAGE_FOR_CONTEXT = 40;
const MIN_SELECTION = 12;

let genAISingleton = null;

function getGenAI() {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !String(key).trim()) {
    const err = new Error('GEMINI_API_KEY not set');
    err.status = 503;
    throw err;
  }
  if (!genAISingleton) {
    genAISingleton = new GoogleGenAI({ apiKey: String(key).trim() });
  }
  return genAISingleton;
}

function buildGenerateParams(modelInput) {
  return {
    model: GEMINI_MODEL,
    contents: modelInput.userText,
    config: {
      systemInstruction: modelInput.systemInstruction
    }
  };
}

function decideSource(clean, selectionText) {
  const sel = (selectionText || '').trim();
  if (sel.length >= MIN_SELECTION) return 'page';
  if (clean.length >= MIN_PAGE_FOR_CONTEXT) return 'page';
  return 'general';
}

/**
 * Build prompts and metadata for one ask. Used by both JSON and streaming routes.
 */
async function prepareAsk({ pageContent, question, language, url, domain, selectionText }) {
  const clean = cleanPageContent(pageContent || '', MAX_CONTEXT);
  const sel = (selectionText || '').trim();
  const source = decideSource(clean, sel);

  const { questionEn, outputLangCode, detectedLang } =
    await translation.prepareQuestionAndTargetLanguage({
      question,
      language: language || 'en',
      pageContentHint: clean.slice(0, 500)
    });

  const translateAnswer = translation.shouldTranslateAnswer(outputLangCode);

  let systemInstruction;
  let userText;

  if (source === 'page') {
    systemInstruction = [
      CHATGPT_STYLE,
      '',
      'You are an assistant embedded in a browser extension.',
      'Answer using ONLY the provided page content and (if present) the user text selection.',
      'If the answer is not supported by the content, say so clearly.',
      'Be concise and accurate.',
      translateAnswer
        ? 'Write your draft answer in English (it will be localized for the user).'
        : 'Respond in the same language as the user\'s question when possible.'
    ].join('\n');

    userText = [
      `URL: ${url}`,
      `Domain: ${domain}`,
      detectedLang ? `Detected language hint: ${detectedLang}` : '',
      sel ? `USER_SELECTION (prioritize this):\n${sel.slice(0, 4000)}` : '',
      `PAGE_CONTENT:\n${clean}`,
      `QUESTION:\n${questionEn}`
    ]
      .filter(Boolean)
      .join('\n\n');
  } else {
    systemInstruction = [
      CHATGPT_STYLE,
      '',
      'You are a helpful general assistant.',
      'If no page content was provided, answer from general knowledge and briefly note that you are not using live page text.',
      'Be accurate and concise.',
      translateAnswer
        ? 'Write your draft answer in English (it will be localized for the user).'
        : 'Respond in the same language as the user when possible.'
    ].join('\n');

    userText = [
      `URL (context only): ${url}`,
      `Domain: ${domain}`,
      `QUESTION:\n${questionEn}`
    ].join('\n\n');
  }

  const modelInput = {
    systemInstruction,
    userText,
    outputLangCode,
    translateAnswer
  };

  return { source, modelInput };
}

async function runModelText(modelInput) {
  const ai = getGenAI();
  const response = await ai.models.generateContent(buildGenerateParams(modelInput));
  const text = (response.text || '').trim();
  if (!text) {
    throw new Error('Gemini returned an empty response');
  }
  return text;
}

async function generateAnswer(params) {
  try {
    const { source, modelInput } = await prepareAsk(params);
    let text = await runModelText(modelInput);
    if (modelInput.translateAnswer) {
      text = await translation.translateAnswerToUser(text, modelInput.outputLangCode);
    }
    return { answer: text, source };
  } catch (e) {
    console.error('[aiService] generateAnswer', e);
    throw e;
  }
}

/**
 * Stream text deltas for SSE. Caller sends meta/done with source.
 */
async function* streamTokens(modelInput) {
  if (modelInput.translateAnswer) {
    const en = await runModelText(modelInput);
    const translated = await translation.translateAnswerToUser(
      en,
      modelInput.outputLangCode
    );
    const chunkSize = 56;
    for (let i = 0; i < translated.length; i += chunkSize) {
      yield translated.slice(i, i + chunkSize);
    }
    return;
  }

  const ai = getGenAI();
  const stream = await ai.models.generateContentStream(buildGenerateParams(modelInput));

  for await (const chunk of stream) {
    const t = chunk.text || '';
    if (t) yield t;
  }
}

module.exports = {
  prepareAsk,
  generateAnswer,
  streamTokens,
  GEMINI_MODEL
};
