import { LANGUAGES, t, speechLangCode } from './i18n.js';
import {
  abortVoiceInput,
  isVoiceInputActive,
  startVoiceInput
} from './speechRecognition.js';
import { streamChatAsk } from './chatStream.js';
import { getAuthHeaders, AUTH_KEYS } from './authApi.js';
import { BASE_URL } from './apiConfig.js';
import { fetchChatNonStream } from './chatApi.js';

const STORAGE_KEYS = {
  TOKEN: 'authToken',
  THEME: 'theme',
  LANGUAGE: 'language',
  MODE: 'uiMode',
  USER_TYPE: AUTH_KEYS.USER_TYPE,
  SESSION_ID: AUTH_KEYS.SESSION_ID
};

let state = {
  token: null,
  userType: null,
  sessionId: null,
  language: 'en',
  theme: 'glass',
  uiMode: 'sidebar',
  messages: [],
  isStreaming: false,
  lastQuestion: null
};

let rootEl;
let messagesEl;
let textareaEl;
let sendBtnEl;
let micBtnEl;
let clearBtnEl;
let regenBtnEl;
let languageSelectEl;
let themeSelectEl;
let modeBubbleBtn;
let modeSidebarBtn;
let summarizeBtnEl;
let explainBtnEl;

function getInitialTheme() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [
        STORAGE_KEYS.THEME,
        STORAGE_KEYS.LANGUAGE,
        STORAGE_KEYS.MODE,
        STORAGE_KEYS.TOKEN,
        STORAGE_KEYS.USER_TYPE,
        STORAGE_KEYS.SESSION_ID
      ],
      (data) => {
        state.theme = data[STORAGE_KEYS.THEME] || 'glass';
        state.language = data[STORAGE_KEYS.LANGUAGE] || 'en';
        state.uiMode = data[STORAGE_KEYS.MODE] || 'sidebar';
        state.token = data[STORAGE_KEYS.TOKEN] || null;
        state.userType = data[STORAGE_KEYS.USER_TYPE] || null;
        state.sessionId = data[STORAGE_KEYS.SESSION_ID] || null;
        resolve();
      }
    );
  });
}

function setThemeClass() {
  rootEl.classList.remove('theme-light', 'theme-dark', 'theme-glass');
  const theme = state.theme === 'system'
    ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light')
    : state.theme;
  rootEl.classList.add(`theme-${theme}`);
}

function renderShell() {
  rootEl.innerHTML = `
    <div class="ai-panel ${state.uiMode === 'sidebar' ? 'sidebar-mode' : ''}">
      <div class="ai-header">
        <div class="ai-header-left">
          <div class="ai-logo"></div>
          <div>
            <div class="ai-title" id="ai-title"></div>
            <div style="font-size: 10px; opacity: 0.8;">Current page only · Secure</div>
          </div>
        </div>
        <div class="ai-header-right">
          <select id="ai-language" class="ai-select"></select>
          <select id="ai-theme" class="ai-select">
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="glass">Glass</option>
            <option value="system">System</option>
          </select>
          <div class="ai-mode-toggle">
            <button id="mode-bubble">Bubble</button>
            <button id="mode-sidebar">Sidebar</button>
          </div>
        </div>
      </div>
      <div id="ai-messages" class="ai-messages"></div>
      <div class="ai-footer-row">
        <div>
          <button id="ai-clear-btn"></button>
          <button id="ai-regen-btn"></button>
          <button id="ai-summarize" type="button"></button>
          <button id="ai-explain" type="button"></button>
        </div>
        <div>Voice · Copy · Streaming</div>
      </div>
      <div class="ai-input-row">
        <textarea id="ai-input" class="ai-textarea" rows="1" placeholder=""></textarea>
        <button id="ai-mic" class="ai-action-btn" title="Voice input">
          🎙
        </button>
        <button id="ai-send" class="ai-action-btn" title="Send">
          ➤
        </button>
      </div>
    </div>
  `;

  messagesEl = document.getElementById('ai-messages');
  textareaEl = document.getElementById('ai-input');
  sendBtnEl = document.getElementById('ai-send');
  micBtnEl = document.getElementById('ai-mic');
  clearBtnEl = document.getElementById('ai-clear-btn');
  regenBtnEl = document.getElementById('ai-regen-btn');
  languageSelectEl = document.getElementById('ai-language');
  themeSelectEl = document.getElementById('ai-theme');
  modeBubbleBtn = document.getElementById('mode-bubble');
  modeSidebarBtn = document.getElementById('mode-sidebar');
  summarizeBtnEl = document.getElementById('ai-summarize');
  explainBtnEl = document.getElementById('ai-explain');

  // Populate language select
  Object.entries(LANGUAGES).forEach(([code, { label }]) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = label;
    languageSelectEl.appendChild(opt);
  });

  document.getElementById('ai-title').textContent = t('headerTitle', state.language);
  textareaEl.placeholder = t('inputPlaceholder', state.language);
  clearBtnEl.textContent = t('clearChat', state.language);
  regenBtnEl.textContent = t('regenerate', state.language);
  summarizeBtnEl.textContent = t('summarizeButton', state.language);
  explainBtnEl.textContent = t('explainButton', state.language);

  languageSelectEl.value = state.language;
  themeSelectEl.value = state.theme;
  modeBubbleBtn.classList.toggle('active', state.uiMode === 'bubble');
  modeSidebarBtn.classList.toggle('active', state.uiMode === 'sidebar');

  bindEvents();
  setThemeClass();
  renderMessages();
}

