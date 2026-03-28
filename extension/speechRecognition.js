/**
 * Chrome extension–safe Web Speech API helper.
 * Prefer webkitSpeechRecognition (Chrome), then standard SpeechRecognition.
 */

let activeRecognition = null;
/** Bumped on abort/start so stale onend handlers never auto-send. */
let voiceSessionEpoch = 0;

export function getSpeechRecognitionConstructor() {
  if (typeof window === 'undefined') return null;
  return window.webkitSpeechRecognition || window.SpeechRecognition || null;
}

/**
 * Stop any in-flight recognition (e.g. second mic click).
 */
export function abortVoiceInput() {
  if (!activeRecognition) return;
  voiceSessionEpoch++;
  try {
    activeRecognition.abort();
  } catch (e) {
    console.warn('[voice] abort failed', e);
  }
  activeRecognition = null;
}

export function isVoiceInputActive() {
  return activeRecognition != null;
}

/**
 * @typedef {object} StartVoiceInputOptions
 * @property {string} lang - BCP-47 (e.g. en-US)
 * @property {HTMLTextAreaElement|HTMLInputElement|null} [inputEl]
 * @property {(listening: boolean) => void} [onListeningChange]
 * @property {(message: string) => void} [notifyUser] - permission / hard failures
 * @property {() => void|Promise<void>} [onAutoSend] - after a final transcript (onend)
 */

/**
 * Starts listening. Call from a user gesture (button click). Mic button should call this, not .start() directly.
 */
export function startVoiceInput(options) {
  const {
    lang,
    inputEl = null,
    onListeningChange,
    notifyUser,
    onAutoSend
  } = options;

  const Recognition = getSpeechRecognitionConstructor();
  if (!Recognition) {
    const msg =
      'Speech recognition is not available in this context. Use Google Chrome with a current version.';
    console.error('[voice]', msg);
    notifyUser?.(msg);
    return;
  }

  abortVoiceInput();

  const sessionId = ++voiceSessionEpoch;
  const rec = new Recognition();

  rec.continuous = false;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.lang = (lang || 'en-US').trim() || 'en-US';

  let gotFinalTranscript = false;

  rec.onstart = () => {
    console.log('[voice] onstart', { lang: rec.lang });
    onListeningChange?.(true);
  };

  rec.onresult = (event) => {
    let text = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const row = event.results[i];
      if (row.isFinal) {
        text += row[0]?.transcript || '';
      }
    }
    const trimmed = text.trim();
    if (!trimmed) return;
    gotFinalTranscript = true;
    if (inputEl) {
      inputEl.value = trimmed;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.focus();
    }
    console.log('[voice] onresult (final)', { length: trimmed.length });
  };

  rec.onerror = (event) => {
    const code = event.error;
    console.error('[voice] onerror', code, event.message || '');

    if (code === 'not-allowed') {
      notifyUser?.(
        'Microphone is blocked. For this extension: click the tune icon in the address bar (or lock icon) → Site settings → Microphone → Allow. Then try the mic again.'
      );
    } else if (code === 'service-not-allowed') {
      notifyUser?.(
        'Voice recognition is not allowed. Check Chrome Settings → Privacy and security → Site settings → Microphone.'
      );
    } else if (code === 'audio-capture') {
      notifyUser?.(
        'No microphone was found or Chrome could not open it. Check that a mic is connected and not in use by another app.'
      );
    } else if (code === 'network') {
      notifyUser?.(
        'Voice recognition failed (network). Check your connection and try again.'
      );
    } else if (code === 'no-speech') {
      console.warn('[voice] no speech captured');
    } else if (code !== 'aborted') {
      console.warn('[voice] recognition error (no alert)', code);
    }
  };

  rec.onend = () => {
    console.log('[voice] onend', { sessionId, epoch: voiceSessionEpoch, gotFinalTranscript });
    if (sessionId !== voiceSessionEpoch) {
      onListeningChange?.(false);
      return;
    }
    activeRecognition = null;
    onListeningChange?.(false);

    if (!gotFinalTranscript || !onAutoSend) return;
    const text = (inputEl?.value || '').trim();
    if (!text) return;

    queueMicrotask(() => {
      if (sessionId !== voiceSessionEpoch) return;
      Promise.resolve(onAutoSend()).catch((err) => {
        console.error('[voice] onAutoSend failed', err);
      });
    });
  };

  activeRecognition = rec;
  try {
    rec.start();
    console.log('[voice] recognition.start() ok');
  } catch (err) {
    activeRecognition = null;
    voiceSessionEpoch++;
    onListeningChange?.(false);
    console.error('[voice] recognition.start() threw', err);
    notifyUser?.(
      'Could not start the microphone. Wait a moment, close other tabs using the mic, and try again.'
    );
  }
}
