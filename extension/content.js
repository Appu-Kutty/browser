// Injects floating bubble + handles page content extraction for the extension.

(function () {
    const STORAGE_KEYS = {
      MODE: 'uiMode', // 'bubble' | 'sidebar'
      THEME: 'theme', // 'light' | 'dark' | 'glass' | 'system'
      LANGUAGE: 'language'
    };
  
    // --- Extract visible text from the DOM ---
    function extractVisibleText() {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            if (!node.parentElement) return NodeFilter.FILTER_REJECT;
            const style = window.getComputedStyle(node.parentElement);
            if (
              style &&
              (style.visibility === 'hidden' ||
                style.display === 'none' ||
                style.opacity === '0')
            ) {
              return NodeFilter.FILTER_REJECT;
            }
            const text = node.textContent.trim();
            if (!text) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );
      const parts = [];
      let n;
      while ((n = walker.nextNode())) {
        parts.push(n.textContent.trim());
        if (parts.length > 2000) break; // safety limit
      }
      return parts.join(' ');
    }

    // --- Collect anchor tags (visible text + absolute href) for smart navigation ---
    function extractPageLinks() {
      const anchors = document.querySelectorAll('a[href]');
      const seen = new Set();
      const links = [];
      for (const a of anchors) {
        const raw = a.getAttribute('href');
        if (!raw || raw.startsWith('javascript:') || raw === '#') continue;
        let href;
        try {
          href = new URL(raw, window.location.href).href;
        } catch {
          continue;
        }
        const fromText = (a.textContent || '').replace(/\s+/g, ' ').trim();
        const fromAria = (a.getAttribute('aria-label') || '').trim();
        const fromTitle = (a.getAttribute('title') || '').trim();
        const text = fromText || fromAria || fromTitle;
        const key = `${href}\0${text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({ text, href });
      }
      return links;
    }

    // --- Highlight answer text on the page (best-effort) ---
    function highlightAnswer(snippet) {
      if (!snippet || !snippet.trim()) return;
      const text = snippet.trim().slice(0, 200); // keep it short to avoid over-highlighting
      const bodyHtml = document.body.innerHTML;
      const idx = bodyHtml.toLowerCase().indexOf(text.toLowerCase());
      if (idx === -1) return;
      const before = bodyHtml.slice(0, idx);
      const match = bodyHtml.slice(idx, idx + text.length);
      const after = bodyHtml.slice(idx + text.length);
      document.body.innerHTML =
        before +
        '<mark style="background: #facc15; padding: 0 2px; border-radius: 2px;">' +
        match +
        '</mark>' +
        after;
    }
  
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.type === 'GET_PAGE_CONTENT') {
        try {
          const url = window.location.href;
          const { hostname } = window.location;
          const pageContent = extractVisibleText();
          sendResponse({
            url,
            domain: hostname,
            pageContent
          });
        } catch (e) {
          console.error('Error extracting page content', e);
          sendResponse({ error: 'Failed to read page' });
        }
      } else if (msg.type === 'GET_PAGE_LINKS') {
        try {
          const links = extractPageLinks();
          sendResponse({ links });
        } catch (e) {
          console.error('Error extracting page links', e);
          sendResponse({ error: 'Failed to read links', links: [] });
        }
      } else if (msg.type === 'GET_SELECTION') {
        try {
          const sel = window.getSelection && window.getSelection();
          const text = sel ? String(sel.toString()).trim() : '';
          sendResponse({ text });
        } catch (e) {
          sendResponse({ text: '' });
        }
      } else if (msg.type === 'HIGHLIGHT_SNIPPET') {
        try {
          highlightAnswer(msg.snippet);
          sendResponse({ ok: true });
        } catch (e) {
          console.error('Error highlighting snippet', e);
          sendResponse({ ok: false, error: 'Failed to highlight snippet' });
        }
      }
      return true;
    });
  
    // --- Inject floating bubble that opens sidebar.html in overlay iframe ---
    function injectBubble() {
      if (document.getElementById('ai-assistant-bubble')) return;
  
      const bubble = document.createElement('div');
      bubble.id = 'ai-assistant-bubble';
      bubble.className = 'ai-bubble';
      bubble.textContent = 'AI';
  
      // draggable
      let dragging = false;
      let offsetX = 0;
      let offsetY = 0;
      bubble.addEventListener('mousedown', (e) => {
        dragging = true;
        offsetX = e.clientX - bubble.getBoundingClientRect().left;
        offsetY = e.clientY - bubble.getBoundingClientRect().top;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      function onMove(e) {
        if (!dragging) return;
        bubble.style.right = 'unset';
        bubble.style.bottom = 'unset';
        bubble.style.left = e.clientX - offsetX + 'px';
        bubble.style.top = e.clientY - offsetY + 'px';
      }
      function onUp() {
        dragging = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
  
      // click toggles sidebar iframe
      bubble.addEventListener('click', () => {
        toggleSidebar();
      });
  
      document.documentElement.appendChild(bubble);
    }
  
    function toggleSidebar() {
      const existing = document.getElementById('ai-assistant-sidebar-iframe');
      if (existing) {
        existing.remove();
        return;
      }
      const iframe = document.createElement('iframe');
      iframe.id = 'ai-assistant-sidebar-iframe';
      iframe.src = chrome.runtime.getURL('sidebar.html');
      iframe.style.position = 'fixed';
      iframe.style.top = '0';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '380px';
      iframe.style.maxWidth = '40vw';
      iframe.style.border = 'none';
      iframe.style.zIndex = '2147483647';
      iframe.style.boxShadow = '0 0 45px rgba(15,23,42,0.85)';
      iframe.style.borderRadius = '12px 0 0 12px';
      document.documentElement.appendChild(iframe);
    }
  
    injectBubble();
  })();