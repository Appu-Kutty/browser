import { LANGUAGES, t, speechLangCode } from './i18n.js';
import {
  abortVoiceInput,
  isVoiceInputActive,
  startVoiceInput
} from './speechRecognition.js';
import { connectChatStream } from './streamClient.js';
import { getAuthHeaders, AUTH_KEYS } from './authApi.js';
import { BASE_URL } from './apiConfig.js';
import { apiErr, fetchChatNonStream } from './chatApi.js';
import { marked } from './node_modules/marked/lib/marked.esm.js';
import DOMPurify from './node_modules/dompurify/dist/purify.es.mjs';

const TOKEN_KEY = 'authToken';
const STORAGE_KEYS = {
  TOKEN: 'authToken',
  THEME: 'theme',
  LANGUAGE: 'language',
  MODE: 'uiMode',
  USER_TYPE: AUTH_KEYS.USER_TYPE,
  SESSION_ID: AUTH_KEYS.SESSION_ID,
  VOICE_AUTOPLAY: 'voiceAutoplay'
};

/** Client-side page text cap (keep payload small for fast TTFB). */
const MAX_CONTEXT_CHARS = 48000;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setupMarked() {
  if (typeof window !== 'undefined' && window.hljs) {
    marked.setOptions({
      gfm: true,
      breaks: true,
      highlight(code, lang) {
        try {
          if (lang && window.hljs.getLanguage(lang)) {
            return window.hljs.highlight(code, { language: lang }).value;
          }
          return window.hljs.highlightAuto(code).value;
        } catch {
          return escapeHtml(code);
        }
      }
    });
  } else {
    marked.setOptions({ gfm: true, breaks: true });
  }
}

function assistantMarkdownHtml(raw) {
  const html = marked.parse(raw || '');
  return DOMPurify.sanitize(html);
}

function renderAssistantContent(msg) {
  if (msg.role !== 'assistant') return escapeHtml(msg.content);
  if (msg.streaming) {
    return `${escapeHtml(msg.content || '').replace(/\n/g, '<br/>')}<span class="stream-cursor" aria-hidden="true">▍</span>`;
  }
  return assistantMarkdownHtml(msg.content);
}

function formatUserMessage(err) {
  if (!err) return 'Something went wrong.';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  const kind = err.kind;
  if (kind === 'timeout') return 'Request timed out. Try again.';
  if (kind === 'network') return 'Network issue — check your connection.';
  if (kind === 'api') return err.message || 'The API returned an error.';
  if (kind === 'cancel') return 'Cancelled.';
  return 'Something went wrong.';
}

/** Clears loading flags if the stream ends without onDone (e.g. port disconnect). */
function finalizeAssistantStreamState(msg) {
  if (!msg || msg.role !== 'assistant') return;
  msg.thinking = false;
  if (msg.streaming) msg.streaming = false;
}

async function tryNonStreamFallback(msg, chatBody, authHeaders) {
  console.log('[AI popup] streaming incomplete — trying non-stream fallback');
  try {
    const data = await fetchChatNonStream(chatBody, authHeaders);
    msg.content = data.answer || '';
    msg.source = data.source || null;
    msg.thinking = false;
    msg.streaming = false;
    renderMessages();
    if ((msg.content || '').trim()) {
      maybeAutoplayAssistant(msg.content);
    }
  } catch (e) {
    console.error('[AI popup] fallback failed', e);
    msg.content = msg.content || formatUserMessage(e);
    msg.source = 'error';
    msg.thinking = false;
    msg.streaming = false;
    renderMessages();
  }
}

// Auth view elements
const authView = document.getElementById('auth-view');
const chatView = document.getElementById('chat-view');
const statusEl = document.getElementById('status');
const nameEl = document.getElementById('name');
const emailEl = document.getElementById('email');
const passEl = document.getElementById('password');
const loginBtn = document.getElementById('login');
const registerBtn = document.getElementById('register');
const googleBtn = document.getElementById('google');
const guestBtn = document.getElementById('guest');
const logoutBtn = document.getElementById('logout');

let state = {
  token: null,
  userType: null,
  sessionId: null,
  language: 'en',
  theme: 'dark',
  uiMode: 'sidebar',
  messages: [],
  isStreaming: false,
  lastQuestion: null,
  voiceAutoplay: false
};

