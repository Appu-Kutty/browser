/**
 * Popup/sidebar: proxy chat SSE through the service worker (no fetch from UI).
 */

export function connectChatStream(backendUrl, body, handlers) {
  const port = chrome.runtime.connect({ name: 'ai-chat-stream' });

  const cancel = () => {
    try {
      port.postMessage({ type: 'CANCEL' });
    } catch (e) {
      console.error('[AI stream client] cancel', e);
    }
  };

  const promise = new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      console.log('[AI stream client] stream finished');
      resolve();
    };

    const onMsg = (msg) => {
      if (msg.type === 'meta') {
        console.log('[AI stream client] meta', msg.meta);
        handlers.onMeta?.(msg.meta);
      } else if (msg.type === 'delta') {
        handlers.onDelta?.(msg.delta);
      } else if (msg.type === 'done') {
        console.log('[AI stream client] done');
        handlers.onDone?.(msg.payload);
        finish();
      } else if (msg.type === 'error') {
        console.error('[AI stream client] error from worker', msg.message, msg.kind);
        handlers.onError?.({
          error: true,
          message: msg.message || 'Error',
          kind: msg.kind || 'api'
        });
        finish();
      }
    };

    port.onMessage.addListener(onMsg);
    port.onDisconnect.addListener(() => {
      if (chrome.runtime.lastError) {
        console.warn('[AI stream client] port disconnect', chrome.runtime.lastError.message);
      }
      finish();
    });
    console.log('[AI stream client] START', backendUrl);
    port.postMessage({ type: 'START', backendUrl, body });
  });

  return { promise, cancel };
}
