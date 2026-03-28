/** Keys aligned with popup.js guest / JWT storage. */
export const AUTH_KEYS = {
  TOKEN: 'authToken',
  USER_TYPE: 'userType',
  SESSION_ID: 'sessionId'
};

/**
 * Headers for /chat/* — JWT or X-Guest-Session (no custom redirect).
 */
export function getAuthHeaders() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [AUTH_KEYS.TOKEN, AUTH_KEYS.USER_TYPE, AUTH_KEYS.SESSION_ID],
      (data) => {
        const h = {};
        if (data[AUTH_KEYS.USER_TYPE] === 'guest' && data[AUTH_KEYS.SESSION_ID]) {
          h['X-Guest-Session'] = data[AUTH_KEYS.SESSION_ID];
        } else if (data[AUTH_KEYS.TOKEN]) {
          h.Authorization = `Bearer ${data[AUTH_KEYS.TOKEN]}`;
        }
        resolve(h);
      }
    );
  });
}