function bindEvents() {
  textareaEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  });

  sendBtnEl.addEventListener('click', onSend);
  clearBtnEl.addEventListener('click', onClearChat);
  regenBtnEl.addEventListener('click', onRegenerate);
  languageSelectEl.addEventListener('change', onLanguageChange);
  themeSelectEl.addEventListener('change', onThemeChange);
  modeBubbleBtn.addEventListener('click', () => changeMode('bubble'));
  modeSidebarBtn.addEventListener('click', () => changeMode('sidebar'));
  micBtnEl.addEventListener('click', onMicClick);
  summarizeBtnEl.addEventListener('click', onSummarizePage);
  explainBtnEl.addEventListener('click', onExplainSelection);
}

function changeMode(mode) {
  state.uiMode = mode;
  chrome.storage.local.set({ [STORAGE_KEYS.MODE]: mode });
  modeBubbleBtn.classList.toggle('active', mode === 'bubble');
  modeSidebarBtn.classList.toggle('active', mode === 'sidebar');
  const panel = rootEl.querySelector('.ai-panel');
  panel.classList.toggle('sidebar-mode', mode === 'sidebar');
}

// --- Chat rendering ---
function renderMessages() {
  messagesEl.innerHTML = '';
  state.messages.forEach((msg) => {
    const bubble = document.createElement('div');
    if (msg.role === 'assistant' && msg.thinking && !(msg.content || '').trim()) {
      bubble.className = 'ai-message assistant ai-message--typing';
      bubble.innerHTML =
        '<span class="typing-dots"><span></span><span></span><span></span></span>';
    } else {
      bubble.className = `ai-message ${msg.role}`;
      bubble.textContent = msg.content;
    }
    messagesEl.appendChild(bubble);

    if (msg.role === 'assistant' && !msg.thinking) {
      const controls = document.createElement('div');
      controls.style.fontSize = '10px';
      controls.style.marginTop = '4px';
      controls.style.opacity = '0.8';

      if (msg.source) {
        const src = document.createElement('span');
        src.style.marginRight = '6px';
        src.textContent =
          msg.source === 'page'
            ? '· page '
            : msg.source === 'general'
              ? '· general '
              : msg.source === 'error'
                ? '· error '
                : '';
        controls.appendChild(src);
      }

      const copyBtn = document.createElement('button');
      copyBtn.textContent = t('copy', state.language);
      copyBtn.style.border = 'none';
      copyBtn.style.background = 'transparent';
      copyBtn.style.cursor = 'pointer';
      copyBtn.addEventListener('click', () => copyToClipboard(msg.content));

      const ttsBtn = document.createElement('button');
      ttsBtn.textContent = '🔊';
      ttsBtn.style.border = 'none';
      ttsBtn.style.background = 'transparent';
      ttsBtn.style.cursor = 'pointer';
      ttsBtn.style.marginLeft = '6px';
      ttsBtn.addEventListener('click', () => speak(msg.content));

      controls.appendChild(copyBtn);
      controls.appendChild(ttsBtn);
      messagesEl.appendChild(controls);
    }
  });

  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
}