let rootEl,
  messagesEl,
  textareaEl,
  sendBtnEl,
  micBtnEl,
  clearBtnEl,
  regenBtnEl,
  languageSelectEl,
  themeSelectEl;
let voiceToggleEl;
let exportCopyBtnEl;
let exportDownloadBtnEl;
let guestUpgradeBtnEl;

let activeStreamCancel = null;
let renderDebounceTimer = null;

function setStatus(msg, isError = false) {
  if (statusEl) {
    statusEl.textContent = msg;
    statusEl.style.color = isError ? '#b91c1c' : '#059669';
    statusEl.style.background = isError ? '#fee2e2' : '#d1fae5';
  }
}

function saveSignedInToken(token) {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        [TOKEN_KEY]: token,
        [STORAGE_KEYS.USER_TYPE]: 'user',
        [STORAGE_KEYS.SESSION_ID]: null
      },
      resolve
    );
  });
}

function saveGuestSession(sessionId) {
  return new Promise((resolve) => {
    chrome.storage.local.remove([TOKEN_KEY], () => {
      chrome.storage.local.set(
        {
          [STORAGE_KEYS.USER_TYPE]: 'guest',
          [STORAGE_KEYS.SESSION_ID]: sessionId
        },
        resolve
      );
    });
  });
}

function clearAuth() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(
      [TOKEN_KEY, STORAGE_KEYS.USER_TYPE, STORAGE_KEYS.SESSION_ID],
      resolve
    );
  });
}

async function checkAuth() {
  const data = await new Promise((resolve) =>
    chrome.storage.local.get(
      [TOKEN_KEY, STORAGE_KEYS.USER_TYPE, STORAGE_KEYS.SESSION_ID],
      resolve
    )
  );
  if (data[STORAGE_KEYS.USER_TYPE] === 'guest' && data[STORAGE_KEYS.SESSION_ID]) {
    state.userType = 'guest';
    state.sessionId = data[STORAGE_KEYS.SESSION_ID];
    state.token = null;
    showChatView();
  } else if (data[TOKEN_KEY]) {
    state.token = data[TOKEN_KEY];
    state.userType = 'user';
    state.sessionId = null;
    showChatView();
  } else {
    showAuthView();
  }
}

function showAuthView() {
  if (authView) authView.style.display = 'block';
  if (chatView) chatView.classList.remove('active');
}

async function showChatView() {
  if (authView) authView.style.display = 'none';
  if (chatView) chatView.classList.add('active');

  await getInitialTheme();
  renderShell();
}

async function getInitialTheme() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [
        STORAGE_KEYS.THEME,
        STORAGE_KEYS.LANGUAGE,
        STORAGE_KEYS.MODE,
        STORAGE_KEYS.TOKEN,
        STORAGE_KEYS.USER_TYPE,
        STORAGE_KEYS.SESSION_ID,
        STORAGE_KEYS.VOICE_AUTOPLAY
      ],
      (data) => {
        state.theme = data[STORAGE_KEYS.THEME] || 'dark';
        state.language = data[STORAGE_KEYS.LANGUAGE] || 'en';
        state.uiMode = data[STORAGE_KEYS.MODE] || 'sidebar';
        state.token = data[STORAGE_KEYS.TOKEN] || state.token;
        state.userType = data[STORAGE_KEYS.USER_TYPE] || state.userType;
        state.sessionId = data[STORAGE_KEYS.SESSION_ID] || state.sessionId;
        state.voiceAutoplay = Boolean(data[STORAGE_KEYS.VOICE_AUTOPLAY]);
        resolve();
      }
    );
  });
}

function setThemeClass() {
  if (!rootEl) return;
  const chatViewEl = document.getElementById('chat-view');
  if (chatViewEl) {
    chatViewEl.classList.remove('theme-light', 'theme-dark', 'theme-glass');
    const theme =
      state.theme === 'system'
        ? window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : state.theme;
    chatViewEl.classList.add(`theme-${theme}`);
  }
}

