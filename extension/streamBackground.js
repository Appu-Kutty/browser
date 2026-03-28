/**
 * SSE client for POST /chat/ask-stream — used only by the service worker.
 * Retry: one extra attempt on transient network / 5xx before body read, or first connection timeout.
 * Timeout: see STREAM_TIMEOUT_MS (initial HTTP response; Render cold start); body stream has no per-token limit.
 * Cancel: AbortController (merged with caller signal).
 */

/** Initial response timeout (Render cold start can exceed 30s). */
export const STREAM_TIMEOUT_MS = 120_000;
export const MAX_PAGE_CONTENT_CHARS = 48_000;

function normalizeApiErrorPayload(err) {
  if (err && typeof err === 'object') {
    if (err.error === true && err.message) return String(err.message);
    if (typeof err.message === 'string') return err.message;
    if (typeof err.error === 'string') return err.error;
  }
  return 'Request failed';
}

function isRetryableStatus(status) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function parseSseBuffer(buffer, handlers) {
  const { onMeta, onDelta, onDone, onError, shouldAbort } = handlers;
  buffer = buffer.replace(/\r\n/g, '\n');
  let ended = false;
  let sep;
  while ((sep = buffer.indexOf('\n\n')) !== -1) {
    const part = buffer.slice(0, sep);
    buffer = buffer.slice(sep + 2);
    const line = part.split('\n').find((l) => l.startsWith('data: '));
    if (!line) continue;
    let payload;
    try {
      payload = JSON.parse(line.slice(6));
    } catch {
      continue;
    }
    if (shouldAbort?.()) break;
    if (payload.meta) onMeta?.(payload.meta);
    if (payload.delta != null && payload.delta !== '') onDelta?.(payload.delta);
    if (payload.done) {
      ended = true;
      onDone?.(payload);
    }
    if (payload.error) {
      ended = true;
      onError?.({
        error: true,
        message: typeof payload.error === 'string' ? payload.error : 'Streaming error',
        kind: 'api'
      });
    }
  }
  return { buffer, ended };
}

/**
 * @param {object} opts
 * @param {string} opts.backendUrl
 * @param {string} [opts.path]
 * @param {object} opts.body
 * @param {() => Promise<Record<string,string>>} opts.getAuthHeaders
 * @param {AbortSignal} [opts.signal]
 * @param {(meta: object) => void} [opts.onMeta]
 * @param {(delta: string) => void} [opts.onDelta]
 * @param {(payload: object) => void} [opts.onDone]
 * @param {(e: { error: boolean, message: string, kind: string }) => void} [opts.onError]
 */
export async function runChatStreamSSE(opts) {
  const {
    backendUrl,
    path = '/chat/ask-stream',
    body: rawBody,
    getAuthHeaders,
    signal: externalSignal,
    onMeta,
    onDelta,
    onDone,
    onError
  } = opts;

  let body = rawBody;
  if (body.pageContent && typeof body.pageContent === 'string' && body.pageContent.length > MAX_PAGE_CONTENT_CHARS) {
    body = {
      ...body,
      pageContent: `${body.pageContent.slice(0, MAX_PAGE_CONTENT_CHARS)}\n…[truncated]`
    };
  }

  const runAttempt = async (retryIndex) => {
    if (externalSignal?.aborted) {
      onError?.({ error: true, message: 'Cancelled', kind: 'cancel' });
      return;
    }

    const emitDelta = (delta) => {
      onDelta?.(delta);
    };

    const authHeaders = await getAuthHeaders();
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, STREAM_TIMEOUT_MS);

    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    let streamFinished = false;

    const fail = (e) => {
      if (!streamFinished) {
        streamFinished = true;
        onError?.(e);
      }
    };

    try {
      const url = `${backendUrl.replace(/\/$/, '')}${path}`;
      console.log('[AI stream] POST', url, { retryIndex });

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        const msg = normalizeApiErrorPayload(errJson);
        console.error('[AI stream] HTTP error', resp.status, msg);
        if (retryIndex === 0 && (isRetryableStatus(resp.status) || resp.status >= 500)) {
          return runAttempt(1);
        }
        fail({ error: true, message: msg, kind: 'api' });
        return;
      }

      console.log('[AI stream] response ok, reading body…');

      if (!resp.body) {
        fail({ error: true, message: 'Empty response body', kind: 'api' });
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const handlers = {
        onMeta,
        onDelta: emitDelta,
        onDone: (payload) => {
          streamFinished = true;
          onDone?.(payload);
        },
        onError: (e) => {
          streamFinished = true;
          onError?.(e);
        },
        shouldAbort: () => Boolean(externalSignal?.aborted || controller.signal.aborted)
      };

      while (!streamFinished) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          const parsed = parseSseBuffer(buffer, handlers);
          buffer = parsed.buffer;
          if (parsed.ended) break;
          if (!streamFinished) {
            console.warn('[AI stream] stream closed without done event; finalizing');
            streamFinished = true;
            onDone?.({ done: true, source: undefined });
          }
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseBuffer(buffer, handlers);
        buffer = parsed.buffer;
        if (parsed.ended) break;
      }
    } catch (e) {
      clearTimeout(timeoutId);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);

      if (e?.name === 'AbortError') {
        if (externalSignal?.aborted) {
          fail({ error: true, message: 'Cancelled', kind: 'cancel' });
          return;
        }
        if (timedOut && retryIndex === 0) {
          return runAttempt(1);
        }
        if (timedOut) {
          fail({ error: true, message: 'Request timed out', kind: 'timeout' });
          return;
        }
        fail({ error: true, message: 'Request was cancelled', kind: 'cancel' });
        return;
      }

      const isNetwork = e?.name === 'TypeError' || e?.message === 'Failed to fetch';

      if (retryIndex === 0 && isNetwork && !externalSignal?.aborted) {
        return runAttempt(1);
      }

      const netMsg =
        e?.message === 'Failed to fetch'
          ? 'Network error — check your connection'
          : e?.message || 'Network error';
      console.error('[AI stream] catch', e?.name, netMsg);
      fail({ error: true, message: netMsg, kind: 'network' });
    }
  };

  return runAttempt(0);
}