// --- Actions ---
async function ensureAuthHeaders() {
  const h = await getAuthHeaders();
  if (!h.Authorization && !h['X-Guest-Session']) {
    alert('Open the extension popup and sign in or continue as guest.');
    throw new Error('Not authenticated');
  }
  return h;
}

async function onSend() {
  const text = textareaEl.value.trim();
  if (!text || state.isStreaming) return;

  state.lastQuestion = text;
  textareaEl.value = '';
  state.messages.push({ role: 'user', content: text });
  renderMessages();

  await runChatBackend(text);
}

async function onRegenerate() {
  if (!state.lastQuestion || state.isStreaming) return;
  if (state.messages.length > 0 && state.messages[state.messages.length - 1].role === 'assistant') {
    state.messages.pop();
    renderMessages();
  }
  await runChatBackend(state.lastQuestion, { skipUserPush: true });
}

async function onSummarizePage() {
  if (state.isStreaming) return;
  const q = t('summarizePrompt', state.language);
  state.lastQuestion = q;
  state.messages.push({ role: 'user', content: q });
  renderMessages();
  await runChatBackend(q, { skipUserPush: true });
}

async function onExplainSelection() {
  if (state.isStreaming) return;
  const tab = await new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
  });
  if (!tab?.id) return;
  const sel = await getSelectionText(tab.id);
  if (!sel) {
    alert(t('selectTextFirst', state.language));
    return;
  }
  const q = `${t('explainSelectionPrompt', state.language)}\n\n${sel}`;
  state.lastQuestion = q;
  state.messages.push({ role: 'user', content: q });
  renderMessages();
  await runChatBackend(q, { skipUserPush: true });
}

function onClearChat() {
  state.messages = [];
  state.lastQuestion = null;
  renderMessages();
}

function onLanguageChange() {
  state.language = languageSelectEl.value;
  chrome.storage.local.set({ [STORAGE_KEYS.LANGUAGE]: state.language });
  // re-translate UI labels
  document.getElementById('ai-title').textContent = t('headerTitle', state.language);
  textareaEl.placeholder = t('inputPlaceholder', state.language);
  clearBtnEl.textContent = t('clearChat', state.language);
  regenBtnEl.textContent = t('regenerate', state.language);
  summarizeBtnEl.textContent = t('summarizeButton', state.language);
  explainBtnEl.textContent = t('explainButton', state.language);
}

function onThemeChange() {
  state.theme = themeSelectEl.value;
  chrome.storage.local.set({ [STORAGE_KEYS.THEME]: state.theme });
  setThemeClass();
}

// --- Voice ---
function onMicClick() {
  if (isVoiceInputActive()) {
    abortVoiceInput();
    return;
  }
  startVoiceInput({
    lang: speechLangCode(state.language),
    inputEl: textareaEl,
    onListeningChange: (on) => {
      micBtnEl?.classList.toggle('ai-mic--listening', on);
      micBtnEl?.setAttribute('aria-pressed', on ? 'true' : 'false');
    },
    notifyUser: (msg) => {
      console.error('[voice]', msg);
      alert(msg);
    },
    onAutoSend: async () => {
      if (state.isStreaming) return;
      await onSend();
    }
  });
}

function speak(text) {
  if (!window.speechSynthesis) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = speechLangCode(state.language);

  const voices = window.speechSynthesis.getVoices();
  const match = voices.find((v) => v.lang && v.lang.startsWith(utter.lang));
  if (match) utter.voice = match;
  window.speechSynthesis.speak(utter);
}

function copyToClipboard(text) {
  navigator.clipboard?.writeText(text).catch((e) => console.error(e));
}

/** Get page content - tries content script first, then injects via scripting API. */
async function getPageContent(tabId, tabUrl) {
  const url = tabUrl || '';
  const isInjectable = url.startsWith('http://') || url.startsWith('https://');
  if (!isInjectable) {
    return { error: 'Open a regular webpage (http or https) and try again.' };
  }

  const fromContent = await new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_CONTENT' }, (res) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(res);
    });
  });

  if (fromContent && !fromContent.error) return fromContent;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        try {
          const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
              acceptNode(node) {
                if (!node.parentElement) return NodeFilter.FILTER_REJECT;
                const style = window.getComputedStyle(node.parentElement);
                if (style && (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0'))
                  return NodeFilter.FILTER_REJECT;
                return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
              }
            }
          );
          const parts = [];
          let n;
          while ((n = walker.nextNode())) {
            parts.push(n.textContent.trim());
            if (parts.length > 2000) break;
          }
          return { url: window.location.href, domain: window.location.hostname, pageContent: parts.join(' ') };
        } catch (e) {
          return { error: 'Failed to extract page content' };
        }
      }
    });
    if (results?.[0]?.result) return results[0].result;
    return { error: 'Could not read page. Try refreshing.' };
  } catch (e) {
    return { error: 'Cannot access this page. Open a regular website and try again.' };
  }
}

