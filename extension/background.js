import { runChatStreamSSE } from './streamBackground.js';
import { AUTH_KEYS } from './authApi.js';
import { BASE_URL } from './apiConfig.js';

const CONTEXT_MENU_ID = 'ai-ask-selection';

function getAuthHeadersFromStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get([AUTH_KEYS.TOKEN, AUTH_KEYS.USER_TYPE, AUTH_KEYS.SESSION_ID], (data) => {
      const h = {};
      if (data[AUTH_KEYS.USER_TYPE] === 'guest' && data[AUTH_KEYS.SESSION_ID]) {
        h['X-Guest-Session'] = data[AUTH_KEYS.SESSION_ID];
      } else if (data[AUTH_KEYS.TOKEN]) {
        h.Authorization = `Bearer ${data[AUTH_KEYS.TOKEN]}`;
      }
      resolve(h);
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: 'Ask AI',
      contexts: ['selection']
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !info.selectionText) return;
  const text = String(info.selectionText).slice(0, 8000);
  chrome.storage.local.set({ pendingAskSelection: text }, () => {
    try {
      chrome.action.openPopup();
    } catch (_) {
      /* openPopup may fail if no user gesture — selection context usually counts */
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ai-chat-stream') return;

  let abortController = null;

  port.onDisconnect.addListener(() => {
    abortController?.abort();
  });

  port.onMessage.addListener((msg) => {
    if (msg.type === 'CANCEL') {
      abortController?.abort();
      return;
    }

    if (msg.type !== 'START') return;

    const backendUrl = msg.backendUrl || BASE_URL;
    const body = msg.body;
    abortController = new AbortController();

    console.log('[AI bg] START stream', backendUrl, '/chat/ask-stream');

    runChatStreamSSE({
      backendUrl,
      body,
      getAuthHeaders: getAuthHeadersFromStorage,
      signal: abortController.signal,
      onMeta: (meta) => {
        try {
          port.postMessage({ type: 'meta', meta });
        } catch (err) {
          console.error('[AI bg] post meta failed', err);
        }
      },
      onDelta: (delta) => {
        try {
          port.postMessage({ type: 'delta', delta });
        } catch (err) {
          console.error('[AI bg] post delta failed', err);
        }
      },
      onDone: (payload) => {
        console.log('[AI bg] stream done');
        try {
          port.postMessage({ type: 'done', payload });
        } catch (err) {
          console.error('[AI bg] post done failed', err);
        }
      },
      onError: (e) => {
        console.error('[AI bg] stream error', e?.message, e?.kind);
        try {
          port.postMessage({
            type: 'error',
            message: e.message || 'Error',
            kind: e.kind || 'api'
          });
        } catch (err) {
          console.error('[AI bg] post error failed', err);
        }
      }
    }).catch((err) => {
      console.error('[AI bg] runChatStreamSSE threw', err);
      try {
        port.postMessage({
          type: 'error',
          message: err?.message || 'Stream failed',
          kind: 'api'
        });
      } catch (_) {
        /* ignore */
      }
    });
  });
});
