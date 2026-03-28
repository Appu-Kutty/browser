// Basic i18n dictionary. Extend as needed.
export const LANGUAGES = {
    auto: { label: 'Auto (detect)', speechCode: 'en-US' },
    en: { label: 'English', speechCode: 'en-US' },
    ta: { label: 'Tamil', speechCode: 'ta-IN' },
    hi: { label: 'Hindi', speechCode: 'hi-IN' },
    es: { label: 'Español', speechCode: 'es-ES' },
    fr: { label: 'Français', speechCode: 'fr-FR' },
    de: { label: 'Deutsch', speechCode: 'de-DE' },
    zh: { label: '中文', speechCode: 'zh-CN' },
    ja: { label: '日本語', speechCode: 'ja-JP' },
    ar: { label: 'العربية', speechCode: 'ar-SA' },
    pt: { label: 'Português', speechCode: 'pt-BR' },
    ru: { label: 'Русский', speechCode: 'ru-RU' },
    ko: { label: '한국어', speechCode: 'ko-KR' }
  };
  
  export const STRINGS = {
    headerTitle: {
      en: 'AI Page Assistant',
      ta: 'ஏஐ பக்க உதவியாளர்',
      hi: 'एआई पेज असिस्टेंट',
      es: 'Asistente de Página IA',
      fr: 'Assistant de Page IA',
      de: 'KI-Seitenassistent',
      zh: 'AI 页面助手',
      ja: 'AIページアシスタント',
      ar: 'مساعد صفحة الذكاء الاصطناعي',
      pt: 'Assistente de Página IA',
      ru: 'AI помощник страницы',
      ko: 'AI 페이지 도우미'
    },
    inputPlaceholder: {
      en: 'Ask about this page...',
      ta: 'இந்த பக்கம் குறித்து கேளுங்கள்...',
      hi: 'इस पेज के बारे में पूछें...',
      es: 'Pregunta sobre esta página...',
      fr: 'Demandez à propos de cette page...',
      de: 'Frage zu dieser Seite...',
      zh: '询问此页面相关内容...',
      ja: 'このページについて質問...',
      ar: 'اسأل عن هذه الصفحة...',
      pt: 'Pergunte sobre esta página...',
      ru: 'Спросите об этой странице...',
      ko: '이 페이지에 대해 질문하세요...'
    },
    send: {
      en: 'Send',
      ta: 'அனுப்பு',
      hi: 'भेजें',
      es: 'Enviar',
      fr: 'Envoyer',
      de: 'Senden',
      zh: '发送',
      ja: '送信',
      ar: 'إرسال',
      pt: 'Enviar',
      ru: 'Отправить',
      ko: '보내기'
    },
    clearChat: {
      en: 'Clear',
      ta: 'அழிக்க',
      hi: 'साफ़ करें',
      es: 'Limpiar',
      fr: 'Effacer',
      de: 'Löschen',
      zh: '清除',
      ja: 'クリア',
      ar: 'مسح',
      pt: 'Limpar',
      ru: 'Очистить',
      ko: '지우기'
    },
    regenerate: {
      en: 'Regenerate',
      ta: 'மீண்டும் உருவாக்க',
      hi: 'पुनः जनरेट करें',
      es: 'Regenerar',
      fr: 'Régénérer',
      de: 'Neu generieren',
      zh: '重新生成',
      ja: '再生成',
      ar: 'إعادة الإنشاء',
      pt: 'Regenerar',
      ru: 'Пересоздать',
      ko: '다시 생성'
    },
    copy: {
      en: 'Copy',
      ta: 'நகல் எடு',
      hi: 'कॉपी',
      es: 'Copiar',
      fr: 'Copier',
      de: 'Kopieren',
      zh: '复制',
      ja: 'コピー',
      ar: 'نسخ',
      pt: 'Copiar',
      ru: 'Копировать',
      ko: '복사'
    },
    summarizeButton: {
      en: 'Summarize',
      ta: 'சுருக்கு',
      hi: 'सारांश',
      es: 'Resumir',
      fr: 'Résumer',
      de: 'Zusammenfassen',
      zh: '总结',
      ja: '要約',
      ar: 'تلخيص',
      pt: 'Resumir',
      ru: 'Кратко',
      ko: '요약'
    },
    explainButton: {
      en: 'Explain selection',
      ta: 'தேர்வை விளக்கு',
      hi: 'चयन समझाएं',
      es: 'Explicar selección',
      fr: 'Expliquer la sélection',
      de: 'Auswahl erklären',
      zh: '解释所选',
      ja: '選択を説明',
      ar: 'شرح التحديد',
      pt: 'Explicar seleção',
      ru: 'Объяснить выбор',
      ko: '선택 설명'
    },
    summarizePrompt: {
      en: 'Summarize this page in a short TL;DR and 5 bullet key points.'
    },
    explainSelectionPrompt: {
      en: 'Explain the following selection in the context of this page:'
    },
    selectTextFirst: {
      en: 'Highlight some text on the page first, then try again.'
    }
  };
  
  export function t(key, lang = 'en') {
    const entry = STRINGS[key] || {};
    const resolved = lang === 'auto' ? 'en' : lang;
    return entry[resolved] || entry['en'] || key;
  }

  /** BCP-47-ish code for SpeechRecognition / speechSynthesis */
  export function speechLangCode(lang) {
    if (!lang || lang === 'auto') return 'en-US';
    return LANGUAGES[lang]?.speechCode || 'en-US';
  }