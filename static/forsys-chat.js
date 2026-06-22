/**
 * ForsysGPT — Chat Widget
 * Drop-in script: <script src="forsys-chat.js" data-api="https://your-api-url"></script>
 *
 * Config attributes on the <script> tag:
 *   data-api       — required: base URL of the FastAPI backend
 *   data-title     — widget header title (default: "ForsysGPT")
 *   data-greeting  — first message from the bot
 *   data-theme     — "light" (default) | "dark"
 */
(function () {
  "use strict";

  const script = document.currentScript || document.querySelector('script[data-api]');
  const API_BASE = (script && script.getAttribute("data-api")) || "http://localhost:8000";
  const TITLE = (script && script.getAttribute("data-title")) || "ForsysGPT";
  const GREETING =
    (script && script.getAttribute("data-greeting")) ||
    "Hi! I'm ForsysGPT. Ask me anything about our services, solutions, or how we can help your business.";

  const CSS = `
    :root {
      --fc-purple: #6B48FF;
      --fc-teal:   #00B4D8;
      --fc-dark:   #0D0D2B;
      --fc-bg:     #F5F6FF;
      --fc-white:  #ffffff;
      --fc-muted:  #6b7280;
      --fc-border: #e5e7eb;
      --fc-radius: 16px;
      --fc-shadow: 0 8px 32px rgba(107,72,255,0.18);
      --fc-font:   'Inter', 'Segoe UI', system-ui, sans-serif;
    }
    #fc-fab {
      position: fixed; bottom: 24px; right: 24px; z-index: 9999;
      width: 56px; height: 56px; border-radius: 50%;
      background: linear-gradient(135deg, var(--fc-purple), var(--fc-teal));
      border: none; cursor: pointer; box-shadow: var(--fc-shadow);
      display: flex; align-items: center; justify-content: center;
      transition: transform .2s, box-shadow .2s;
    }
    #fc-fab:hover { transform: scale(1.08); box-shadow: 0 12px 40px rgba(107,72,255,0.28); }
    #fc-fab svg { width: 26px; height: 26px; fill: #fff; }
    #fc-fab .fc-close { display: none; }
    #fc-fab.is-open .fc-open  { display: none; }
    #fc-fab.is-open .fc-close { display: block; }

    #fc-panel {
      position: fixed; bottom: 92px; right: 24px; z-index: 9998;
      width: 380px; max-width: calc(100vw - 32px);
      height: 560px; max-height: calc(100vh - 120px);
      background: var(--fc-white); border-radius: var(--fc-radius);
      box-shadow: var(--fc-shadow); display: flex; flex-direction: column;
      font-family: var(--fc-font); overflow: hidden;
      contain: layout style;
      opacity: 0; transform: translateY(16px) scale(.97);
      pointer-events: none; transition: opacity .22s, transform .22s;
    }
    #fc-panel.is-open {
      opacity: 1; transform: translateY(0) scale(1); pointer-events: all;
    }
    #fc-header {
      background: linear-gradient(135deg, var(--fc-purple), var(--fc-teal));
      color: #fff; padding: 16px 18px; display: flex; align-items: center; gap: 10px;
      flex-shrink: 0;
    }
    #fc-header img { width: 32px; border-radius: 50%; padding: 4px; flex-shrink: 0; }
    #fc-header-title { font-size: 15px; font-weight: 600; flex: 1; }
    #fc-header-sub { font-size: 11px; opacity: .8; margin-top: 1px; }
    #fc-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #4ade80; flex-shrink: 0;
      box-shadow: 0 0 0 2px rgba(74,222,128,.3);
      animation: fc-pulse 2s infinite;
    }
    @keyframes fc-pulse {
      0%,100% { box-shadow: 0 0 0 2px rgba(74,222,128,.3); }
      50%      { box-shadow: 0 0 0 5px rgba(74,222,128,.1); }
    }
    #fc-messages {
      flex: 1; overflow-y: auto; padding: 16px;
      display: flex; flex-direction: column; gap: 12px;
      background: var(--fc-bg);
      overscroll-behavior: contain;
    }
    #fc-messages::-webkit-scrollbar { width: 4px; }
    #fc-messages::-webkit-scrollbar-thumb { background: var(--fc-border); border-radius: 4px; }
    #fc-messages::-webkit-scrollbar-track { background: transparent; }

    .fc-msg { display: flex; gap: 8px; max-width: 88%; animation: fc-fadein .2s ease; }
    @keyframes fc-fadein { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform:none; } }
    .fc-msg.user { align-self: flex-end; flex-direction: row-reverse; }
    .fc-msg.bot  { align-self: flex-start; }

    .fc-avatar {
      width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center; font-size: 13px;
    }
    .fc-msg.bot  .fc-avatar { background: #fff; overflow: hidden; padding: 6px; }
    .fc-msg.bot  .fc-avatar img { width: 100%; border-radius: 50%; display: block; }
    .fc-msg.user .fc-avatar { background: var(--fc-dark); color:#fff; }

    .fc-bubble {
      padding: 10px 13px; border-radius: 12px; font-size: 13.5px; line-height: 1.55;
      word-break: break-word;
    }
    .fc-msg.bot  .fc-bubble { background: var(--fc-white); color: var(--fc-dark); border: 1px solid var(--fc-border); border-bottom-left-radius: 4px; }
    .fc-msg.user .fc-bubble { background: var(--fc-purple); color: #fff; border-bottom-right-radius: 4px; }

    .fc-typing { display: flex; align-items: center; gap: 4px; padding: 10px 13px; }
    .fc-typing span {
      width: 6px; height: 6px; border-radius: 50%; background: var(--fc-muted);
      animation: fc-bounce .9s infinite;
    }
    .fc-typing span:nth-child(2) { animation-delay: .15s; }
    .fc-typing span:nth-child(3) { animation-delay: .30s; }
    @keyframes fc-bounce {
      0%,80%,100% { transform: translateY(0); }
      40%          { transform: translateY(-6px); }
    }

    #fc-footer {
      padding: 10px 12px; border-top: 1px solid var(--fc-border);
      display: flex; gap: 8px; align-items: flex-end; background: var(--fc-white);
      flex-shrink: 0;
    }
    #fc-input {
      flex: 1; border: 1.5px solid var(--fc-border); border-radius: 10px;
      padding: 9px 12px; font-size: 13.5px; font-family: var(--fc-font);
      resize: none; outline: none; min-height: 38px; max-height: 100px;
      line-height: 1.4; color: var(--fc-dark); background: var(--fc-bg);
      transition: border-color .15s;
    }
    #fc-input:focus { border-color: var(--fc-purple); }
    #fc-send {
      width: 38px; height: 38px; border-radius: 10px; border: none;
      background: linear-gradient(135deg, var(--fc-purple), var(--fc-teal));
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: opacity .15s;
    }
    #fc-send:disabled { opacity: .5; cursor: default; }
    #fc-send svg { width: 17px; height: 17px; fill: #fff; }
    #fc-powered {
      text-align: center; font-size: 10.5px; color: var(--fc-muted);
      padding: 4px 0 6px; background: var(--fc-white); flex-shrink: 0;
    }
    .fc-sources { display: none; }
    .fc-source-chip { display: none; }
    .fc-bubble h1,.fc-bubble h2,.fc-bubble h3 { font-size: 13.5px; font-weight: 700; margin: 10px 0 4px; }
    .fc-bubble p { margin: 4px 0; }
    .fc-bubble ul,.fc-bubble ol { padding-left: 16px; margin: 4px 0; }
    .fc-bubble li { margin: 2px 0; }
    .fc-bubble strong { font-weight: 600; }
    .fc-bubble hr { border: none; border-top: 1px solid var(--fc-border); margin: 8px 0; }
    .fc-bubble a { color: var(--fc-purple); text-decoration: none; }
  `;

  function injectStyles() {
    const el = document.createElement("style");
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  function buildWidget() {
    // FAB
    const fab = document.createElement("button");
    fab.id = "fc-fab";
    fab.setAttribute("aria-label", "Open ForsysGPT");
    fab.innerHTML = `
      <svg class="fc-open" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/>
      </svg>
      <svg class="fc-close" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M18 6L6 18M6 6l12 12" stroke="#fff" stroke-width="2.5" stroke-linecap="round" fill="none"/>
      </svg>`;

    // Panel
    const panel = document.createElement("div");
    panel.id = "fc-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", TITLE);
    panel.innerHTML = `
      <div id="fc-header">
        <img src="https://www.forsysinc.com/blog/wp-content/uploads/2026/06/Forsys-Logo-thunder-white-yellow-1.png" alt="ForsysGPT">
        <div>
          <div id="fc-header-title">${TITLE}</div>
        </div>
        <div id="fc-dot" title="Online"></div>
      </div>
      <div id="fc-messages" aria-live="polite"></div>
      <div id="fc-footer">
        <textarea id="fc-input" placeholder="Ask me anything about Forsys..." rows="1" aria-label="Message"></textarea>
        <button id="fc-send" aria-label="Send">
          <svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
        </button>
      </div>
      <div id="fc-powered">ForsysGPT &mdash; Ask about services, solutions &amp; more</div>`;

    document.body.appendChild(fab);
    document.body.appendChild(panel);
    return { fab, panel };
  }

  function renderMarkdown(text) {
    return text
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
      .replace(/^# (.+)$/gm,   '<h1>$1</h1>')
      .replace(/^---+$/gm, '<hr>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/((?:^[*-] .+\n?)+)/gm, b => '<ul>' + b.trim().split('\n').map(l => `<li>${l.replace(/^[*-] /, '')}</li>`).join('') + '</ul>')
      .split('\n').map(l => /^<(h[1-3]|ul|ol|li|hr)/.test(l.trim()) || !l.trim() ? l : `<p>${l}</p>`).join('\n');
  }

  function addMessage(container, role, text, sources) {
    const wrap = document.createElement("div");
    wrap.className = `fc-msg ${role}`;

    const avatar = document.createElement("div");
    avatar.className = "fc-avatar";
    if (role === "bot") {
      const img = document.createElement("img");
      img.src = "https://www.forsysinc.com/blog/wp-content/uploads/2026/06/Forsys_cloud.png";
      img.alt = "ForsysGPT";
      avatar.appendChild(img);
    } else {
      avatar.textContent = "U";
    }

    const inner = document.createElement("div");
    inner.style.display = "flex";
    inner.style.flexDirection = "column";
    inner.style.gap = "0";

    const bubble = document.createElement("div");
    bubble.className = "fc-bubble";
    if (role === "bot") {
      bubble.innerHTML = renderMarkdown(text);
    } else {
      bubble.textContent = text;
    }
    inner.appendChild(bubble);

    if (sources && sources.length) {
      const srcEl = document.createElement("div");
      srcEl.className = "fc-sources";
      sources.forEach(s => {
        const chip = document.createElement("span");
        chip.className = "fc-source-chip";
        chip.textContent = s;
        srcEl.appendChild(chip);
      });
      inner.appendChild(srcEl);
    }

    wrap.appendChild(avatar);
    wrap.appendChild(inner);
    container.appendChild(wrap);
    container.scrollTop = container.scrollHeight;
    return wrap;
  }

  function addTyping(container) {
    const wrap = document.createElement("div");
    wrap.className = "fc-msg bot";
    wrap.innerHTML = `<div class="fc-avatar"><img src="https://www.forsysinc.com/blog/wp-content/uploads/2026/06/Forsys_cloud.png" alt="ForsysGPT"></div><div class="fc-bubble fc-typing"><span></span><span></span><span></span></div>`;
    container.appendChild(wrap);
    container.scrollTop = container.scrollHeight;
    return wrap;
  }

  function init() {
    injectStyles();
    const { fab, panel } = buildWidget();

    const messagesEl = panel.querySelector("#fc-messages");
    const inputEl = panel.querySelector("#fc-input");
    const sendBtn = panel.querySelector("#fc-send");

    let isOpen = false;
    let isLoading = false;
    const history = [];

    // Greeting
    addMessage(messagesEl, "bot", GREETING);

    function toggle() {
      isOpen = !isOpen;
      fab.classList.toggle("is-open", isOpen);
      panel.classList.toggle("is-open", isOpen);
      if (isOpen) inputEl.focus();
    }

    fab.addEventListener("click", toggle);

    // Auto-resize textarea
    inputEl.addEventListener("input", () => {
      inputEl.style.height = "auto";
      inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + "px";
    });

    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    sendBtn.addEventListener("click", send);

    async function send() {
      const text = inputEl.value.trim();
      if (!text || isLoading) return;

      inputEl.value = "";
      inputEl.style.height = "auto";
      isLoading = true;
      sendBtn.disabled = true;

      addMessage(messagesEl, "user", text);
      const typingEl = addTyping(messagesEl);

      try {
        const res = await fetch(`${API_BASE}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, history }),
        });

        typingEl.remove();
        if (!res.ok) throw new Error(`Server error ${res.status}`);

        // Backend returns SSE stream — read it chunk by chunk
        const msgWrap = addMessage(messagesEl, "bot", "");
        const bubble  = msgWrap.querySelector(".fc-bubble");
        const inner   = bubble.parentElement;
        let fullText = "";
        let sources  = [];

        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;
            try {
              const evt = JSON.parse(raw);
              if (evt.type === "meta") {
                sources = evt.sources || [];
              } else if (evt.type === "delta") {
                fullText += evt.text;
                bubble.innerHTML = renderMarkdown(fullText);
                messagesEl.scrollTop = messagesEl.scrollHeight;
              } else if (evt.type === "done" && sources.length) {
                const srcEl = document.createElement("div");
                srcEl.className = "fc-sources";
                sources.forEach(function(s) {
                  const chip = document.createElement("span");
                  chip.className = "fc-source-chip";
                  chip.textContent = s;
                  srcEl.appendChild(chip);
                });
                inner.appendChild(srcEl);
              }
            } catch (_) {}
          }
        }

        history.push({ role: "user", content: text });
        history.push({ role: "assistant", content: fullText });
        while (history.length > 12) history.splice(0, 2);

      } catch (err) {
        typingEl.remove();
        addMessage(messagesEl, "bot", "Sorry, I'm having trouble connecting right now. Please try again or visit forsysinc.com.");
        console.error("[ForsysChat]", err);
      } finally {
        isLoading = false;
        sendBtn.disabled = false;
        inputEl.focus();
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
