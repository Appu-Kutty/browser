const { Translate } = require('@google-cloud/translate').v2;

/** Extension UI language codes → Google Translate target */
const UI_TO_TRANSLATE = {
  en: 'en',
  ta: 'ta',
  hi: 'hi',
  es: 'es',
  fr: 'fr',
  de: 'de',
  zh: 'zh-CN',
  ja: 'ja',
  ar: 'ar',
  pt: 'pt',
  ru: 'ru',
  ko: 'ko'
};

let translateClient = null;
let translateInitTried = false;

function getTranslate() {
  if (translateInitTried) return translateClient;
  translateInitTried = true;
  try {
    translateClient = new Translate();
    return translateClient;
  } catch (e) {
    console.warn('[translation] Google Cloud Translate unavailable:', e.message);
    translateClient = null;
    return null;
  }
}

function resolveTargetLangCode(uiLang) {
  if (!uiLang || uiLang === 'auto') return 'en';
  return UI_TO_TRANSLATE[uiLang] || uiLang;
}

function isEnglishCode(code) {
  return !code || code === 'en' || String(code).toLowerCase().startsWith('en');
}

/**
 * English question for the model + target language code for the user-facing answer.
 */
async function prepareQuestionAndTargetLanguage({ question, language, pageContentHint }) {
  const client = getTranslate();
  const fallback = {
    questionEn: question,
    outputLangCode: language === 'auto' ? 'en' : resolveTargetLangCode(language),
    detectedLang: null
  };

  if (!client) {
    return fallback;
  }

  try {
    if (language === 'auto') {
      const [detections] = await client.detect(question);
      const det = Array.isArray(detections) ? detections[0] : detections;
      const code = det?.language || 'en';
      const [enText] = await client.translate(question, 'en');
      return {
        questionEn: enText,
        outputLangCode: code,
        detectedLang: code
      };
    }

    const target = resolveTargetLangCode(language);
    if (isEnglishCode(target)) {
      const [detections] = await client.detect(question);
      const det = Array.isArray(detections) ? detections[0] : detections;
      const fromLang = det?.language || 'en';
      if (isEnglishCode(fromLang)) {
        return { questionEn: question, outputLangCode: 'en', detectedLang: fromLang };
      }
      const [enText] = await client.translate(question, 'en');
      return { questionEn: enText, outputLangCode: 'en', detectedLang: fromLang };
    }

    const [enText] = await client.translate(question, 'en');
    return { questionEn: enText, outputLangCode: target, detectedLang: null };
  } catch (e) {
    console.error('[translation] prepare failed:', e.message);
    return fallback;
  }
}

async function translateAnswerToUser(answerEn, outputLangCode) {
  if (!answerEn) return answerEn;
  const client = getTranslate();
  if (!client || isEnglishCode(outputLangCode)) {
    return answerEn;
  }
  try {
    const [out] = await client.translate(answerEn, outputLangCode);
    return out;
  } catch (e) {
    console.error('[translation] answer translate failed:', e.message);
    return answerEn;
  }
}

/** True when we should post-process answer through Translation API (English → user language). */
function shouldTranslateAnswer(outputLangCode) {
  return Boolean(getTranslate()) && !isEnglishCode(outputLangCode);
}

function isTranslationAvailable() {
  return Boolean(getTranslate());
}

module.exports = {
  getTranslate,
  prepareQuestionAndTargetLanguage,
  translateAnswerToUser,
  shouldTranslateAnswer,
  isTranslationAvailable,
  resolveTargetLangCode,
  isEnglishCode
};
