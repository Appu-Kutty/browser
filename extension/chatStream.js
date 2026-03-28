/**
 * Back-compat: chat streaming is proxied through the service worker (see streamClient.js).
 * @param {Record<string, string>} _authHeaders — ignored; auth is read in the background script.
 */
import { connectChatStream } from './streamClient.js';

export async function streamChatAsk(backendUrl, body, handlers = {}, _authHeaders = {}) {
  const { promise } = connectChatStream(backendUrl, body, handlers);
  await promise;
}