function renderShell() {
  rootEl = document.getElementById('root');
  if (!rootEl) return;

  rootEl.innerHTML = `
    <div class="ai-panel-popup">
      <header class="ai-header-popup">
        <div class="ai-header-brand">
          <div class="ai-logo-popup" aria-hidden="true"></div>
          <div class="ai-header-titles">
            <div class="ai-title-row">
              <h1 class="ai-title-popup" id="ai-title">AI Page Assistant</h1>
              <button type="button" id="popup-menu-btn" class="popup-menu-trigger" aria-expanded="false" aria-haspopup="true" aria-label="Menu" title="Menu">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="6" r="1.75"/><circle cx="12" cy="12" r="1.75"/><circle cx="12" cy="18" r="1.75"/></svg>
              </button>
            </div>
            <div id="guest-badge" class="guest-badge" style="display:none;">⚡ Guest</div>
            <div id="guest-subrow" class="guest-subrow" style="display:none;">
              <span class="guest-hint-text">Chats won't be saved</span>
              <button type="button" id="guest-upgrade-signin" class="guest-upgrade-link">Sign in to save</button>
            </div>
          </div>
        </div>
        <div id="popup-menu" class="popup-dropdown" hidden role="menu">
          <label class="popup-dropdown-label" for="ai-language">Language</label>
          <select id="ai-language" class="ai-select-popup"></select>
          <label class="popup-dropdown-label" for="ai-theme">Theme</label>
          <select id="ai-theme" class="ai-select-popup">
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="glass">Glass</option>
            <option value="system">System</option>
          </select>
          <label class="popup-dropdown-row">
            <input type="checkbox" id="voice-autoplay-toggle" />
            <span>Voice replies</span>
          </label>
          <div class="popup-dropdown-divider"></div>
          <button type="button" id="ai-clear-btn" class="popup-menu-item">Clear chat</button>
          <button type="button" id="ai-regen-btn" class="popup-menu-item">Regenerate</button>
          <button type="button" id="export-copy" class="popup-menu-item">Copy chat</button>
          <button type="button" id="export-download" class="popup-menu-item">Download .txt</button>
          <div class="popup-dropdown-divider"></div>
          <button type="button" id="popup-logout" class="popup-menu-item popup-menu-item--danger">Log out</button>
        </div>
      </header>
      <div id="ai-messages" class="ai-messages-popup"></div>
      <footer class="ai-input-dock">
        <div class="ai-input-row-popup">
          <textarea id="ai-input" class="ai-textarea-popup" rows="1" placeholder="Ask about the current page..."></textarea>
          <button type="button" id="ai-mic" class="ai-icon-btn ai-icon-btn--mic" title="Voice input" aria-label="Voice input">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
          </button>
          <button type="button" id="ai-send" class="ai-icon-btn ai-icon-btn--send" title="Send" aria-label="Send">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </footer>
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
  voiceToggleEl = document.getElementById('voice-autoplay-toggle');
  exportCopyBtnEl = document.getElementById('export-copy');
  exportDownloadBtnEl = document.getElementById('export-download');
  guestUpgradeBtnEl = document.getElementById('guest-upgrade-signin');

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

  languageSelectEl.value = state.language;
  themeSelectEl.value = state.theme;
  if (voiceToggleEl) {
    voiceToggleEl.checked = state.voiceAutoplay;
    voiceToggleEl.addEventListener('change', () => {
      state.voiceAutoplay = voiceToggleEl.checked;
      chrome.storage.local.set({ [STORAGE_KEYS.VOICE_AUTOPLAY]: state.voiceAutoplay });
    });
  }

  const badge = document.getElementById('guest-badge');
  const guestSub = document.getElementById('guest-subrow');
  if (guestSub && badge) {
    const isGuest = state.userType === 'guest';
    badge.style.display = isGuest ? 'inline-block' : 'none';
    guestSub.style.display = isGuest ? 'flex' : 'none';
  }

  bindEvents();
  setThemeClass();
  setupMarked();
  renderMessages();

  chrome.storage.local.get(['pendingAskSelection'], (data) => {
    if (data.pendingAskSelection && textareaEl) {
      textareaEl.value = data.pendingAskSelection;
      chrome.storage.local.remove(['pendingAskSelection']);
      textareaEl.focus();
    }
  });

  document.getElementById('popup-logout')?.addEventListener('click', async () => {
    await clearAuth();
    state.token = null;
    state.userType = null;
    state.sessionId = null;
    showAuthView();
  });

  guestUpgradeBtnEl?.addEventListener('click', () => {
    showAuthView();
    setStatus('Sign in to save your chat history.');
  });

  exportCopyBtnEl?.addEventListener('click', () => exportChatCopy());
  exportDownloadBtnEl?.addEventListener('click', () => exportChatDownload());

  setupPopupMenu();
}

function setupPopupMenu() {
  const btn = document.getElementById('popup-menu-btn');
  const panel = document.getElementById('popup-menu');
  if (!btn || !panel) return;

  const close = () => {
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = panel.hidden;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(!open));
  });

  document.addEventListener('click', (e) => {
    if (panel.hidden) return;
    if (btn.contains(e.target) || panel.contains(e.target)) return;
    close();
  });

  panel.addEventListener('click', (e) => e.stopPropagation());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}

function bindEvents() {
  if (!textareaEl || !sendBtnEl || !clearBtnEl || !regenBtnEl || !micBtnEl) {
    console.error('Missing elements:', { textareaEl, sendBtnEl, clearBtnEl, regenBtnEl, micBtnEl });
    return;
  }

  textareaEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  });

  sendBtnEl.addEventListener('click', () => onSend());
  clearBtnEl.addEventListener('click', () => onClearChat());
  regenBtnEl.addEventListener('click', () => onRegenerate());
  languageSelectEl.addEventListener('change', () => onLanguageChange());
  themeSelectEl.addEventListener('change', () => onThemeChange());
  micBtnEl.addEventListener('click', () => onMicClick());
}

function onLanguageChange() {
  state.language = languageSelectEl.value;
  chrome.storage.local.set({ [STORAGE_KEYS.LANGUAGE]: state.language });
  document.getElementById('ai-title').textContent = t('headerTitle', state.language);
  textareaEl.placeholder = t('inputPlaceholder', state.language);
  clearBtnEl.textContent = t('clearChat', state.language);
  regenBtnEl.textContent = t('regenerate', state.language);
}

function onThemeChange() {
  state.theme = themeSelectEl.value;
  chrome.storage.local.set({ [STORAGE_KEYS.THEME]: state.theme });
  setThemeClass();
}

function scheduleScrollMessages() {
  if (!messagesEl) return;
  requestAnimationFrame(() => {
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
  });
}

function scheduleRenderMessages() {
  if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
  renderDebounceTimer = setTimeout(() => {
    renderDebounceTimer = null;
    requestAnimationFrame(() => renderMessages());
  }, 24);
}

function renderMessages() {
  if (!messagesEl) return;
  messagesEl.innerHTML = '';
  state.messages.forEach((msg) => {
    const row = document.createElement('div');
    row.className = `ai-msg-row ai-msg-row--${msg.role}`;

    const bubble = document.createElement('div');
    bubble.className = `ai-bubble ai-bubble--${msg.role}`;

    if (msg.role === 'assistant' && msg.thinking) {
      bubble.classList.add('ai-bubble--thinking');
      bubble.innerHTML =
        '<div class="typing-indicator" aria-live="polite"><span class="typing-dots" aria-hidden="true"><span></span><span></span><span></span></span></div>';
    } else if (msg.role === 'assistant') {
      bubble.innerHTML = renderAssistantContent(msg);
      bubble.querySelectorAll('pre code').forEach((block) => {
        try {
          window.hljs?.highlightElement(block);
        } catch (_) {}
      });
    } else {
      bubble.textContent = msg.content;
    }

    row.appendChild(bubble);

    if (msg.role === 'assistant' && !msg.thinking) {
      const controls = document.createElement('div');
      controls.className = 'ai-message-controls';
      if (msg.source) {
        const src = document.createElement('span');
        src.className = 'ai-source-tag';
        src.textContent =
          msg.source === 'page'
            ? ' · page'
            : msg.source === 'general'
              ? ' · general'
              : msg.source === 'error'
                ? ' · error'
                : '';
        controls.appendChild(src);
      }
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.textContent = t('copy', state.language);
      copyBtn.className = 'ai-control-btn';
      copyBtn.addEventListener('click', () => copyToClipboard(msg.content));

      const ttsBtn = document.createElement('button');
      ttsBtn.type = 'button';
      ttsBtn.textContent = '🔊';
      ttsBtn.className = 'ai-control-btn';
      ttsBtn.title = 'Read aloud';
      ttsBtn.addEventListener('click', () => speak(msg.content));

      controls.appendChild(copyBtn);
      controls.appendChild(ttsBtn);
      row.appendChild(controls);
    }

    messagesEl.appendChild(row);
  });

  scheduleScrollMessages();
}

async function getPageContent(tabId, tabUrl) {
  const url = tabUrl || '';
  const isInjectable = url.startsWith('http://') || url.startsWith('https://');
  if (!isInjectable) {
    return {
      error: 'This page cannot be read. Open a regular webpage (http or https) and try again.'
    };
  }

  const fromContent = await new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_CONTENT' }, (res) => {
      if (chrome.runtime.lastError) {
        resolve(null);
      } else {
        resolve(res);
      }
    });
  });

  if (fromContent && !fromContent.error) {
    return fromContent;
  }

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
                if (style && (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0')) {
                  return NodeFilter.FILTER_REJECT;
                }
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
          return {
            url: window.location.href,
            domain: window.location.hostname,
            pageContent: parts.join(' ')
          };
        } catch (e) {
          return { error: 'Failed to extract page content' };
        }
      }
    });

    if (results && results[0] && results[0].result) {
      return results[0].result;
    }
    return { error: 'Could not read page content. Try refreshing the page.' };
  } catch (e) {
    return {
      error: 'Cannot access this page. Open a regular website (e.g. wikipedia.org) and try again.'
    };
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

function trimContext(text) {
  if (!text || text.length <= MAX_CONTEXT_CHARS) return text;
  return `${text.slice(0, MAX_CONTEXT_CHARS)}\n…[truncated]`;
}

async function getSelectionText(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'GET_SELECTION' }, (res) => {
      if (chrome.runtime.lastError) resolve('');
      else resolve((res && res.text) || '');
    });
  });
}

function maybeAutoplayAssistant(text) {
  if (!state.voiceAutoplay || !text || !window.speechSynthesis) return;
  speak(text);
}

async function runChat(question, { skipUserPush = false } = {}) {
  if (!textareaEl) return;

  const text = question.trim();
  if (!text || state.isStreaming) return;

  const authHeaders = await getAuthHeaders();
  if (!authHeaders.Authorization && !authHeaders['X-Guest-Session']) {
    setStatus('Please sign in or continue as guest.', true);
    return;
  }

  activeStreamCancel?.();
  activeStreamCancel = null;

  try {
    const tabs = await new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, resolve);
    });

    if (!tabs[0] || !tabs[0].id) {
      if (!skipUserPush) {
        state.messages.push({ role: 'user', content: text });
      }
      state.messages.push({
        role: 'assistant',
        content: 'Please navigate to a webpage first, then ask questions about that page.',
        source: 'error'
      });
      renderMessages();
      if (!skipUserPush) textareaEl.value = '';
      return;
    }

    if (!skipUserPush) {
      state.lastQuestion = text;
      textareaEl.value = '';
      state.messages.push({ role: 'user', content: text });
      renderMessages();
    }

    let pageData = await getPageContent(tabs[0].id, tabs[0].url);
    if (!pageData || pageData.error) {
      pageData = tabFallbackPage(tabs[0]);
    } else {
      pageData = {
        url: pageData.url,
        domain: pageData.domain,
        pageContent: trimContext(pageData.pageContent || '')
      };
    }

    const selectionText = await getSelectionText(tabs[0].id);

    const chatBody = {
      url: pageData.url,
      domain: pageData.domain,
      pageContent: pageData.pageContent,
      selectionText,
      question: text,
      language: state.language
    };

    state.isStreaming = true;
    if (sendBtnEl) sendBtnEl.classList.add('disabled');

    const msg = {
      role: 'assistant',
      content: '',
      source: null,
      thinking: true,
      streaming: true
    };
    state.messages.push(msg);
    renderMessages();

    const { promise, cancel } = connectChatStream(
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
          scheduleRenderMessages();
        },
        onDone: (payload) => {
          if (payload && payload.source) msg.source = payload.source;
          msg.streaming = false;
          msg.thinking = false;
          renderMessages();
          if ((msg.content || '').trim()) {
            maybeAutoplayAssistant(msg.content);
          }
        },
        onError: (payload) => {
          console.error('[AI popup] stream onError', payload);
          finalizeAssistantStreamState(msg);
          msg.content = formatUserMessage(payload);
          msg.source = 'error';
          renderMessages();
        }
      }
    );

    activeStreamCancel = cancel;

    await promise;

    finalizeAssistantStreamState(msg);
    renderMessages();
    if (!(msg.content || '').trim()) {
      await tryNonStreamFallback(msg, chatBody, authHeaders);
    }

    try {
      const mainSnippet = (msg.content || '').split('\n')[0].slice(0, 200);
      if (mainSnippet) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'HIGHLIGHT_SNIPPET',
          snippet: mainSnippet
        });
      }
    } catch (e) {
      console.error('Highlight request failed', e);
    }
  } catch (e) {
    console.error('Chat error:', e);
    const last = state.messages[state.messages.length - 1];
    if (last && last.role === 'assistant' && !last.content && last.thinking) {
      state.messages.pop();
    }
    state.messages.push({
      role: 'assistant',
      content: formatUserMessage(e),
      source: 'error'
    });
    renderMessages();
  } finally {
    state.isStreaming = false;
    activeStreamCancel = null;
    if (sendBtnEl) sendBtnEl.classList.remove('disabled');
  }
}

async function onSend() {
  if (!textareaEl) return;
  const text = textareaEl.value.trim();
  if (!text || state.isStreaming) return;
  await runChat(text);
}

async function onRegenerate() {
  if (!state.lastQuestion || state.isStreaming) return;
  if (state.messages.length > 0 && state.messages[state.messages.length - 1].role === 'assistant') {
    state.messages.pop();
    renderMessages();
  }
  await runChat(state.lastQuestion, { skipUserPush: true });
}

function onClearChat() {
  activeStreamCancel?.();
  state.messages = [];
  state.lastQuestion = null;
  renderMessages();
}

function exportChatPlain() {
  return state.messages
    .map((m) => {
      const label = m.role === 'user' ? 'User' : 'Assistant';
      return `${label}: ${m.content || ''}`;
    })
    .join('\n\n');
}

function exportChatCopy() {
  const t = exportChatPlain();
  navigator.clipboard?.writeText(t).catch((e) => console.error(e));
}

function exportChatDownload() {
  const blob = new Blob([exportChatPlain()], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ai-chat-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
}

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

loginBtn.addEventListener('click', async () => {
  try {
    const email = emailEl.value.trim();
    const password = passEl.value;
    if (!email || !password) {
      setStatus('Email and password required', true);
      return;
    }
    const resp = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(apiErr(data));
    await saveSignedInToken(data.token);
    state.token = data.token;
    state.userType = 'user';
    state.sessionId = null;
    setStatus('Logged in successfully!');
    setTimeout(() => showChatView(), 300);
  } catch (e) {
    setStatus(e.message, true);
  }
});

registerBtn.addEventListener('click', async () => {
  try {
    const name = nameEl.value.trim();
    const email = emailEl.value.trim();
    const password = passEl.value;
    if (!name || !email || !password) {
      setStatus('Name, email, password required', true);
      return;
    }
    const resp = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(apiErr(data));
    await saveSignedInToken(data.token);
    state.token = data.token;
    state.userType = 'user';
    state.sessionId = null;
    setStatus('Registered successfully!');
    setTimeout(() => showChatView(), 300);
  } catch (e) {
    setStatus(e.message, true);
  }
});

googleBtn.addEventListener('click', async () => {
  try {
    setStatus('Opening Google…');
    const accessToken = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'Google sign-in cancelled'));
          return;
        }
        if (!token) {
          reject(new Error('No token from Google'));
          return;
        }
        resolve(token);
      });
    });

    const resp = await fetch(`${BASE_URL}/auth/google-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(apiErr(data));
    }

    await new Promise((resolve, reject) => {
      chrome.identity.removeCachedAuthToken({ token: accessToken }, () => {
        if (chrome.runtime.lastError) console.warn(chrome.runtime.lastError);
        resolve();
      });
    });

    await saveSignedInToken(data.token);
    state.token = data.token;
    state.userType = 'user';
    state.sessionId = null;
    setStatus('Signed in with Google!');
    setTimeout(() => showChatView(), 300);
  } catch (e) {
    console.error(e);
    setStatus(e.message || 'Google sign-in failed', true);
  }
});

guestBtn.addEventListener('click', async () => {
  const sessionId = `guest_${crypto.randomUUID().replace(/-/g, '')}`;
  await saveGuestSession(sessionId);
  state.token = null;
  state.userType = 'guest';
  state.sessionId = sessionId;
  setStatus('Continuing as guest');
  setTimeout(() => showChatView(), 200);
});

logoutBtn.addEventListener('click', async () => {
  await clearAuth();
  state.token = null;
  state.userType = null;
  state.sessionId = null;
  showAuthView();
  setStatus('Logged out.');
});

checkAuth();
