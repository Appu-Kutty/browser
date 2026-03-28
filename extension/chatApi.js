import { BASE_URL } from './apiConfig.js';

export function apiErr(data) {
  if (data && data.error === true && data.message) return data.message;
  if (typeof data.error === 'string') return data.error;
  if (typeof data.message === 'string') return data.message;
  return 'Request failed';
}

/** POST /chat/ask — same body shape as /chat/ask-stream. */
export async function fetchChatNonStream(body, authHeaders) {
  const url = `${BASE_URL}/chat/ask`;
  console.log('[AI chatApi] POST', url);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  console.log('[AI chatApi] response', res.status);
  if (!res.ok) {
    throw new Error(apiErr(data));
  }
  return data;
}
