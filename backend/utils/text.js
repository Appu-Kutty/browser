/**
 * Normalize whitespace and cap length for LLM context.
 * @param {string} raw
 * @param {number} maxChars
 */
function cleanPageContent(raw, maxChars = 2000) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

module.exports = { cleanPageContent };
