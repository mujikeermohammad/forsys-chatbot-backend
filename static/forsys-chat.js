/**
 * ForsysGPT — Chat Widget (with lead capture)
 * Drop-in script: <script src="forsys-chat.js" data-api="https://your-api-url"></script>
 *
 * Config attributes on the <script> tag:
 *   data-api       — required: base URL of the FastAPI backend
 *   data-title     — widget header title (default: "ForsysGPT")
 *   data-greeting  — first message from the bot
 */
(function () {
  "use strict";

  const script   = document.currentScript || document.querySelector('script[data-api]');
  const API_BASE = (script && script.getAttribute("data-api")) || "http://localhost:8000";
  const TITLE    = (script && script.getAttribute("data-title")) || "ForsysGPT";
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
      opacity: 0; transform: scale(0); pointer-events: none;
    }
    #fc-fab.fc-fab-visible {
      opacity: 1; transform: scale(1); pointer-events: all;
      animation: fc-fab-pop .55s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    }
    @keyframes fc-fab-pop {
      0%   { opacity: 0; transform: scale(0) rotate(-8deg); }
      65%  { opacity: 1; transform: scale(1.16) rotate(2deg); }
      82%  { transform: scale(0.93) rotate(-1deg); }
      100% { opacity: 1; transform: scale(1) rotate(0deg); }
    }
    #fc-fab:hover { transform: scale(1.08); box-shadow: 0 12px 40px rgba(107,72,255,0.28); }
    #fc-fab svg { width: 26px; height: 26px; fill: #fff; }
    #fc-fab .fc-close { display: none; }
    #fc-fab.is-open .fc-open  { display: none; }
    #fc-fab.is-open .fc-close { display: block; }

    #fc-panel {
      position: fixed; bottom: 92px; right: 24px; z-index: 9998;
      width: 380px; max-width: calc(100vw - 32px);
      height: 580px; max-height: calc(100vh - 120px);
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
    #fc-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #4ade80; flex-shrink: 0;
      box-shadow: 0 0 0 2px rgba(74,222,128,.3);
      animation: fc-pulse 2s infinite;
    }
    #fc-new-chat {
      margin-left: auto;
      background: rgba(255,255,255,.12); border: 1.5px solid rgba(255,255,255,.32);
      border-radius: 100px; padding: 5px 12px 5px 8px;
      display: flex; align-items: center; gap: 5px;
      cursor: pointer; flex-shrink: 0;
      transition: background .15s;
      font-family: var(--fc-font); font-size: 12px; font-weight: 600; color: #fff;
    }
    #fc-new-chat:hover { background: rgba(255,255,255,.24); }
    #fc-new-chat svg { width: 13px; height: 13px; stroke: #fff; flex-shrink: 0; }
    @keyframes fc-pulse {
      0%,100% { box-shadow: 0 0 0 2px rgba(74,222,128,.3); }
      50%      { box-shadow: 0 0 0 5px rgba(74,222,128,.1); }
    }

    /* ── Pre-chat form ── */
    #fc-prechat {
      flex: 1; display: flex; flex-direction: column;
      background: var(--fc-bg); padding: 22px 20px 18px; gap: 14px;
      overflow-y: auto;
    }
    #fc-prechat-intro { display: flex; gap: 10px; align-items: flex-start; }
    #fc-prechat-avatar {
      width: 36px; height: 36px; border-radius: 50%;
      background: #fff; border: 1.5px solid var(--fc-border);
      display: grid; place-items: center; flex-shrink: 0; overflow: hidden; padding: 5px;
    }
    #fc-prechat-avatar img { width: 100%; border-radius: 50%; display: block; }
    #fc-prechat-bubble {
      background: var(--fc-white); border: 1px solid var(--fc-border);
      border-radius: 12px; border-bottom-left-radius: 4px;
      padding: 10px 13px; font-size: 13.5px; line-height: 1.55;
      color: var(--fc-dark); flex: 1;
    }
    #fc-prechat h3 {
      font-size: 13.5px; font-weight: 700; color: var(--fc-dark); margin: 0;
      padding-top: 2px;
    }
    #fc-prechat p {
      font-size: 12.5px; color: var(--fc-muted); margin: 0;
      line-height: 1.5;
    }
    .fc-form-box {
      background: var(--fc-white); border: 1.5px solid var(--fc-border);
      border-radius: 12px; padding: 14px 14px 12px; display: flex;
      flex-direction: column; gap: 10px;
    }
    .fc-field { display: flex; flex-direction: column; gap: 5px; }
    .fc-field label {
      font-size: 12px; font-weight: 600; color: var(--fc-dark);
      text-transform: uppercase; letter-spacing: .04em;
      display: flex; align-items: center; gap: 6px;
    }
    .fc-optional {
      font-size: 10px; font-weight: 500; color: var(--fc-muted);
      background: #f3f4f6; border-radius: 4px; padding: 1px 5px;
      text-transform: none; letter-spacing: 0;
    }
    .fc-field input {
      padding: 9px 12px; border: 1.5px solid var(--fc-border);
      border-radius: 10px; font-size: 14px; font-family: var(--fc-font);
      outline: none; background: var(--fc-bg); color: var(--fc-dark);
      transition: border-color .15s;
    }
    .fc-field input:focus { border-color: var(--fc-purple); }
    .fc-field input.fc-input-err { border-color: #ef4444; }
    .fc-err-msg {
      font-size: 11.5px; color: #ef4444; display: none; line-height: 1.4;
    }
    .fc-err-msg.visible { display: block; }
    #fc-prechat-submit {
      width: 100%; padding: 10px; border-radius: 10px; border: none;
      background: linear-gradient(135deg, var(--fc-purple), var(--fc-teal));
      color: #fff; font-size: 13.5px; font-weight: 600;
      cursor: pointer; font-family: var(--fc-font);
      transition: opacity .15s; margin-top: 2px;
    }
    #fc-prechat-submit:hover { opacity: .9; }
    .fc-or {
      text-align: center; font-size: 12px; color: var(--fc-muted);
      font-style: italic; position: relative;
    }
    #fc-prechat-skip {
      width: 100%; padding: 10px; border-radius: 10px;
      border: 1.5px solid var(--fc-border);
      background: var(--fc-white); color: var(--fc-dark);
      font-size: 13.5px; font-weight: 600;
      cursor: pointer; font-family: var(--fc-font);
      transition: border-color .15s, color .15s;
    }
    #fc-prechat-skip:hover { border-color: var(--fc-purple); color: var(--fc-purple); }

    /* ── Messages ── */
    #fc-messages {
      flex: 1; overflow-y: auto; padding: 16px;
      display: flex; flex-direction: column; gap: 12px;
      background: var(--fc-bg);
      overscroll-behavior: contain;
    }
    #fc-messages::-webkit-scrollbar { width: 4px; }
    #fc-messages::-webkit-scrollbar-thumb { background: var(--fc-border); border-radius: 4px; }

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
    .fc-msg.user .fc-avatar { background: var(--fc-dark); color:#fff; font-weight: 600; }

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

    /* ── Tooltip ── */
    #fc-tooltip {
      position: fixed; bottom: 92px; right: 24px; z-index: 9997;
      background: #fff; color: var(--fc-dark);
      font-family: var(--fc-font); font-size: 13px; font-weight: 500;
      padding: 11px 15px; border-radius: 12px; max-width: 265px;
      box-shadow: 0 4px 20px rgba(0,0,0,.13), 0 0 0 1px rgba(0,0,0,.04);
      line-height: 1.45; pointer-events: none;
      opacity: 0; transform: translateY(10px) scale(.96);
      transition: opacity .3s ease, transform .3s ease;
    }
    #fc-tooltip::before {
      content: ''; position: absolute;
      bottom: -6px; right: 22px;
      width: 12px; height: 12px;
      background: #fff; transform: rotate(45deg);
      box-shadow: 2px 2px 5px rgba(0,0,0,.07);
    }
    #fc-tooltip.fc-tip-visible { opacity: 1; transform: translateY(0) scale(1); }
    #fc-tooltip.fc-tip-out     { opacity: 0; transform: translateY(4px) scale(.97); }

    @media (prefers-reduced-motion: reduce) {
      #fc-panel, #fc-fab, .fc-msg, #fc-tooltip { transition: none !important; animation: none !important; }
      #fc-fab.fc-fab-visible { opacity: 1 !important; transform: scale(1) !important; }
    }
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
        <button id="fc-new-chat" title="New conversation" aria-label="Start new conversation">
          <svg fill="none" stroke-width="2.5" stroke-linecap="round" viewBox="0 0 24 24" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          <span>New Chat</span>
        </button>
      </div>

      <div id="fc-prechat">
        <div id="fc-prechat-intro">
          <div id="fc-prechat-avatar">
            <img src="https://www.forsysinc.com/blog/wp-content/uploads/2026/06/Forsys_cloud.png" alt="ForsysGPT">
          </div>
          <div id="fc-prechat-bubble">${GREETING}</div>
        </div>
        <p style="font-size:12px;color:var(--fc-muted);margin:0">Share your details so we can follow up &mdash; or skip and chat anonymously.</p>
        <div class="fc-form-box">
          <div class="fc-field" id="fc-name-field">
            <label for="fc-name-input">Your name <span class="fc-optional">Optional</span></label>
            <input id="fc-name-input" type="text" placeholder="Jane Smith" autocomplete="name">
          </div>
          <div class="fc-field" id="fc-email-field">
            <label for="fc-email-input">Work email <span class="fc-optional">Optional</span></label>
            <input id="fc-email-input" type="email" placeholder="jane@company.com" autocomplete="email">
            <span class="fc-err-msg" id="fc-email-err"></span>
          </div>
          <button id="fc-prechat-submit">Start chatting &rarr;</button>
        </div>
        <div class="fc-or">or</div>
        <button id="fc-prechat-skip">Skip &amp; Start Chatting</button>
      </div>

      <div id="fc-messages" aria-live="polite" style="display:none"></div>
      <div id="fc-footer" style="display:none">
        <textarea id="fc-input" placeholder="Ask me anything about Forsys..." rows="1" aria-label="Message"></textarea>
        <button id="fc-send" aria-label="Send">
          <svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
        </button>
      </div>
      <div id="fc-powered">ForsysGPT &mdash; Ask about services, solutions &amp; more</div>`;

    const tooltip = document.createElement("div");
    tooltip.id = "fc-tooltip";
    tooltip.textContent = "Want to know more about Forsys? I’m here";
    document.body.appendChild(fab);
    document.body.appendChild(panel);
    document.body.appendChild(tooltip);
    return { fab, panel, tooltip };
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
      .replace(/((?:^[*-] .+\n?)+)/gm, function(b) {
        return '<ul>' + b.trim().split('\n').map(function(l) { return '<li>' + l.replace(/^[*-] /, '') + '</li>'; }).join('') + '</ul>';
      })
      .split('\n').map(function(l) {
        return /^<(h[1-3]|ul|ol|li|hr)/.test(l.trim()) || !l.trim() ? l : '<p>' + l + '</p>';
      }).join('\n');
  }

  function addMessage(container, role, text) {
    const wrap   = document.createElement("div");
    wrap.className = "fc-msg " + role;

    const avatar = document.createElement("div");
    avatar.className = "fc-avatar";
    if (role === "bot") {
      const img = document.createElement("img");
      img.src = "https://www.forsysinc.com/blog/wp-content/uploads/2026/06/Forsys_cloud.png";
      img.alt = "ForsysGPT";
      avatar.appendChild(img);
    } else {
      avatar.innerHTML = '<svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" style="width:15px;height:15px" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
      avatar.style.color = "#fff";
    }

    const inner  = document.createElement("div");
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

    wrap.appendChild(avatar);
    wrap.appendChild(inner);
    container.appendChild(wrap);
    container.scrollTop = container.scrollHeight;
    return { wrap, bubble, inner };
  }

  function addTyping(container) {
    const wrap = document.createElement("div");
    wrap.className = "fc-msg bot";
    wrap.innerHTML = '<div class="fc-avatar"><img src="https://www.forsysinc.com/blog/wp-content/uploads/2026/06/Forsys_cloud.png" alt="ForsysGPT"></div><div class="fc-bubble fc-typing"><span></span><span></span><span></span></div>';
    container.appendChild(wrap);
    container.scrollTop = container.scrollHeight;
    return wrap;
  }

  var BLOCKED_DOMAINS = [
    "gmail.com","googlemail.com","yahoo.com","yahoo.co.uk","yahoo.co.in","yahoo.fr",
    "yahoo.de","yahoo.es","yahoo.it","yahoo.com.au","yahoo.com.br","yahoo.ca",
    "hotmail.com","hotmail.co.uk","hotmail.fr","hotmail.de","hotmail.es","hotmail.it",
    "outlook.com","outlook.co.uk","outlook.fr","outlook.de","outlook.es","outlook.it",
    "live.com","live.co.uk","live.fr","live.de","live.es","live.it",
    "msn.com","aol.com","icloud.com","me.com","mac.com","protonmail.com","proton.me",
    "pm.me","tutanota.com","tutamail.com","mail.com","gmx.com","gmx.net","gmx.de",
    "ymail.com","inbox.com","fastmail.com","fastmail.fm","hushmail.com","zohomail.com",
    "comcast.net","verizon.net","att.net","sbcglobal.net","bellsouth.net","cox.net",
    "earthlink.net","roadrunner.com","charter.net","optonline.net","windstream.net",
    "yandex.com","yandex.ru","mail.ru","qq.com","163.com","126.com","sina.com",
    "rediffmail.com","in.com","sify.com","indiatimes.com","rediff.com","lycos.com",
    "rocketmail.com","aim.com","excite.com","juno.com","netzero.net","mailfence.com"
  ];

  // ── Session persistence ──────────────────────────────────────────────────────
  var SESSION_KEY = 'fc_chat_v1';

  function loadSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
  }

  function saveSession(name, email, hist) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        name: name, email: email, history: hist.slice(-30)
      }));
    } catch(e) {}
  }

  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch(e) {}
  }
  // ─────────────────────────────────────────────────────────────────────────────

  function getAnonId() {
    var key = 'fc_guest_id';
    var id;
    try { id = localStorage.getItem(key); } catch(e) {}
    if (!id) {
      id = 'guest_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      try { localStorage.setItem(key, id); } catch(e) {}
    }
    return id;
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function isWorkEmail(email) {
    var domain = email.split("@")[1];
    if (!domain) return false;
    return BLOCKED_DOMAINS.indexOf(domain.toLowerCase()) === -1;
  }

  function init() {
    injectStyles();
    var _r       = buildWidget();
    var fab      = _r.fab;
    var panel    = _r.panel;
    var tooltipEl = _r.tooltip;

    var prechatEl = panel.querySelector("#fc-prechat");
    var messagesEl = panel.querySelector("#fc-messages");
    var footerEl   = panel.querySelector("#fc-footer");
    var inputEl    = panel.querySelector("#fc-input");
    var sendBtn    = panel.querySelector("#fc-send");

    var nameInput   = panel.querySelector("#fc-name-input");
    var emailInput  = panel.querySelector("#fc-email-input");
    var emailErr    = panel.querySelector("#fc-email-err");
    var submitBtn   = panel.querySelector("#fc-prechat-submit");
    var skipBtn     = panel.querySelector("#fc-prechat-skip");
    var newChatBtn  = panel.querySelector("#fc-new-chat");

    var isOpen      = false;
    var isLoading   = false;
    var leadName    = "";
    var leadEmail   = "";
    var history     = [];

    function showChat() {
      if (!leadEmail) {
        leadName  = "Unknown User";
        leadEmail = getAnonId() + "@forsysgpt";
      }
      saveSession(leadName, leadEmail, history);
      prechatEl.style.display  = "none";
      messagesEl.style.display = "flex";
      footerEl.style.display   = "flex";
      addMessage(messagesEl, "bot", GREETING);
      inputEl.focus();
    }

    // ── Restore saved session ─────────────────────────────────────────────────
    var saved = loadSession();
    if (saved && saved.email) {
      leadName  = saved.name  || "Unknown User";
      leadEmail = saved.email;
      history   = saved.history || [];
      prechatEl.style.display  = "none";
      messagesEl.style.display = "flex";
      footerEl.style.display   = "flex";
      if (history.length > 0) {
        history.forEach(function(msg) {
          addMessage(messagesEl, msg.role === "assistant" ? "bot" : "user", msg.content);
        });
        messagesEl.scrollTop = messagesEl.scrollHeight;
      } else {
        addMessage(messagesEl, "bot", GREETING);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── New chat button ───────────────────────────────────────────────────────
    newChatBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      clearSession();
      leadName  = "";
      leadEmail = "";
      history   = [];
      messagesEl.innerHTML     = "";
      messagesEl.style.display = "none";
      footerEl.style.display   = "none";
      prechatEl.style.display  = "flex";
      nameInput.value  = "";
      emailInput.value = "";
      clearEmailErr();
    });

    function toggle() {
      hideTooltip();
      isOpen = !isOpen;
      fab.classList.toggle("is-open", isOpen);
      panel.classList.toggle("is-open", isOpen);
      if (isOpen) {
        if (messagesEl.style.display !== "none") {
          setTimeout(function() { messagesEl.scrollTop = messagesEl.scrollHeight; }, 60);
          inputEl.focus();
        } else {
          nameInput.focus();
        }
      }
    }

    // Skip button
    skipBtn.addEventListener("click", function() { showChat(); });

    function clearEmailErr() {
      emailInput.classList.remove("fc-input-err");
      emailErr.textContent = "";
      emailErr.classList.remove("visible");
    }
    emailInput.addEventListener("input", clearEmailErr);

    // Pre-chat form submit (email validated if provided)
    submitBtn.addEventListener("click", function() {
      var n = nameInput.value.trim();
      var e = emailInput.value.trim();
      clearEmailErr();

      if (e) {
        if (!isValidEmail(e)) {
          emailInput.classList.add("fc-input-err");
          emailErr.textContent = "Please enter a valid email address.";
          emailErr.classList.add("visible");
          emailInput.focus();
          return;
        }
        if (!isWorkEmail(e)) {
          emailInput.classList.add("fc-input-err");
          emailErr.textContent = "Please use your work email address.";
          emailErr.classList.add("visible");
          emailInput.focus();
          return;
        }
        leadEmail = e;
        leadName  = n;
      }
      showChat();
    });

    // Allow Enter in email field to submit
    emailInput.addEventListener("keydown", function(e) {
      if (e.key === "Enter") { e.preventDefault(); submitBtn.click(); }
    });
    nameInput.addEventListener("keydown", function(e) {
      if (e.key === "Enter") { e.preventDefault(); emailInput.focus(); }
    });

    fab.addEventListener("click", toggle);
    fab.addEventListener("mouseenter", hideTooltip);

    // Auto-resize textarea
    inputEl.addEventListener("input", function() {
      inputEl.style.height = "auto";
      inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + "px";
    });

    inputEl.addEventListener("keydown", function(e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    sendBtn.addEventListener("click", send);

    // ── Delayed FAB reveal + tooltip ─────────────────────────────────────────
    function hideTooltip() {
      if (!tooltipEl.classList.contains('fc-tip-visible')) return;
      tooltipEl.classList.remove('fc-tip-visible');
      tooltipEl.classList.add('fc-tip-out');
      setTimeout(function() { tooltipEl.style.display = 'none'; }, 320);
    }

    setTimeout(function() {
      fab.classList.add('fc-fab-visible');
      // Clear animation fill after pop completes so :hover transition works normally
      setTimeout(function() { fab.style.animation = 'none'; }, 620);
      // Tooltip appears 350ms after FAB starts animating
      setTimeout(function() {
        tooltipEl.classList.add('fc-tip-visible');
        // Auto-dismiss tooltip after 5 seconds
        setTimeout(hideTooltip, 5000);
      }, 350);
    }, 3000);

    async function send() {
      var text = inputEl.value.trim();
      if (!text || isLoading) return;

      inputEl.value = "";
      inputEl.style.height = "auto";
      isLoading = true;
      sendBtn.disabled = true;

      addMessage(messagesEl, "user", text);
      var typingEl = addTyping(messagesEl);

      try {
        var body = { message: text, history: history };
        if (leadName && leadEmail) {
          body.name  = leadName;
          body.email = leadEmail;
        }

        var res = await fetch(API_BASE + "/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        typingEl.remove();
        if (!res.ok) throw new Error("Server error " + res.status);

        var _m = addMessage(messagesEl, "bot", "");
        var bubble   = _m.bubble;
        var inner    = _m.inner;
        var fullText = "";
        var sources  = [];

        // Typewriter state
        var typeQueue = "";
        var isTyping  = false;

        function typeNext() {
          if (typeQueue.length === 0) { isTyping = false; return; }
          isTyping = true;
          fullText += typeQueue[0];
          typeQueue = typeQueue.slice(1);
          bubble.innerHTML = renderMarkdown(fullText);
          messagesEl.scrollTop = messagesEl.scrollHeight;
          setTimeout(typeNext, 18);
        }

        var reader  = res.body.getReader();
        var decoder = new TextDecoder();
        var buffer  = "";

        while (true) {
          var _read = await reader.read();
          if (_read.done) break;

          buffer += decoder.decode(_read.value, { stream: true });
          var lines = buffer.split("\n");
          buffer = lines.pop();

          for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (!line.startsWith("data: ")) continue;
            var raw = line.slice(6).trim();
            if (!raw) continue;
            try {
              var evt = JSON.parse(raw);
              if (evt.type === "meta") {
                sources = evt.sources || [];
              } else if (evt.type === "delta") {
                typeQueue += evt.text;
                if (!isTyping) typeNext();
              } else if (evt.type === "done" && sources.length) {
                var srcEl = document.createElement("div");
                srcEl.className = "fc-sources";
                sources.forEach(function(s) {
                  var chip = document.createElement("span");
                  chip.className = "fc-source-chip";
                  chip.textContent = s;
                  srcEl.appendChild(chip);
                });
                inner.appendChild(srcEl);
              }
            } catch (_) {}
          }
        }

        // Wait for typewriter to finish
        await new Promise(function(resolve) {
          (function wait() { isTyping || typeQueue.length ? setTimeout(wait, 50) : resolve(); })();
        });

        history.push({ role: "user", content: text });
        history.push({ role: "assistant", content: fullText });
        while (history.length > 12) history.splice(0, 2);
        saveSession(leadName, leadEmail, history);

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