function tabFallbackPage(tab) {
  let domain = 'unknown';
  try {
    domain = new URL(tab.url || '').hostname || domain;
  } catch {
    /* ignore */
  }
  return {
    url: tab.url || 'https://example.com/',
    domain,
    pageContent: ''
  };
}

async function getSelectionText(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'GET_SELECTION' }, (res) => {
      if (chrome.runtime.lastError) resolve('');
      else resolve((res && res.text) || '');
    });
  });
}

async function runChatBackend(question, { skipUserPush = false } = {}) {
  try {
    const authHeaders = await ensureAuthHeaders();

    const tab = await new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
    });

    if (!tab || !tab.id) throw new Error('No active tab');

    let pageData = await getPageContent(tab.id, tab.url);
    if (!pageData || pageData.error) {
      pageData = tabFallbackPage(tab);
    } else {
      pageData = {
        url: pageData.url,
        domain: pageData.domain,
        pageContent: pageData.pageContent || ''
      };
    }

    const selectionText = await getSelectionText(tab.id);

    const chatBody = {
      url: pageData.url,
      domain: pageData.domain,
      pageContent: pageData.pageContent,
      selectionText,
      question,
      language: state.language
    };

    state.isStreaming = true;
    sendBtnEl.classList.add('disabled');

    const msg = {
      role: 'assistant',
      content: '',
      source: null,
      thinking: true,
      streaming: true
    };
    state.messages.push(msg);
    renderMessages();

    await streamChatAsk(
      BASE_URL,
      chatBody,
      {
        onMeta: (meta) => {
          if (meta && meta.source) msg.source = meta.source;
          renderMessages();
        },
        onDelta: (delta) => {
          if (msg.thinking) msg.thinking = false;
          msg.content += delta;
          renderMessages();
        },
        onDone: (payload) => {
          if (payload && payload.source) msg.source = payload.source;
          msg.thinking = false;
          msg.streaming = false;
          renderMessages();
        },
        onError: (payload) => {
          console.error('[AI sidebar] stream error', payload);
          msg.thinking = false;
          msg.streaming = false;
          const text =
            typeof payload?.error === 'string'
              ? payload.error
              : payload?.message || 'Something went wrong.';
          msg.content = text;
          msg.source = 'error';
          renderMessages();
        }
      },
      authHeaders
    );

    msg.thinking = false;
    if (msg.streaming) msg.streaming = false;
    renderMessages();

    if (!(msg.content || '').trim()) {
      console.log('[AI sidebar] empty stream — non-stream fallback');
      try {
        const data = await fetchChatNonStream(chatBody, authHeaders);
        msg.content = data.answer || '';
        msg.source = data.source || null;
        renderMessages();
      } catch (e) {
        console.error('[AI sidebar] fallback failed', e);
        msg.content = msg.content || e.message || 'Request failed';
        msg.source = 'error';
        renderMessages();
      }
    }

    try {
      const mainSnippet = (msg.content || '').split('\n')[0].slice(0, 200);
      if (mainSnippet) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'HIGHLIGHT_SNIPPET',
          snippet: mainSnippet
        });
      }
    } catch (e) {
      console.error('Highlight request failed', e);
    }
  } catch (e) {
    console.error(e);
    const last = state.messages[state.messages.length - 1];
    if (last && last.role === 'assistant' && !last.content) {
      state.messages.pop();
    }
    const message =
      e?.message === 'Failed to fetch'
        ? 'The assistant could not reach the server. Please check your internet connection or try again shortly.'
        : e?.message || 'Something went wrong while contacting the assistant. Please try again.';
    state.messages.push({
      role: 'assistant',
      content: message,
      source: 'error'
    });
    renderMessages();
  } finally {
    state.isStreaming = false;
    sendBtnEl.classList.remove('disabled');
  }
}

// --- Bootstrapping ---
(async function init() {
  rootEl = document.getElementById('root');
  await getInitialTheme();
  renderShell();
})();