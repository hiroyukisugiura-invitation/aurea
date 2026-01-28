/* public/assets/js/layout.js (AUREA v1 - rebuilt)
  요구사항:
  - 左カラム最上部に「検索」ラベル＋検索窓
  - 検索は AUREA 内の全会話（global + 全project）を横断検索
  - [画像] は会話とは別の集約ボックス（全会話の作成画像を集約）
  - [プロジェクト][チャット] はプルダウン + 履歴保存（localStorage）
  - プロジェクトとチャットは別扱い（scope 分離）
  - ユーザーボタン→設定 はメイン画面内ポップアップ（settings-modal / embedded）
  - リロード時に勝手に画像モード開始しない（初期は chat）
*/

(() => {
  "use strict";

  // build stamp (prod verification)
  const AUREA_LAYOUT_BUILD = "2026-01-08T00:00+09:00";
  window.AUREA_LAYOUT_BUILD = AUREA_LAYOUT_BUILD;
  try { document.documentElement.setAttribute("data-aurea-layout-build", AUREA_LAYOUT_BUILD); } catch {}
  try { console.info("[AUREA] layout.js loaded:", AUREA_LAYOUT_BUILD); } catch {}

  // ===== AUREA: hide askbar pending indicator while streaming (ChatGPT-like) =====
  // 解析中（body.aurea-streaming）の間だけ、Askバー左の半透明丸（疑似要素/装飾）を消す
  (() => {
    if (document.getElementById("aureaHideAskPendingFx")) return;
    const st = document.createElement("style");
    st.id = "aureaHideAskPendingFx";
    st.textContent = `
      body.aurea-streaming .ask::before,
      body.aurea-streaming .ask::after,
      body.aurea-streaming .ask-row::before,
      body.aurea-streaming .ask-row::after,
      body.aurea-streaming .ask-wrap::before,
      body.aurea-streaming .ask-wrap::after{
        display:none !important;
        content:none !important;
        opacity:0 !important;
      }
    `;
    document.head.appendChild(st);
  })();

  /* ================= helpers ================= */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const nowISO = () => new Date().toISOString();

  const escHtml = (s) => String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");

  const closeDetails = (d) => { if (d?.hasAttribute("open")) d.removeAttribute("open"); };
  const closeAllDetailsExcept = (keep) => $$("details[open]").forEach(d => { if (d !== keep) d.removeAttribute("open"); });
  const isInside = (el, t) => !!el && (el === t || el.contains(t));

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  // debug logger (layout.js)
  const dbg = (...args) => { try { console.info(...args); } catch {} };

  /* ================= API routing (JSON-validated: use /api only) ================= */
  let AUREA_API_PREFIX = "/api";

  const isJsonResponse = (r) => {
    try {
      const ct = String(r?.headers?.get("content-type") || "").toLowerCase();
      return ct.includes("application/json");
    } catch {
      return false;
    }
  };

  const tryFetchJson = async (prefix, path, options) => {
    const p = String(path || "").startsWith("/") ? String(path) : `/${path}`;
    const r = await fetch(`${prefix}${p}`, options || {});
    if (!r) return null;

    // JSON で返るなら status(200/400/500) に関係なく返す（重要）
    if (!isJsonResponse(r)) return null;

    return r;
  };

  const apiFetchJson = async (path, options) => {
    // 本番は /api 固定（/ai は Hosting で index.html を返す事故があるため使わない）
    const r = await tryFetchJson("/api", path, options);
    if (r) return r;
    return null;
  };

  // ===== POST SSE reader (ChatGPT-like streaming) =====
  // Server: /api/chat/stream returns text/event-stream
  const apiFetchSse = async ({ path, payload, signal, onEvent }) => {
    const url = `/api${String(path || "").startsWith("/") ? String(path) : `/${String(path || "")}`}`;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
      signal
    });

    const ct = String(r?.headers?.get("content-type") || "").toLowerCase();
    const isSse = ct.includes("text/event-stream");

    if (!r || !r.ok || !r.body || !isSse) {
      return { ok: false, status: r ? r.status : 0, isSse };
    }

    const reader = r.body.getReader();
    const dec = new TextDecoder("utf-8");
    let buf = "";

    let curEvent = "";
    let curData = "";

    const flush = () => {
      const ev = String(curEvent || "message").trim() || "message";
      const data = String(curData || "");
      curEvent = "";
      curData = "";
      try { if (typeof onEvent === "function") onEvent(ev, data); } catch {}
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buf += dec.decode(value, { stream: true });

      // SSE frames separated by \n\n
      while (true) {
        const idx = buf.indexOf("\n\n");
        if (idx < 0) break;

        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);

        const lines = frame.split("\n");
        for (const ln of lines) {
          const line = String(ln || "");

          if (line.startsWith("event:")) {
            curEvent = line.slice(6).trim();
            continue;
          }

          if (line.startsWith("data:")) {
            const d = line.slice(5);
            // data may be multi-line; keep as-is (no trim)
            curData += (curData ? "\n" : "") + d;
            continue;
          }
        }

        flush();
      }
    }

    // flush tail (best-effort)
    if (curEvent || curData) flush();

    return { ok: true, status: r.status, isSse: true };
  };

  const detectApiPrefix = async () => {
    // 本番は /api 固定（ping 成功だけ確認）
    try {
      const r1 = await tryFetchJson("/api", "/ping", { method: "GET", cache: "no-store" });
      if (r1) { AUREA_API_PREFIX = "/api"; return; }
    } catch {}
    AUREA_API_PREFIX = "/api";
  };

  /* ================= AI activity fade ================= */
let aiActivityRoot = null;

const ensureAiActivityRoot = () => {
  if (aiActivityRoot) return aiActivityRoot;

  const el = document.createElement("div");
  el.className = "ai-activity";
  document.body.appendChild(el);
  aiActivityRoot = el;
  return el;
};

const showAiActivity = (name) => {
  // GPT完全互換UI：AIアクティビティは表示しない
  void name;
  return;
};

/* ================= streaming meteor label (GPT-like) ================= */
let aiMeteorFxInjected = false;

const ensureAiMeteorFx = () => {
  if (aiMeteorFxInjected) return;
  aiMeteorFxInjected = true;

  const st = document.createElement("style");
  st.setAttribute("data-aurea-meteor-fx", "1");
  st.textContent = `
    @keyframes aureaMeteorSweep {
      0%   { transform: translateX(-22px); opacity: 0; }
      12%  { opacity: 1; }
      100% { transform: translateX(96px); opacity: 0; }
    }

    /* 行左の丸（インジケータ）は role に関係なく消す（ChatGPT同等） */
    .msg::before,
    .msg::after,
    .bubble::before,
    .bubble::after{
      display:none !important;
      content:none !important;
    }

    /* 画面に出てくる「丸」系DOMを role 問わず潰す（スクショ2対策） */
    .msg .avatar,
    .msg .dot,
    .msg .circle,
    .msg .msg-icon,
    .msg .assistant-icon{
      display:none !important;
      content:none !important;
    }

    /* assistant msg内の「丸」系は常時消す（保険） */
    .msg.assistant::before,
    .msg.assistant::after{
      display:none !important;
      content:none !important;
    }

    .msg.assistant{
      position:relative;
    }

    /* streammark は使わない（解析ゲージに一本化） */
    .msg.assistant .aurea-streammark{
      display:none !important;
      content:none !important;
    }

    .msg.assistant .aurea-streammark__txt{
      position:relative;
      font-size:12px;
      line-height:1;
      color:rgba(255,255,255,.72);
      white-space:nowrap;
      letter-spacing:-.1px;
      padding:0;
      border:0;
      border-radius:0;
      background:transparent;
      overflow:hidden;
    }

    .msg.assistant .aurea-streammark__txt::after{
      content:"";
      position:absolute;
      top:50%;
      left:-22px;
      width:18px;
      height:2px;
      transform:translateY(-50%);
      background:linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(159,180,255,.92) 40%, rgba(255,255,255,0) 100%);
      filter: blur(.25px);
      animation:aureaMeteorSweep 1.05s linear infinite;
      opacity:.95;
    }

    .msg.assistant .aurea-streammark[hidden]{
      display:none !important;
    }

    /* 画像/添付プレビュー枠を消す（スクショ4対策：UI側の枠だけ） */
    .aurea-attach-chip img,
    .msg img,
    .ai-image-card img{
      border:0 !important;
      box-shadow:none !important;
      background:transparent !important;
      outline:0 !important;
    }
  `.trim();

  document.head.appendChild(st);
};

const setStreamingLabelMode = (mode) => {
  const v = (mode === "generating") ? "generating" : "analyzing";
  try { window.__AUREA_STREAMING_LABEL_MODE__ = v; } catch {}
};

const getStreamingLabel = () => {
  const v = String(window.__AUREA_STREAMING_LABEL_MODE__ || "analyzing");
  return (v === "generating") ? "回答文作成中" : "解析中";
};

/* ================= streaming meteor label (left thin dot) ================= */
/* (removed: duplicated meteor label block; keep only the first GPT-like implementation) */

/* ================= AI run indicator (brand rail) ================= */
let aiRunIndicatorEl = null;
let aiRunOrder = [];
let aiRunEnsureTimer = null;
let aiRunLastStatuses = null;

const ensureAiRunIndicator = () => {
  if (aiRunIndicatorEl) return aiRunIndicatorEl;

  const rail = document.querySelector(".brand-rail");
  if (!rail) {
    // brand-rail が後から生成されるケースに備えて、1回だけ遅延リトライ
    if (!aiRunEnsureTimer) {
      let tries = 0;
      aiRunEnsureTimer = setInterval(() => {
        tries += 1;

        const r = document.querySelector(".brand-rail");
        if (r) {
          clearInterval(aiRunEnsureTimer);
          aiRunEnsureTimer = null;

          const created = ensureAiRunIndicator();
          if (created && aiRunLastStatuses) {
            try { setAiRunIndicator({ phase: "run", statuses: aiRunLastStatuses }); } catch {}
          }
          return;
        }

        if (tries >= 60) {
          clearInterval(aiRunEnsureTimer);
          aiRunEnsureTimer = null;
        }
      }, 120);
    }
    return null;
  }

  const el = document.createElement("div");
  el.className = "ai-run-indicator";

  el.innerHTML = `
    <div class="ai-run__line ai-run__l1"></div>
    <div class="ai-run__line ai-run__l2"></div>
    <div class="ai-run__sp"></div>
    <div class="ai-run__list"></div>
  `;

rail.appendChild(el);

/* aria-hidden 対策：インジケーター表示中は可視化 */
try {
  if (rail.getAttribute("aria-hidden") === "true") {
    rail.setAttribute("aria-hidden", "false");
  }
} catch {}

aiRunIndicatorEl = el;
return el;
};

const noteAiBecameRunning = (name) => {
  const n = String(name || "").trim();
  if (!n) return;
  aiRunOrder = [n, ...aiRunOrder.filter(x => x !== n)];
};

const setAiRunIndicator = ({ phase, statuses }) => {
  // GPT完全互換UI：AI実行インジケータは表示しない
  void phase;
  void statuses;
  return;
};

const clearAiRunIndicator = () => {
  const el = ensureAiRunIndicator();
  if (!el) return;

  el.classList.remove("on");

  const l1 = el.querySelector(".ai-run__l1");
  const l2 = el.querySelector(".ai-run__l2");
  const list = el.querySelector(".ai-run__list");

  if (l1) l1.textContent = "";
  if (l2) l2.textContent = "";
  if (list) list.innerHTML = "";

  aiRunOrder = [];
  aiRunLastStatuses = null;

  if (aiRunEnsureTimer) {
    clearInterval(aiRunEnsureTimer);
    aiRunEnsureTimer = null;
  }
};

  /* ================= storage ================= */
  const STORAGE_KEY_LOCAL = "aurea_main_v1_local";
  const STORAGE_KEY_CLOUD = "aurea_main_v1_cloud";
  const STORAGE_PREF_KEY = "aurea_data_storage"; // "cloud" | "local"

  // pending storage switch after Google connect
  const PENDING_STORAGE_MODE_KEY = "aurea_pending_storage_mode_v1"; // "cloud"

  const getStorageMode = () => {
    try {
      const v = localStorage.getItem(STORAGE_PREF_KEY);
      return (v === "local") ? "local" : "cloud";
    } catch {
      return "cloud";
    }
  };

  const getStorageKey = () => {
    return (getStorageMode() === "local") ? STORAGE_KEY_LOCAL : STORAGE_KEY_CLOUD;
  };

  const load = () => {
    try {
      // 1) 優先：現在の保存先キー
      const raw = localStorage.getItem(getStorageKey());
      if (raw) return JSON.parse(raw);

      // 2) フォールバック：反対側キー（保存先切替で空に見える事故を防ぐ）
      const otherKey = (getStorageKey() === STORAGE_KEY_LOCAL) ? STORAGE_KEY_CLOUD : STORAGE_KEY_LOCAL;
      const raw2 = localStorage.getItem(otherKey);
      if (raw2) return JSON.parse(raw2);

      return null;
    } catch {
      return null;
    }
  };

  const save = (s) => {
    try {
      const v = JSON.stringify(s);

      // 1) 現在の保存先
      localStorage.setItem(getStorageKey(), v);

      // 2) 反対側にも同期（切替で履歴/画像が消えたように見える事故を防ぐ）
      localStorage.setItem(STORAGE_KEY_LOCAL, v);
      localStorage.setItem(STORAGE_KEY_CLOUD, v);
    } catch {}
  };

  /* ================= state ================= */
  const defaultState = () => ({
    version: 1,

    // view: "chat" | "images" | "search"
    view: "chat",

    // selected project (for showing PJ area)
    activeProjectId: null,

    // current opened conversation context (what the main board shows)
    // { type:"global" } or { type:"project", projectId:"..." }
    context: { type: "global" },

    // active thread ids
    activeThreadIdByScope: { global: null, projects: {} },

    // threads
    threads: {
      global: [],
      projects: {}
    },

    // projects list
    projects: [
      { id: "p_ai_earth", name: "AI Earth", updatedAt: nowISO() },
      { id: "p_sound_factory", name: "Sound Factory", updatedAt: nowISO() }
    ],

    // images library (aggregated, independent)
    images: [],

    // settings
    settings: {
      theme: "dark",
      sendMode: "cmdEnter",
      dataStorage: "cloud",
      language: "ja",
      showAiReports: false
    },

    // apps/connectors
    apps: {
      Google: false,
      Gmail: false,
      "Google Drive": false,
      GitHub: false,
      Notion: false,
      Slack: false,
      Dropbox: false,
      Jira: false,
      Salesforce: false,
      Zoom: false
    },
    customApps: [],

    // plan
    plan: "Free",

    // account
    user: {
      displayName: "",
      email: "",
      trustedDevice: "",
      deviceTrusted: false
    }
  });

  const state = load() || defaultState();

  // IMPORTANT: reload should not start in images
  state.view = "chat";

  // IMPORTANT: reload should not open previous thread (start blank like GPT)
  state.context = { type: "global" };
  if (!state.activeThreadIdByScope) state.activeThreadIdByScope = { global: null, projects: {} };
  state.activeThreadIdByScope.global = null;

  /* ===== i18n (v1) ===== */
  const tr = (key) => {
    return (window.AUREA_I18N && typeof window.AUREA_I18N.tr === "function")
      ? window.AUREA_I18N.tr(state, key)
      : key;
  };

  function applyI18nAttrs() {
    document.querySelectorAll("[data-i18n]").forEach(el => {
      const key = el.getAttribute("data-i18n");
      el.textContent = tr(key);
    });

    document.querySelectorAll("[data-i18n-aria]").forEach(el => {
      const key = el.getAttribute("data-i18n-aria");
      el.setAttribute("aria-label", tr(key));
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
      const key = el.getAttribute("data-i18n-placeholder");
      el.setAttribute("placeholder", tr(key));
    });

    document.querySelectorAll("[data-i18n-title]").forEach(el => {
      const key = el.getAttribute("data-i18n-title");
      el.setAttribute("title", tr(key));
    });
  }

  /* ================= elements ================= */
  const body = document.body;

  const sidebar = $(".sidebar");
  const sbTop = $(".sb-top", sidebar);

  const userMenuDetails = $(".user-menu details");
  const plusDetails = $(".plus-menu details");

  const projectModal = $(".project-modal");

  const projectNameInput = $(".project-modal .pname");
  const projectCreateBtn = $(".project-modal .pcreate");

  const chatRoot = $(".chat");
  const board = $(".board");

// ===== scroll state (GPT-like) =====
  let userNearBottom = true;

  const isNearBottom = () => {
    if (!board) return true;
    const gap = board.scrollHeight - board.scrollTop - board.clientHeight;
    return gap < 140;
  };

  const syncScrollState = () => {
    userNearBottom = isNearBottom();
  };

  board?.addEventListener("scroll", syncScrollState, { passive: true });

  // ask
  const askInput = document.querySelector(".ask .in");
  const sendBtn = $(".ask [data-action='send']");
  const micBtn = $(".ask [data-action='mic']");
  const voiceBtn = $(".ask [data-action='voice']");
  const stopBtn = $(".ask [data-action='stop']");

  // sidebar buttons
  const btnSearchLegacy = $(".sb-item[aria-label='チャット内を検索']");
  const btnNewChat = $(".sb-item[data-nav='newChat']");
  const btnImages = $(".sb-item[data-nav='images']");
  const btnShare = $(".topbar .icon-btn[data-i18n-aria='share']");

  const linkSettings =
    document.getElementById("btnOpenSettings")
    || $(".user-pop a[data-action='open-settings']")
    || $(".user-pop a[aria-label='設定']");

  const linkLogout =
    document.getElementById("btnLogout")
    || $(".user-pop a[data-action='logout']")
    || $(".user-pop a[aria-label='ログアウト']");

  // settings open（本番で # 遷移させない）
  linkSettings?.addEventListener("click", (e) => {
    e.preventDefault();
    closeDetails(userMenuDetails);
    openSettings();

    // Settings表示後にi18nを再適用（DOM生成/描画遅延でも確実に反映）
    try { applyI18n(); } catch {}
    try { syncSettingsUi(); } catch {}
  }, true);

  /* ================= settings (embedded modal) ================= */
  const settingsModal = document.getElementById("settingsModal");
  const settingsClose = document.querySelector(".settings-modal .close");

  const applyTheme = () => {
    const th = state.settings?.theme || "dark";
    body.classList.remove("theme-light", "theme-dark");

    // v1: system は dark 扱い（CSS拡張は後工程で可）
    if (th === "light") body.classList.add("theme-light");
    else body.classList.add("theme-dark");

    // Light時ロゴ差し替え
    const logo = document.querySelector(".brand-logo");
    if (logo) {
      const darkSrc = "/assets/img/brand/aurea_logo_l_wh.png";
      const lightSrc = "/assets/img/brand/aurea_logo_l_bk.png";
      logo.src = (th === "light") ? lightSrc : darkSrc;
    }
  };

  const syncSettingsUi = () => {
    const autoSizeSelect = (sel) => {
      if (!sel) return;

      // いったん自動幅に戻してから計測（縮みすぎ事故防止）
      sel.style.width = "";
      sel.style.inlineSize = "";

      const opt = sel.options?.[sel.selectedIndex];
      const text = String(opt ? opt.text : (sel.value || "")).trim();
      if (!text) return;

      const cs = window.getComputedStyle(sel);

      // 計測用
      const span = document.createElement("span");
      span.style.position = "fixed";
      span.style.left = "-99999px";
      span.style.top = "-99999px";
      span.style.visibility = "hidden";
      span.style.whiteSpace = "pre";
      span.style.fontFamily = cs.fontFamily;
      span.style.fontSize = cs.fontSize;
      span.style.fontWeight = cs.fontWeight;
      span.style.letterSpacing = cs.letterSpacing;
      span.textContent = text;

      document.body.appendChild(span);

      const textW = Math.ceil(span.getBoundingClientRect().width);
      document.body.removeChild(span);

      const pl = parseFloat(cs.paddingLeft || "0") || 0;
      const pr = parseFloat(cs.paddingRight || "0") || 0;
      const bwL = parseFloat(cs.borderLeftWidth || "0") || 0;
      const bwR = parseFloat(cs.borderRightWidth || "0") || 0;

      // 右の▼領域・OS差分の安全マージン
      const safety = 10;

      // モーダル幅に収める
      const modal = document.querySelector(".settings-modal .modal");
      const modalW = modal ? modal.getBoundingClientRect().width : window.innerWidth;
      const maxW = Math.max(220, Math.min(560, Math.floor(modalW * 0.72)));

      const raw = textW + pl + pr + bwL + bwR + safety;

      // 最小幅は「▼領域＋padding＋枠」だけ確保（固定120pxは撤去＝余白が出ない）
      const minW = Math.ceil(pl + pr + bwL + bwR + safety + 4);

      const w = clamp(raw, minW, maxW);

      sel.style.width = `${w}px`;
      sel.style.inlineSize = `${w}px`;
    };

    // Theme
    const selTheme = document.querySelector(".settings-modal #settingsTheme");
    if (selTheme) {
      selTheme.value = (state.settings?.theme || "dark");
      autoSizeSelect(selTheme);
    }

    // Language
  const selLang = document.querySelector(".settings-modal #settingsLang");
    if (selLang) {
      const cur = String(state.settings?.language || "ja").trim();

      // option value が "en" / "en-US" どちらでも確実に追従
      const hasValue = (v) => Array.from(selLang.options || []).some((o) => String(o.value || "").trim() === v);

      if (String(cur).toLowerCase().startsWith("en")) {
        if (hasValue(cur)) {
          selLang.value = cur;
        } else if (hasValue("en")) {
          selLang.value = "en";
        } else if (hasValue("en-US")) {
          selLang.value = "en-US";
        } else {
          selLang.value = cur;
        }
      } else {
        selLang.value = (hasValue(cur) ? cur : "ja");
      }

      autoSizeSelect(selLang);
    }

    // Send mode
    const selSend = document.querySelector(".settings-modal #settingsSendMode");
    if (selSend) {
      const mode = state.settings?.sendMode || (localStorage.getItem("aurea_send_mode") || "cmdEnter");
      selSend.value = (mode === "enter") ? "enter" : "cmdEnter";
      autoSizeSelect(selSend);
    }

    // Data storage (dropdown)
    const dataNow = document.getElementById("dataStorageNow");
    const onLocal = (state.settings?.dataStorage === "local");

    if (dataNow) {
      dataNow.textContent = onLocal ? tr("dataNowLocal") : tr("dataNowCloud");
    }

    // Data storage (Cloud / Local) — use existing toggle buttons in index.html
    // Remove legacy injected select if it exists (prevents overlap)
    try {
      const sel = document.getElementById("dataStorageSelect");
      const wrap = document.getElementById("dataStorageWrap");
      if (sel) sel.remove();
      if (wrap) wrap.remove();
    } catch {}

    // show original buttons (in case they were hidden by older code)
    const btnCloud = document.getElementById("btnStorageCloud");
    const btnLocal = document.getElementById("btnStorageLocal");
    if (btnCloud) btnCloud.style.display = "";
    if (btnLocal) btnLocal.style.display = "";

    // active state
    if (btnCloud) btnCloud.classList.toggle("is-active", !onLocal);
    if (btnLocal) btnLocal.classList.toggle("is-active", onLocal);

    // Apps status
    const appCards = Array.from(document.querySelectorAll(".panel-apps .apps-grid .saas"));
    appCards.forEach((card) => {
      const nameEl = card.querySelector(".saas-name");
      const btn = card.querySelector(".status-btn");
      const name = (nameEl?.textContent || "").trim();
      if (!btn || !name) return;

      const isCustom = (Array.isArray(state.customApps) && state.customApps.some(a => a.name === name));
      const on = isCustom
        ? !!(state.customApps.find(a => a.name === name)?.connected)
        : !!state.apps?.[name];

      btn.classList.toggle("on", on);
      btn.classList.toggle("off", !on);
      btn.textContent = on ? tr("connected") : tr("notConnected");
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });

    applyTheme();
  };

const syncAccountUi = () => {
  const u = state.user || {};

  const safeText = (v) => String(v ?? "").trim();

  // ===== avatar (initials) =====
  const makeInitials = () => {
    const dn = safeText(u.displayName);
    const em = safeText(u.email);

    const src = dn || (em ? em.split("@")[0] : "");
    const s = src.replace(/[^A-Za-z0-9\u3040-\u30ff\u4e00-\u9faf]/g, "").trim();

    if (!s) return "--";

    // Latin: take first 2 chars uppercased
    const latin = s.match(/[A-Za-z0-9]/g);
    if (latin && latin.length) {
      const a = latin[0] || "";
      const b = latin[1] || "";
      return (a + b).toUpperCase();
    }

    // JP: take first 2 chars
    return s.slice(0, 2);
  };

  const avatarEl =
    document.querySelector("[data-user-avatar]")
    || document.querySelector(".user-card .avatar");

  if (avatarEl) avatarEl.textContent = makeInitials();

  // ===== sidebar user card =====
  const sbName =
    document.querySelector("[data-user-name]")
    || document.querySelector(".user-card .user-meta .name");

  const sbPlan =
    document.querySelector("[data-user-plan]")
    || document.querySelector(".user-card .user-meta .plan");

  const dnText = safeText(u.displayName) || "—";
  const planText = safeText(state.plan) || "Free";

  if (sbName) sbName.textContent = dnText;
  if (sbPlan) sbPlan.textContent = planText;

  // ===== user pop head =====
  const popName =
    document.querySelector(".user-pop .uhead .n")
    || document.querySelector(".user-pop [data-user-name]");

  const popMail =
    document.querySelector(".user-pop .uhead .m")
    || document.querySelector(".user-pop [data-user-email]");

  if (popName) popName.textContent = dnText;
  if (popMail) popMail.textContent = safeText(u.email) || "—";

  // ===== settings account inputs / fields =====
  const dn = document.getElementById("displayName");
  if (dn && u.displayName != null) dn.value = safeText(u.displayName);

  const planV = document.querySelector(".panel-account .section[aria-label='プラン'] .row .l .v");
  if (planV) planV.textContent = planText;

  const emailV =
    document.querySelector(".panel-account .section[aria-label='サインイン'] .row .l .v")
    || document.querySelector(".panel-account [data-user-email]");

  if (emailV) emailV.textContent = safeText(u.email) || "—";

  const devV =
    document.querySelector(".panel-account .section[aria-label='信頼できるデバイス'] .row .l .v")
    || document.querySelector(".panel-account [data-trusted-device]");

  if (devV) devV.textContent = u.deviceTrusted ? (safeText(u.trustedDevice) || "—") : "—";
};

const applyI18n = () => {
    const lang = state.settings?.language || "ja";
    const isEn = String(lang).toLowerCase().startsWith("en");

    // html lang も同期
    try { document.documentElement.lang = isEn ? "en" : "ja"; } catch {}

    const setText = (sel, text) => {
      const el = document.querySelector(sel);
      if (el && text != null) el.textContent = text;
    };

    // tr が未定義キーだと key を返すため、Settings周りはフォールバック辞書で確実に表示する
    const tt = (key, jaText, enText) => {
      const v = tr(key);
      if (v && v !== key) return v;
      return isEn ? enText : jaText;
    };

    // ===== Sidebar =====
    setText(".sb-item[data-nav='newChat'] .label", tt("newChat", "新しいチャット", "New chat"));
    setText(".sb-item[data-nav='images'] .label", tt("library", "ライブラリ", "Library"));

    const sbSearchBtn = document.getElementById("aureaSearchBtn");
    if (sbSearchBtn) sbSearchBtn.setAttribute("aria-label", tt("search", "検索", "Search"));

    // ===== Settings modal (embedded) =====
    setText(".settings-modal .nav-title", tt("settings", "設定", "Settings"));

    setText(".settings-modal label[for='tab-general'] .nav-txt", tt("general", "一般", "General"));
    setText(".settings-modal label[for='tab-apps'] .nav-txt", tt("apps", "アプリ", "Apps"));
    setText(".settings-modal label[for='tab-data'] .nav-txt", tt("data", "データ", "Data"));
    setText(".settings-modal label[for='tab-account'] .nav-txt", tt("accountSecurity", "アカウント・セキュリティ", "Account & security"));

    setText(".settings-modal .panel-general .content-title", tt("general", "一般", "General"));
    setText(".settings-modal .panel-apps .content-title", tt("apps", "アプリ", "Apps"));
    setText(".settings-modal .panel-data .content-title", tt("data", "データ", "Data"));
    setText(".settings-modal .panel-account .content-title", tt("accountSecurity", "アカウント・セキュリティ", "Account & security"));

    // Settings header sub（HTMLに直書きされがちな部分を上書き）
    setText(".settings-modal .panel-general .content-sub", isEn ? "Basic device settings" : "端末の基本的な設定");
    setText(".settings-modal .panel-apps .content-sub", isEn ? "Apps & connectors" : "アプリ連携");
    setText(".settings-modal .panel-data .content-sub", isEn ? "Data and storage" : "データと保存先");
    setText(".settings-modal .panel-account .content-sub", isEn ? "User information and security details" : "ユーザー情報とセキュリティ");

    // General rows labels（HTML直書き対策）
    setText(".settings-modal .panel-general .row:nth-of-type(1) .k", isEn ? "Theme" : "テーマ");
    setText(".settings-modal .panel-general .row:nth-of-type(2) .k", isEn ? "Language" : "言語");
    setText(".settings-modal .panel-general .row:nth-of-type(3) .k", isEn ? "Send mode" : "AUREAへの送信方法");

    // Apps: "SaaS 追加" button label
    const addBtn = document.querySelector(".settings-modal .panel-apps .apps-header .btn");
    if (addBtn) addBtn.innerHTML = `<i class="fa-solid fa-plus"></i> ${tt("addSaas", "SaaS 追加", "Add SaaS")}`;

    // Settings: language select aria
    const selLang = document.querySelector(".settings-modal #settingsLang");
    if (selLang) selLang.setAttribute("aria-label", isEn ? "Language" : "言語");

    // ===== AI Logs modal i18n =====
    const arTitle = document.getElementById("aureaAiReportsModalTitle");
    const arSub = document.getElementById("aureaAiReportsModalSub");
    if (arTitle) arTitle.textContent = isEn ? "AI Logs" : "AIログ";
    if (arSub) arSub.textContent = isEn ? "Model-level outputs" : "モデル別の生出力";

    // ===== AI Reports (Account > AI Stack) =====
    const arK = document.getElementById("settingsAiReportsLabel");
    const arV = document.getElementById("settingsAiReportsDesc");
    if (arK) arK.textContent = "AI Reports";
    if (arV) arV.textContent = isEn ? "Show model-level outputs" : "AI別レポートを表示";

    // Theme select options
    const themeSel = document.querySelector(".settings-modal #settingsTheme");
    if (themeSel) {
      Array.from(themeSel.options || []).forEach((o) => {
        const v = String(o.value || "").trim();
        if (v === "dark")   o.text = isEn ? "Dark" : "ダーク";
        if (v === "light")  o.text = isEn ? "Light" : "ライト";
        if (v === "system") o.text = isEn ? "System" : "システム";
      });
    }

    // Language select options
    if (selLang) {
      Array.from(selLang.options || []).forEach((o) => {
        const v = String(o.value || "").trim();
        if (v === "ja") o.text = isEn ? "Japanese" : "日本語";
        if (v === "en") o.text = isEn ? "English (US)" : "英語";
      });
    }

    // Send mode select options
    const sendSel = document.querySelector(".settings-modal #settingsSendMode");
    if (sendSel) {
      Array.from(sendSel.options || []).forEach((o) => {
        const v = String(o.value || "").trim();
        if (v === "cmdEnter") o.text = isEn ? "Send with ⌘ + Enter (Enter for newline)" : "⌘ + Enterで送信（Enterは改行）";
        if (v === "enter")    o.text = isEn ? "Send with Enter (Shift + Enter for newline)" : "Enterで送信（Shift + Enterで改行）";
      });
    }

    // Data storage dropdown options (cloud/local) — legacy
    const ds = document.getElementById("dataStorageSelect");
    if (ds) {
      Array.from(ds.options || []).forEach((o) => {
        const v = String(o.value || "").trim();
        if (v === "cloud") o.text = isEn ? "Cloud" : "クラウド";
        if (v === "local") o.text = isEn ? "On device" : "端末内";
      });
    }

    // Delete-all button label (Data panel)
    const delAll = document.getElementById("btnDeleteAllChats");
    if (delAll) delAll.textContent = isEn ? "Delete" : "削除";

    // ===== Regulations buttons inside Settings (Account tab) =====
    // data-legal を使っているボタンは label を強制上書きする（崩れ防止）
    const regTok = document.querySelector(".settings-modal [data-legal='tokusho']");
    const regTer = document.querySelector(".settings-modal [data-legal='terms']");
    const regPri = document.querySelector(".settings-modal [data-legal='privacy']");
    if (regTok) regTok.textContent = isEn ? "Legal Notice" : "特定商取引法に基づく表記";
    if (regTer) regTer.textContent = isEn ? "Terms of Service" : "利用規約";
    if (regPri) regPri.textContent = isEn ? "Privacy Policy" : "プライバシーポリシー";

    // ===== Search modal (popup) i18n =====
    const smInput = document.getElementById("aureaSearchModalInput");
    if (smInput) {
      smInput.placeholder = tt("search", "検索", "Search");
      smInput.setAttribute("aria-label", tt("search", "検索", "Search"));
    }

    // data-i18n / data-i18n-aria 全反映（HTML属性ベース）
    applyI18nAttrs();
  };

let suppressSettingsBackdropOnce = false;

const openSettings = async () => {
  const tabGeneral = document.getElementById("tab-general");
  if (tabGeneral) tabGeneral.checked = true;

  suppressSettingsBackdropOnce = true;

  settingsModal?.removeAttribute("hidden");
  settingsModal?.classList.add("is-open");
  body.style.overflow = "hidden";

  ensureAppsGrid();

  try {
    await refreshPlanFromServer();
  } catch {}

  // If user upgraded (Free -> Pro/Team/Enterprise) and cloud switch is pending,
  // route to Google connect when not connected. After connect, OAuth return handler
  // applies cloud mode automatically.
  try {
    const pending = localStorage.getItem("aurea_pending_storage_mode_v1");
    const planNow = String(state.plan || "Free").trim();
    const isFree = (planNow === "Free");
    const googleOn = !!state.apps?.Google;

    if (!isFree && pending === "cloud" && !googleOn) {
      const rt = encodeURIComponent(`${window.location.origin}/`);
      window.location.href = `/api/google/connect?returnTo=${rt}`;
      return;
    }
  } catch {}

  syncAccountUi();

  // i18n を先に反映してから、select幅の自動計算を走らせる
  applyI18n();
  syncSettingsUi();
};

    const chkAi = document.getElementById("settingsShowAiReports");
    if (chkAi) {
      chkAi.checked = state.settings?.showAiReports !== false;
    }

const closeSettings = () => {
  const ai = document.getElementById("aiStackOverlay");
  if (ai) ai.style.display = "none";

  settingsModal?.classList.remove("is-open");
  settingsModal?.setAttribute("hidden", "");
  body.style.overflow = "";
};

  // groups
  const projectGroup = $(".sb-group[data-group='projects']");
  const chatGroup = $(".sb-group[data-group='chats']");
  const projectList = projectGroup ? $(".group-body", projectGroup) : null;
  const chatList = chatGroup ? $(".group-body", chatGroup) : null;

  /* ================= AI Stack popup ================= */
  const btnOpenAiStackPopup = document.getElementById("btnOpenAiStackPopup");
  const btnCloseAiStackPopup = document.getElementById("btnCloseAiStackPopup");
  const aiStackOverlay = document.getElementById("aiStackOverlay");
  const aiStackPopupBody = document.getElementById("aiStackPopupBody");

  const AI_STACK_COND_KEY = "aurea_ai_stack_conditions_v1";

  const loadAiStackConditions = () => {
    try {
      const raw = localStorage.getItem(AI_STACK_COND_KEY);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      return (obj && typeof obj === "object") ? obj : {};
    } catch { return {}; }
  };

  const saveAiStackConditions = (map) => {
    try { localStorage.setItem(AI_STACK_COND_KEY, JSON.stringify(map || {})); } catch {}
  };

  // 表示用データ（最新版文字列 + 稼働条件）
  let AI_STACK = [
    { name: "GPT",        ver: "GPT-5.2",
      conditionJa: "総合監修・最終判断/回答提案",
      conditionEn: "Overall supervision / final decision & answer proposal"
    },
    { name: "Gemini",     ver: "Gemini 3",
      conditionJa: "大規模範囲の情報収集・マルチモーダル対応",
      conditionEn: "Large-scale research / multimodal support"
    },
    { name: "Claude",     ver: "Claude 4",
      conditionJa: "長文分析・構造/論点の洗い出し",
      conditionEn: "Long-form analysis / structure & issue mapping"
    },
    { name: "Perplexity", ver: "Latest version",
      conditionJa: "検証・裏取り・ハルシネーション対応",
      conditionEn: "Verification / fact-checking & hallucination mitigation"
    },
    { name: "Mistral",    ver: "Mistral Lange3,",
      conditionJa: "高速処理・軽量質疑対応",
      conditionEn: "Fast processing / lightweight Q&A"
    },
    { name: "Sora",       ver: "Sora 2",
      conditionJa: "画像生成時に稼働",
      conditionEn: "Active when generating images"
    }
  ];

  const syncAiStackHeader = () => {
    if (!aiStackOverlay) return;
    const headRow = aiStackOverlay.querySelector(".table__row--head");
    if (!headRow) return;

    headRow.innerHTML = `
      <div class="table__cell">${escHtml(tr("ai"))}</div>
      <div class="table__cell">${escHtml(tr("ver"))}</div>
      <div class="table__cell">${escHtml(tr("condition"))}</div>
    `;
  };

  // 最新バージョン取得（API接続時に自動反映）
  const refreshAiStackLatest = async () => {
    try {
      const ext = window.__AUREA_AI_STACK_LATEST__;
      if (ext && typeof ext === "object") {
        AI_STACK = AI_STACK.map(a => ({ ...a, ver: ext[a.name] || a.ver || "" }));
        return;
      }
    } catch {}
  };

  const renderAiStackPopup = () => {
    if (!aiStackPopupBody) return;

    // localStorage の上書きを反映（ユーザーが編集した稼働条件）
    const localCond = loadAiStackConditions();

    aiStackPopupBody.innerHTML = "";
    for (const a of AI_STACK) {
      const row = document.createElement("div");
      row.className = "table__row";

      const verText = (a.ver && String(a.ver).trim()) ? String(a.ver) : "";

      const defaultCond =
        ((state.settings?.language || "ja") === "en")
          ? String(a.conditionEn || "")
          : String(a.conditionJa || "");

      const condText = (localCond[a.name] != null) ? String(localCond[a.name]) : defaultCond;

      row.innerHTML = `
        <div class="table__cell">${escHtml(a.name)}</div>
        <div class="table__cell">${escHtml(verText)}</div>
        <div class="table__cell"><div class="ai-cond" contenteditable="true" data-ai="${escHtml(a.name)}">${escHtml(condText)}</div></div>
      `;

      aiStackPopupBody.appendChild(row);
    }

    // 編集内容を保存（localStorage）
    aiStackPopupBody.querySelectorAll(".ai-cond[contenteditable='true']").forEach((el) => {
      el.addEventListener("input", () => {
        const map = loadAiStackConditions();
        const key = el.getAttribute("data-ai") || "";
        map[key] = el.textContent || "";
        saveAiStackConditions(map);
      });
    });
  };

  const openAiStackPopup = async () => {
    await refreshAiStackLatest();
    syncAiStackHeader();
    renderAiStackPopup();
    if (aiStackOverlay) aiStackOverlay.style.display = "flex";
  };

  const closeAiStackPopup = () => {
    if (aiStackOverlay) aiStackOverlay.style.display = "none";
  };

btnOpenAiStackPopup?.addEventListener("click", (e) => {
  // GPT完全互換UI：AI Stackは無効
  e.preventDefault();
  return;
});

  btnCloseAiStackPopup?.addEventListener("click", (e) => {
    e.preventDefault();
    closeAiStackPopup();
  });

  // 背景クリックで閉じる（モーダル外のみ）
  aiStackOverlay?.addEventListener("click", (e) => {
    if (e.target === aiStackOverlay) closeAiStackPopup();
  });

  // ESCで閉じる（既存ESC処理に干渉しない）
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (aiStackOverlay && aiStackOverlay.style.display !== "none") closeAiStackPopup();
  });

  /* ================= AI reports modal (popup) ================= */
  let aiReportsModal = null;
  let aiReportsModalBody = null;
  let aiReportsModalBound = false;

  const isAiReportsModalOpen = () => {
    return !!aiReportsModal && aiReportsModal.style.display !== "none";
  };

  const closeAiReportsModal = () => {
    if (!aiReportsModal) return;
    aiReportsModal.style.display = "none";
    aiReportsModal.setAttribute("aria-hidden", "true");
    aiReportsModal.dataset.mid = "";
    if (aiReportsModalBody) aiReportsModalBody.innerHTML = "";
  };

  const parseReportsBlocks = (raw) => {
    const s = String(raw || "").replace(/\r/g, "");

    // "Reports:\n" が先頭でも途中でも拾う（前に改行が無いケース対策）
    const m = /(?:^|\n)Reports:\n/.exec(s);
    if (!m) return { head: s, blocks: [] };

    const idx = m.index + (m[0].startsWith("\n") ? 1 : 0); // "\n" を除いた位置
    const head = s.slice(0, idx);
    const tail = s.slice(idx + "Reports:\n".length);

    const lines = tail.split("\n");
    const blocks = [];
    let cur = null;

    const flush = () => {
      if (cur) {
        cur.body = (cur.body || []).join("\n").trim();
        blocks.push(cur);
        cur = null;
      }
    };

    for (const line of lines) {
      const m1 = /^---\s*(.+?)\s*---\s*$/.exec(line);
      if (m1) {
        flush();
        cur = { name: m1[1], body: [] };
        continue;
      }
      if (cur) cur.body.push(line);
    }
    flush();

    return { head, blocks };
  };

  const ensureAiReportsModal = () => {
    if (aiReportsModal) return aiReportsModal;

    aiReportsModal = document.createElement("div");
    aiReportsModal.id = "aureaAiReportsModal";
    aiReportsModal.setAttribute("aria-hidden", "true");
    aiReportsModal.style.cssText = `
      position:fixed; inset:0;
      display:none; align-items:center; justify-content:center;
      background:rgba(0,0,0,.45);
      z-index:10095;
      padding:18px;
    `;

    aiReportsModal.innerHTML = `
      <div style="
        width:min(980px, calc(100% - 24px));
        max-height:calc(100vh - 64px);
        background:rgba(20,21,22,.96);
        border:1px solid rgba(255,255,255,.10);
        border-radius:18px;
        box-shadow:0 10px 30px rgba(0,0,0,.45);
        overflow:hidden;
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        color:rgba(255,255,255,.92);
        font-family: -apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Hiragino Sans','Noto Sans JP',sans-serif;
        display:flex;
        flex-direction:column;
        min-width:0;
      ">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08);">
          <div style="min-width:0;">
            <div id="aureaAiReportsModalTitle" style="font-size:14px;font-weight:700;">AI Logs</div>
            <div id="aureaAiReportsModalSub" style="font-size:12px;opacity:.68;">AI Reports（モデル別の生出力）</div>
          </div>
          <button type="button" data-action="close" style="
            width:36px;height:36px;border-radius:12px;border:1px solid rgba(255,255,255,.12);
            background:rgba(255,255,255,.06);color:rgba(255,255,255,.92);
            cursor:pointer;font-size:18px;line-height:34px;flex:0 0 auto;
          ">×</button>
        </div>

        <div id="aureaAiReportsModalBody" style="padding:14px 16px;overflow:auto;min-height:0;flex:1 1 auto;"></div>
      </div>
    `;

    document.body.appendChild(aiReportsModal);
    aiReportsModalBody = document.getElementById("aureaAiReportsModalBody");

    if (!aiReportsModalBound) {
      aiReportsModalBound = true;

      aiReportsModal.addEventListener("click", (e) => {
        if (e.target === aiReportsModal) closeAiReportsModal();
      });

      aiReportsModal.addEventListener("click", (e) => {
        const t = e.target;
        if (t && t.closest && t.closest("[data-action='close']")) {
          e.preventDefault();
          closeAiReportsModal();
        }
      });

      document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (!isAiReportsModalOpen()) return;
        closeAiReportsModal();
      }, true);
    }

    return aiReportsModal;
  };

  const openAiReportsModal = (mid, rawContent) => {
    ensureAiReportsModal();
    if (!aiReportsModal || !aiReportsModalBody) return;

    const parsed = parseReportsBlocks(rawContent);
    const blocks = parsed.blocks || [];

    const detailsHtml = blocks.map((b) => {
      const nm = String(b.name || "").trim();
      const body = String(b.body || "").trim();
      const isClaude = (nm === "Claude");

      return `
        <details class="ai-report"${isClaude ? " open" : ""} style="
          border:1px solid rgba(255,255,255,.10);
          border-radius:14px;
          padding:10px 12px;
          background:rgba(255,255,255,.03);
          margin:0 0 10px;
        ">
          <summary style="
            cursor:pointer;
            font-size:13px;
            font-weight:700;
            color:rgba(255,255,255,.92);
            outline:none;
          ">${escHtml(nm)}</summary>

          <div style="
            margin-top:10px;
            font-size:12px;
            line-height:1.7;
            color:rgba(255,255,255,.86);
            white-space:pre-wrap;
            word-break:break-word;
          ">${escHtml(body)}</div>
        </details>
      `.trim();
    }).join("");

    aiReportsModalBody.innerHTML = detailsHtml || `<div style="opacity:.72;">No reports.</div>`;
    aiReportsModal.dataset.mid = String(mid || "");
    aiReportsModal.style.display = "flex";
    aiReportsModal.setAttribute("aria-hidden", "false");
  };

  /* ================= search popup (GPT-like) ================= */
  let sbSearchBtn = null;
  let searchModal = null;
  let searchModalInput = null;
  let searchModalList = null;
  let searchModalBound = false;

  const isSearchModalOpen = () => {
    return !!searchModal && searchModal.style.display !== "none";
  };

  const closeSearchModal = () => {
    if (!searchModal) return;
    searchModal.style.display = "none";
    searchModal.setAttribute("aria-hidden", "true");
  };

  const renderSearchModalResults = (q) => {
    if (!searchModalList) return;

    const query = (q || "").trim();
    const hits = searchAll(query);

    searchModalList.innerHTML = "";

    if (!query) return;

    if (hits.length === 0) {
      const empty = document.createElement("div");
      empty.className = "images-empty";
      empty.textContent = (state.settings?.language === "en") ? "No results." : "一致する項目がありません。";
      searchModalList.appendChild(empty);
      return;
    }

    for (const h of hits) {
      const projName = h.scopeType === "project"
        ? (state.projects.find(p => p.id === h.projectId)?.name || tr("project"))
        : tr("chat");

      const meta = h.scopeType === "project"
        ? `${tr("project")}: ${projName}`
        : tr("global");

      const card = document.createElement("div");
      card.className = "search-card";
      card.dataset.threadId = h.threadId;
      card.dataset.scopeType = h.scopeType;
      card.dataset.projectId = h.projectId || "";

      card.innerHTML = `
        <div class="top">
          <div class="ttl">${escHtml(h.threadTitle)}</div>
          <div class="meta">${escHtml(meta)}</div>
        </div>
        <div class="snip">${escHtml(h.snippet || "")}</div>
      `;

      searchModalList.appendChild(card);
    }
  };

  const ensureSearchModal = () => {
    if (searchModal) return searchModal;

    searchModal = document.createElement("div");
    searchModal.id = "aureaSearchModal";
    searchModal.setAttribute("aria-hidden", "true");
    searchModal.style.cssText = `
      position:fixed; inset:0;
      display:none; align-items:center; justify-content:center;
      background:rgba(0,0,0,.45);
      z-index:10070;
      padding:18px;
    `;

    searchModal.innerHTML = `
      <div style="
        width:min(860px, calc(100% - 24px));
        max-height:calc(100vh - 64px);
        background:rgba(20,21,22,.96);
        border:1px solid rgba(255,255,255,.10);
        border-radius:18px;
        box-shadow:0 10px 30px rgba(0,0,0,.45);
        overflow:hidden;
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        color:rgba(255,255,255,.92);
        font-family: -apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Hiragino Sans','Noto Sans JP',sans-serif;
        display:flex;
        flex-direction:column;
        min-width:0;
      ">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08);">
          <div style="font-size:14px;font-weight:600;">${escHtml(tr("search"))}</div>
          <button type="button" data-action="close" style="
            width:36px;height:36px;border-radius:12px;border:1px solid rgba(255,255,255,.12);
            background:rgba(255,255,255,.06);color:rgba(255,255,255,.92);
            cursor:pointer;font-size:18px;line-height:34px;
          ">×</button>
        </div>

        <div style="padding:14px 16px 12px;">
          <input id="aureaSearchModalInput" type="search" placeholder="${escHtml(tr("search"))}" aria-label="${escHtml(tr("search"))}" style="
            width:100%;
            height:40px;
            border-radius:12px;
            border:1px solid rgba(255,255,255,.12);
            background:rgba(255,255,255,.05);
            color:rgba(255,255,255,.92);
            outline:none;
            padding:0 12px;
            font-size:13px;
          "/>
        </div>

        <div style="padding:0 16px 16px; min-height:0; flex:1 1 auto; overflow:auto;">
          <div id="aureaSearchModalResults" class="search-results"></div>
        </div>
      </div>
    `;

    document.body.appendChild(searchModal);

    searchModalInput = document.getElementById("aureaSearchModalInput");
    searchModalList = document.getElementById("aureaSearchModalResults");

    if (!searchModalBound) {
      searchModalBound = true;

      searchModal.addEventListener("click", (e) => {
        if (e.target === searchModal) closeSearchModal();
      });

      searchModal.addEventListener("click", (e) => {
        const t = e.target;

        if (t.closest("[data-action='close']")) {
          e.preventDefault();
          closeSearchModal();
          return;
        }

        const card = t.closest(".search-card");
        if (card && card.dataset.threadId) {
          e.preventDefault();
          openThreadFromSearchHit({
            scopeType: card.dataset.scopeType,
            projectId: card.dataset.projectId || null,
            threadId: card.dataset.threadId
          });
          closeSearchModal();
          return;
        }
      });

      document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (!isSearchModalOpen()) return;
        closeSearchModal();
      }, true);
    }

    if (searchModalInput) {
      searchModalInput.addEventListener("input", () => {
        renderSearchModalResults(searchModalInput.value || "");
      });
    }

    return searchModal;
  };

  const openSearchModal = () => {
    ensureSearchModal();

    if (searchModalInput) {
      searchModalInput.value = "";
      renderSearchModalResults("");
    }

    searchModal.style.display = "flex";
    searchModal.setAttribute("aria-hidden", "false");

    setTimeout(() => {
      try { searchModalInput?.focus(); } catch {}
    }, 0);
  };

  /* ================= sidebar search mount (icon only) ================= */
  const mountSidebarSearch = () => {
    if (!sidebar) return;

    const sbTop = sidebar.querySelector(".sb-top");
    if (!sbTop) return;

    // 既に存在する場合は何もしない（再生成しない）
    if (sbTop.querySelector("#aureaSearchBtn")) return;

    const wrap = document.createElement("div");
    wrap.className = "sb-search";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "aureaSearchBtn";
    btn.className = "sb-searchbtn";
    btn.setAttribute("aria-label", tr("search"));
    btn.innerHTML = `<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>`;

    sbSearchBtn = btn;

    wrap.appendChild(btn);
    sbTop.insertBefore(wrap, sbTop.firstChild);

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      openSearchModal();
    });
  };

  /* ================= scope helpers ================= */
  const getThreadsForContext = () => {
    if (state.context?.type === "project") {
      const pid = state.context.projectId;
      if (!state.threads.projects[pid]) state.threads.projects[pid] = [];
      return state.threads.projects[pid];
    }
    return state.threads.global;
  };

  const getActiveThreadId = () => {
    if (state.context?.type === "project") {
      return state.activeThreadIdByScope.projects[state.context.projectId] || null;
    }
    return state.activeThreadIdByScope.global;
  };

  const setActiveThreadId = (tid) => {
    if (state.context?.type === "project") {
      state.activeThreadIdByScope.projects[state.context.projectId] = tid;
    } else {
      state.activeThreadIdByScope.global = tid;
    }
    save(state);
  };

  const getThreadByIdInContext = (tid) => {
    const threads = getThreadsForContext();
    return threads.find(t => t.id === tid) || null;
  };

  // 互換用：旧コードが呼んでも落ちないように「今のcontext内」で探す
  const getThreadByIdInScope = (tid) => {
    return getThreadByIdInContext(tid);
  };

  const ensureActiveThread = () => {
    const threads = getThreadsForContext();
    const tid = getActiveThreadId();
    if (!tid || !threads.some(t => t.id === tid)) {
      setActiveThreadId(null);
    }
  };

    /* ================= attachments (Ask bar) ================= */
  let pendingAttachments = []; // [{ id, file, name, size, mime, kind, dataUrl? }]
    const clearPendingAttachments = () => {
    pendingAttachments = [];
    try { renderAttachTray(); } catch {}
  };

  let attachTrayEl = null;
  let attachModalEl = null;
  let attachModalBound = false;

  const bytesToHuman = (n) => {
    const v = Number(n || 0);
    if (!v) return "0 B";
    const u = ["B","KB","MB","GB"];
    const i = Math.min(u.length - 1, Math.floor(Math.log(v) / Math.log(1024)));
    const num = v / Math.pow(1024, i);
    return `${num.toFixed(i === 0 ? 0 : (i === 1 ? 1 : 2))} ${u[i]}`;
  };

  const ensureAttachTray = () => {
    // 1) 通常チャット（.ask）
    const ask = document.querySelector(".ask");
    const askInput = document.querySelector(".ask .in");

    // 2) PJトップ（#aureaProjectHomeAsk のある .pj-home-askbar）
    const pjAskInput = document.getElementById("aureaProjectHomeAsk");
    const pjBar = pjAskInput ? pjAskInput.closest(".pj-home-askbar") : null;

    // ===== Ask 内レイアウトを崩さず「添付→入力→ボタン」を固定するためのラップ =====
    const ensureAskWrap = (root, rowClass, flagKey) => {
      if (!root) return null;
      if (root.dataset[flagKey] === "1") return root.querySelector(`.${rowClass}`) || null;

      const row = document.createElement("div");
      row.className = rowClass;

      // 既存の子要素を row に移動（順序維持）
      while (root.firstChild) row.appendChild(root.firstChild);

      root.appendChild(row);
      root.dataset[flagKey] = "1";
      return row;
    };

    let anchorInput = null;
    let trayHost = null;
    let row = null;

    if (pjBar && pjAskInput) {
      // PJトップ：pj-home-askbar を縦積みにして、添付を input の上へ
      row = ensureAskWrap(pjBar, "pj-home-askrow", "aureaAttachWrapped");
      anchorInput = pjAskInput;
      trayHost = pjBar;
    } else if (ask && askInput) {
      // 通常：ask を縦積みにして、添付を textarea の上へ
      row = ensureAskWrap(ask, "ask-row", "aureaAttachWrapped");
      anchorInput = askInput;
      trayHost = ask;
    } else {
      return null;
    }

    // 既存トレイがあれば「今の画面の input 直前」に移動
    if (attachTrayEl) {
      try {
        if (trayHost && attachTrayEl.parentElement !== trayHost) {
          trayHost.insertBefore(attachTrayEl, row || trayHost.firstChild);
        }
        if (trayHost && attachTrayEl.nextSibling !== (row || null)) {
          trayHost.insertBefore(attachTrayEl, row || trayHost.firstChild);
        }
      } catch {}
      return attachTrayEl;
    }

    const tray = document.createElement("div");
    tray.id = "aureaAttachTray";
    tray.style.cssText = `
      width:100%;
      display:none;
      gap:8px;
      align-items:center;
      justify-content:flex-start;
      flex-wrap:nowrap;
      overflow-x:auto;
      padding:0 2px 8px;
      box-sizing:border-box;
      pointer-events:auto;
    `;

    // 添付は「row（入力＋ボタン）」の “上” に差し込む
    if (trayHost) trayHost.insertBefore(tray, row || trayHost.firstChild);
    else document.body.appendChild(tray);

    attachTrayEl = tray;
    return tray;
  };

  let attachFxInjected = false;

  const ensureAttachFx = () => {
    if (attachFxInjected) return;
    attachFxInjected = true;

    const st = document.createElement("style");
    st.setAttribute("data-aurea-attach-fx", "1");
    st.textContent = `
      @keyframes aureaBorderRun {
        to { stroke-dashoffset: -160; }
      }

      .aurea-attach-chip[data-state="analyzing"]{
        position:relative;
        pointer-events:none;
        opacity:.95;
      }

      .aurea-attach-chip[data-state="analyzing"]::after{
        content:"";
        position:absolute;
        inset:4px;
        border-radius:16px;
        pointer-events:none;
        background:
          url("data:image/svg+xml;utf8,
          <svg xmlns='http://www.w3.org/2000/svg' width='100%' height='100%' viewBox='0 0 100 100' preserveAspectRatio='none'>
            <rect
              x='2' y='2' width='96' height='96' rx='14' ry='14'
              fill='none'
              stroke='rgba(255,255,255,0.85)'
              stroke-width='2'
              stroke-linecap='round'
              stroke-dasharray='6 10'
            />
          </svg>") no-repeat center / 100% 100%;
        -webkit-mask:
          url("data:image/svg+xml;utf8,
          <svg xmlns='http://www.w3.org/2000/svg' width='100%' height='100%' viewBox='0 0 100 100' preserveAspectRatio='none'>
            <rect
              x='2' y='2' width='96' height='96' rx='14' ry='14'
              fill='none'
              stroke='white'
              stroke-width='2'
              stroke-linecap='round'
              stroke-dasharray='6 10'
            />
          </svg>") no-repeat center / 100% 100%;
        animation:aureaBorderRun 1.8s linear infinite;
      }
    `.trim();

    document.head.appendChild(st);
  };

  const renderAttachTray = () => {
    ensureAttachFx();

    const tray = ensureAttachTray();
    if (!tray) return;

    tray.innerHTML = "";

    const askEl = document.querySelector(".ask");
    if (askEl) {
      if (pendingAttachments.length) askEl.setAttribute("data-attach", "1");
      else askEl.removeAttribute("data-attach");
    }

    if (!pendingAttachments.length) {
      tray.style.display = "none";
      return;
    }

    tray.style.display = "flex";

    for (const a of pendingAttachments) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "aurea-attach-chip";
      chip.dataset.aid = a.id;

      // 送信中＝解析中の点線エフェクト
      if (attachLocked) chip.dataset.state = "analyzing";
      else delete chip.dataset.state;

      const isSingle = (pendingAttachments.length === 1);

      chip.style.cssText = `
        flex:0 0 auto;
        border:0;
        background:transparent;
        color:rgba(255,255,255,.92);
        cursor:pointer;
        padding:0;
        display:flex;
        align-items:center;
        gap:0;
        font-size:12px;
        line-height:1;
        font-family:var(--font);
        max-width:${isSingle ? "520px" : "260px"};
      `;

      const name = String(a.name || "file").trim();

      const lower = String(a.name || "").toLowerCase();
      const routeRaw = String(a.route || "").trim();
      const isImg = routeRaw === "image" || String(a.kind || "") === "image";
      const isPdf = routeRaw === "pdf" || (String(a.mime || "") === "application/pdf") || lower.endsWith(".pdf");
      const isCsv = routeRaw === "text" && ((String(a.mime || "") === "text/csv") || lower.endsWith(".csv"));

      const routeLabel = isImg ? "IMG" : (isPdf ? "PDF" : (isCsv ? "CSV" : (routeRaw === "text" ? "TXT" : "FILE")));
      const fallback = String(a.fallback || "").trim();
      const metaBase = `${routeLabel} · ${bytesToHuman(a.size)}${a.mime ? ` · ${a.mime}` : ""}`;
      const meta = fallback ? `${metaBase} · ${fallback}` : metaBase;

      const imgW = isSingle ? 160 : 44;
      const imgH = isSingle ? 100 : 44;
      const imgR = isSingle ? 12 : 10;

      const thumb = (isImg && a.dataUrl)
        ? `<img src="${escHtml(a.dataUrl)}" alt="" style="width:${imgW}px;height:${imgH}px;border-radius:${imgR}px;object-fit:cover;border:0;background:transparent;" />`
        : isPdf
          ? `<span aria-hidden="true" style="width:${isSingle ? 72 : 44}px;height:${isSingle ? 44 : 44}px;border-radius:${imgR}px;display:inline-flex;align-items:center;justify-content:center;border:0;background:transparent;color:rgba(255,255,255,.92);font-size:10px;font-weight:700;letter-spacing:.04em;">PDF</span>`
          : `<span aria-hidden="true" style="width:${imgW}px;height:${imgH}px;border-radius:${imgR}px;display:inline-flex;align-items:center;justify-content:center;border:0;background:transparent;opacity:.85;">📄</span>`;

      // GPT-like: preview only (no filename / no meta)
      chip.innerHTML = `
        <span style="position:relative;display:inline-block;">
          ${thumb}
          <span data-action="remove" aria-label="remove" style="
            position:absolute;
            top:${isSingle ? "6px" : "4px"};
            right:${isSingle ? "6px" : "4px"};
            width:${isSingle ? "26px" : "22px"};
            height:${isSingle ? "26px" : "22px"};
            display:inline-flex;
            align-items:center;
            justify-content:center;
            border-radius:999px;
            border:1px solid rgba(255,255,255,.14);
            background:rgba(0,0,0,.28);
            color:rgba(255,255,255,.92);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
          ">×</span>
        </span>
      `;

      const rm = chip.querySelector("[data-action='remove']");
      if (rm) {
        rm.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (attachLocked) return;
          removeAttachmentById(a.id);
        });
      }

      chip.addEventListener("click", (e) => {
        e.preventDefault();
        if (attachLocked) return;
        openAttachModal(a);
      });

      tray.appendChild(chip);
    }
  };

  const ensureAttachModal = () => {
    if (attachModalEl) return attachModalEl;

    const wrap = document.createElement("div");
    wrap.id = "aureaAttachModal";
    wrap.setAttribute("aria-hidden", "true");
    wrap.style.cssText = `
      position:fixed; inset:0;
      display:none; align-items:center; justify-content:center;
      background:rgba(0,0,0,.45);
      z-index:10090;
      padding:18px;
    `;

    wrap.innerHTML = `
      <div style="
        width:min(860px, calc(100% - 24px));
        max-height:calc(100vh - 64px);
        background:rgba(20,21,22,.96);
        border:1px solid rgba(255,255,255,.10);
        border-radius:18px;
        box-shadow:0 10px 30px rgba(0,0,0,.45);
        overflow:hidden;
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        color:rgba(255,255,255,.92);
        font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Hiragino Sans','Noto Sans JP',sans-serif;
        display:flex;
        flex-direction:column;
        min-width:0;
      ">
        <div style="
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:10px;
          padding:14px 16px;
          border-bottom:1px solid rgba(255,255,255,.08);
        ">
          <div id="aureaAttachModalTitle" style="min-width:0;font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>
          <button type="button" data-action="close" style="
            width:36px;height:36px;border-radius:12px;border:1px solid rgba(255,255,255,.12);
            background:rgba(255,255,255,.06);color:rgba(255,255,255,.92);
            cursor:pointer;font-size:18px;line-height:34px;flex:0 0 auto;
          ">×</button>
        </div>

        <div id="aureaAttachModalBody" style="padding:14px 16px;overflow:auto;min-height:0;flex:1 1 auto;"></div>

        <div style="padding:12px 16px;border-top:1px solid rgba(255,255,255,.08);display:flex;justify-content:flex-end;">
          <button type="button" data-action="remove" style="
            height:34px;padding:0 12px;border-radius:12px;border:1px solid rgba(255,255,255,.12);
            background:rgba(255,80,80,.12);color:rgba(255,255,255,.92);
            cursor:pointer;font-size:13px;
          ">Remove</button>
        </div>
      </div>
    `;

    document.body.appendChild(wrap);
    attachModalEl = wrap;

    if (!attachModalBound) {
      attachModalBound = true;

      wrap.addEventListener("click", (e) => {
        if (e.target === wrap) closeAttachModal();
      });

      wrap.addEventListener("click", (e) => {
        const t = e.target;

        if (t && t.closest && t.closest("[data-action='close']")) {
          e.preventDefault();
          closeAttachModal();
          return;
        }

        if (t && t.closest && t.closest("[data-action='remove']")) {
          e.preventDefault();
          const aid = wrap.dataset.aid || "";
          if (aid) removeAttachmentById(aid);
          closeAttachModal();
          return;
        }
      });

      document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (!isAttachModalOpen()) return;
        closeAttachModal();
      }, true);
    }

    return wrap;
  };

  const isAttachModalOpen = () => {
    return !!attachModalEl && attachModalEl.style.display !== "none";
  };

  const closeAttachModal = () => {
    if (!attachModalEl) return;
    attachModalEl.style.display = "none";
    attachModalEl.setAttribute("aria-hidden", "true");
    attachModalEl.dataset.aid = "";
  };

  const openAttachModal = (att) => {
    ensureAttachModal();
    if (!attachModalEl) return;

    const isEn = ((state.settings?.language || "ja") === "en");
    const titleEl = document.getElementById("aureaAttachModalTitle");
    const bodyEl = document.getElementById("aureaAttachModalBody");

    const name = String(att?.name || "file");
    const mime = String(att?.mime || "");
    const size = bytesToHuman(att?.size || 0);

    if (titleEl) titleEl.textContent = name;
    if (bodyEl) {
      const isImg = String(att?.kind || "") === "image";
      const preview = isImg && att?.dataUrl
        ? `<img src="${escHtml(att.dataUrl)}" alt="image" style="max-width:100%;border-radius:14px;border:0;background:transparent;box-shadow:none;" />`
        : `<div style="opacity:.72;">${escHtml(isEn ? "Preview not available." : "プレビューは利用できません。")}</div>`;

      bodyEl.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div style="font-size:12px;opacity:.72;">${escHtml(mime ? `${mime} · ${size}` : size)}</div>
          ${preview}
        </div>
      `;
    }

    attachModalEl.dataset.aid = String(att?.id || "");
    attachModalEl.style.display = "flex";
    attachModalEl.setAttribute("aria-hidden", "false");
  };

  const removeAttachmentById = (aid) => {
    const id = String(aid || "");
    if (!id) return;
    pendingAttachments = pendingAttachments.filter(a => a.id !== id);
    renderAttachTray();
    updateSendButtonVisibility();
  };

  const sniffKind = (mime, name) => {
    const m = String(mime || "").toLowerCase();
    if (m.startsWith("image/")) return "image";
    const n = String(name || "").toLowerCase();
    if (/\.(png|jpg|jpeg|webp|gif|bmp|svg)$/.test(n)) return "image";
    return "file";
  };

  /* ================= attach import progress (GPT-like) ================= */
  let attachImportTick = null;
  let attachImporting = false;

  const ensureAttachImportPill = () => {
    let el = document.getElementById("aureaAttachImportPill");
    if (el) return el;

    el = document.createElement("div");
    el.id = "aureaAttachImportPill";
    el.style.cssText = `
      position:fixed;
      left:50%;
      bottom:92px;
      transform:translateX(-50%);
      z-index:10040;
      display:none;
      align-items:center;
      gap:10px;
      padding:10px 12px;
      border-radius:999px;
      border:1px solid rgba(255,255,255,.12);
      background:rgba(20,21,22,.86);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      color:rgba(255,255,255,.92);
      font-size:12px;
      font-family: -apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Hiragino Sans','Noto Sans JP',sans-serif;
      max-width:min(520px, calc(100% - 24px));
    `;

    el.innerHTML = `
      <div style="min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">ファイルを取り込み中</div>
      <div style="font-variant-numeric:tabular-nums;opacity:.85;" data-pct>0%</div>
      <div style="width:160px;height:6px;border-radius:999px;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.10);overflow:hidden;">
        <div data-bar style="width:0%;height:100%;border-radius:999px;background:rgba(255,255,255,.65);"></div>
      </div>
    `;

    document.body.appendChild(el);
    return el;
  };

  const startAttachImportPill = () => {
    const el = ensureAttachImportPill();
    const pctEl = el.querySelector("[data-pct]");
    const barEl = el.querySelector("[data-bar]");
    if (pctEl) pctEl.textContent = "0%";
    if (barEl) barEl.style.width = "0%";
    el.style.display = "flex";

    let p = 0;
    try { clearInterval(attachImportTick); } catch {}
    attachImportTick = setInterval(() => {
      p = Math.min(90, p + (p < 60 ? 6 : 2));
      if (pctEl) pctEl.textContent = `${p}%`;
      if (barEl) barEl.style.width = `${p}%`;
      if (p >= 90) {
        try { clearInterval(attachImportTick); } catch {}
        attachImportTick = null;
      }
    }, 220);
  };

  const finishAttachImportPill = () => {
    const el = ensureAttachImportPill();
    const pctEl = el.querySelector("[data-pct]");
    const barEl = el.querySelector("[data-bar]");
    if (pctEl) pctEl.textContent = "100%";
    if (barEl) barEl.style.width = "100%";

    setTimeout(() => {
      el.style.display = "none";
    }, 450);

    try { clearInterval(attachImportTick); } catch {}
    attachImportTick = null;
  };

  /* ================= streaming progress pill (analysis / generating) ================= */
  let streamProgressTick = null;
  let streamProgressP = 0;

  const ensureStreamProgressPill = () => {
    let el = document.getElementById("aureaStreamProgressPill");
    if (el) return el;

    // shimmer style (one-time)
    if (!document.getElementById("aureaStreamProgressFx")) {
      const st = document.createElement("style");
      st.id = "aureaStreamProgressFx";
      st.textContent = `
        @keyframes aureaShimmerSweep {
          0%   { transform: translateX(-120%); opacity: 0; }
          12%  { opacity: 1; }
          100% { transform: translateX(140%); opacity: 0; }
        }

        #aureaStreamProgressPill .aurea-streamtxt{
          position:relative;
          display:inline-block;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
          max-width:300px;
          letter-spacing:-.1px;
          opacity:.92;
          text-shadow:
            0 0 10px rgba(159,180,255,.22),
            0 0 22px rgba(159,180,255,.14);
        }

        #aureaStreamProgressPill .aurea-streamtxt::after{
          content:"";
          position:absolute;
          top:50%;
          left:-120%;
          width:92px;
          height:2px;
          transform:translateY(-50%);
          background:linear-gradient(90deg,
            rgba(255,255,255,0) 0%,
            rgba(159,180,255,.92) 40%,
            rgba(255,255,255,0) 100%
          );
          filter: blur(.25px);
          animation:aureaShimmerSweep 1.05s linear infinite;
          opacity:.95;
          pointer-events:none;
        }
      `.trim();
      document.head.appendChild(st);
    }

    el = document.createElement("div");
    el.id = "aureaStreamProgressPill";
    el.style.cssText = `
      position:absolute;
      top:-44px;
      left:14px;

      display:none;
      align-items:center;
      padding:0;
      border-radius:0;
      border:0;
      background:transparent;
      backdrop-filter:none;
      -webkit-backdrop-filter:none;
      color:rgba(255,255,255,.92);
      font-size:12px;
      font-family: -apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Hiragino Sans','Noto Sans JP',sans-serif;
      pointer-events:none;
      max-width:340px;
      z-index:2;
    `;

    el.innerHTML = `
      <div data-title class="aurea-streamtxt">解析中...</div>
    `;

    // Ask左上に固定（Askが無い場合のみ body に退避）
    const ask = document.querySelector(".ask");
    if (ask) {
      ask.style.position = "relative";
      ask.appendChild(el);
    } else {
      document.body.appendChild(el);
    }

    return el;
  };

  const startStreamProgressPill = () => {
    const el = ensureStreamProgressPill();
    const titleEl = el.querySelector("[data-title]");

    const isEn = ((state.settings?.language || "ja") === "en");
    const mode = String(window.__AUREA_STREAMING_LABEL_MODE__ || "analyzing");

    if (titleEl) {
      titleEl.textContent =
        (mode === "generating")
          ? (isEn ? "Generating..." : "回答文作成中...")
          : (isEn ? "Analyzing..." : "解析中...");
    }

    el.style.display = "flex";

    // 旧％タイマーは不要
    try { clearInterval(streamProgressTick); } catch {}
    streamProgressTick = null;
    streamProgressP = 0;
  };

  const finishStreamProgressPill = () => {
    const el = document.getElementById("aureaStreamProgressPill");
    if (!el) return;

    el.style.display = "none";

    try { clearInterval(streamProgressTick); } catch {}
    streamProgressTick = null;
    streamProgressP = 0;
  };

  const fileToDataUrl = (file) => new Promise((resolve) => {

    // drag&drop / スクショ貼り付け系で FileReader が空を返すケースの保険を入れる
    const inferMimeFromName = (name) => {
      const n = String(name || "").toLowerCase();
      if (n.endsWith(".png")) return "image/png";
      if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
      if (n.endsWith(".webp")) return "image/webp";
      if (n.endsWith(".gif")) return "image/gif";
      if (n.endsWith(".bmp")) return "image/bmp";
      if (n.endsWith(".svg")) return "image/svg+xml";
      if (n.endsWith(".pdf")) return "application/pdf";
      if (n.endsWith(".csv")) return "text/csv";
      if (n.endsWith(".md")) return "text/markdown";
      if (n.endsWith(".html") || n.endsWith(".htm")) return "text/html";
      if (n.endsWith(".txt")) return "text/plain";
      return "";
    };

    const arrayBufferToBase64 = (ab) => {
      try {
        const bytes = new Uint8Array(ab || new ArrayBuffer(0));
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(binary);
      } catch {
        return "";
      }
    };

    const tryFallback = async () => {
      try {
        const ab = await file.arrayBuffer();
        const b64 = arrayBufferToBase64(ab);
        if (!b64) return "";

        const mime0 = String(file?.type || "").trim();
        const mime = mime0 || inferMimeFromName(file?.name || "") || "application/octet-stream";
        return `data:${mime};base64,${b64}`;
      } catch {
        return "";
      }
    };

    try {
      const fr = new FileReader();
      fr.onload = async () => {
        const out = String(fr.result || "").trim();
        if (out) {
          resolve(out);
          return;
        }
        const fb = await tryFallback();
        resolve(fb);
      };
      fr.onerror = async () => {
        const fb = await tryFallback();
        resolve(fb);
      };
      fr.readAsDataURL(file);
    } catch {
      // last fallback
      tryFallback().then(resolve).catch(() => resolve(""));
    }
  });

    // thumbnail (for UI + history only; keep tiny to avoid localStorage overflow)
  const fileToThumbDataUrl = async (file) => {
    try {
      const dataUrl = await fileToDataUrl(file);
      if (!dataUrl || !String(dataUrl).startsWith("data:image/")) return "";

      const img = new Image();
      img.decoding = "async";

      const loaded = await new Promise((resolve) => {
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = dataUrl;
      });
      if (!loaded) return "";

      const MAX_W = 320;
      const MAX_H = 320;

      const w0 = Number(img.naturalWidth || img.width || 0) || 0;
      const h0 = Number(img.naturalHeight || img.height || 0) || 0;
      if (!w0 || !h0) return "";

      const scale = Math.min(1, MAX_W / w0, MAX_H / h0);
      const w = Math.max(1, Math.round(w0 * scale));
      const h = Math.max(1, Math.round(h0 * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext("2d");
      if (!ctx) return "";

      ctx.drawImage(img, 0, 0, w, h);

      // JPEG to keep it small (preview only)
      return canvas.toDataURL("image/jpeg", 0.82);
    } catch {
      return "";
    }
  };

  const addFilesAsAttachments = async (files) => {
    const list = Array.from(files || []).filter(f => f && typeof f.size === "number");
    if (!list.length) return;

    const inferMimeFromName = (name) => {
      const n = String(name || "").toLowerCase();
      if (n.endsWith(".png")) return "image/png";
      if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
      if (n.endsWith(".webp")) return "image/webp";
      if (n.endsWith(".gif")) return "image/gif";
      if (n.endsWith(".bmp")) return "image/bmp";
      if (n.endsWith(".svg")) return "image/svg+xml";
      if (n.endsWith(".pdf")) return "application/pdf";
      if (n.endsWith(".csv")) return "text/csv";
      if (n.endsWith(".md")) return "text/markdown";
      if (n.endsWith(".html") || n.endsWith(".htm")) return "text/html";
      if (n.endsWith(".txt")) return "text/plain";
      return "";
    };

    attachImporting = true;
    startAttachImportPill();
    try { renderAttachTray(); } catch {}

    try {
      for (const f of list) {
        const name = String(f.name || "file").trim();

        // drag&drop で type が空になるケースがあるため補完
        const mime0 = String(f.type || "").trim();
        const mime = mime0 || inferMimeFromName(name);

        const kind = sniffKind(mime, name);

        // v1: image + small text files (txt/md/csv) keep dataUrl for payload/preview
        let dataUrl = "";

        const lower = name.toLowerCase();
        const isTextLike =
          mime.startsWith("text/") ||
          mime === "text/csv" ||
          mime === "text/html" ||
          lower.endsWith(".txt") ||
          lower.endsWith(".md") ||
          lower.endsWith(".csv") ||
          lower.endsWith(".html") ||
          lower.endsWith(".htm");

        if (kind === "image") {
          // 8MB上限（送信は元File bytes / 保存はサムネだけ）
          if ((f.size || 0) <= (8 * 1024 * 1024)) {
            dataUrl = await fileToThumbDataUrl(f);
          }
        } else if (isTextLike) {
          // 512KB上限（即解析用：テキストはそのまま）
          if ((f.size || 0) <= (512 * 1024)) {
            dataUrl = await fileToDataUrl(f);
          }
        }

        const isPdf = (mime === "application/pdf") || lower.endsWith(".pdf");
        const route = (kind === "image") ? "image" : (isPdf ? "pdf" : (isTextLike ? "text" : "file"));

        let fallback = "";
        if (route === "text" && !dataUrl && (f.size || 0) > (512 * 1024)) fallback = "text_too_large_for_preview";
        if (route === "image" && !dataUrl) fallback = "no_preview_data";
        if (route === "pdf") fallback = ""; // pdfはプレビュー不要

        pendingAttachments.push({
          id: uid(),
          file: f,
          name,
          size: f.size || 0,
          mime,
          kind,
          route,
          fallback,
          dataUrl
        });
      }
    } finally {
      attachImporting = false;
      try { renderAttachTray(); } catch {}
      finishAttachImportPill();
    }

    renderAttachTray();
  };

  const openFilePickerForAttachments = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "*/*";
    input.style.display = "none";
    document.body.appendChild(input);

    input.addEventListener("change", async () => {
      const files = input.files;
      document.body.removeChild(input);
      await addFilesAsAttachments(files);
    });

    input.click();
  };

  let attachLocked = false;

  const takePendingAttachments = () => {
    // GPT同様：送信した瞬間に Ask から添付を消す（添付はユーザーメッセージ側に移る）
    const out = pendingAttachments.slice();

    attachLocked = false;
    pendingAttachments = [];

    try { renderAttachTray(); } catch {}
    try { updateSendButtonVisibility(); } catch {}

    return out;
  };

  const unlockAndClearAttachments = () => {
    attachLocked = false;
    pendingAttachments = [];
    try { renderAttachTray(); } catch {}
    try { updateSendButtonVisibility(); } catch {}
  };

  const buildAttachmentsPayload = async (atts) => {
    const src = Array.isArray(atts) ? atts : [];
    const out = [];

    const arrayBufferToBase64 = (ab) => {
      try {
        const bytes = new Uint8Array(ab || new ArrayBuffer(0));
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(binary);
      } catch {
        return "";
      }
    };

    for (const a of src) {
      const inferMimeFromName = (name) => {
        const n = String(name || "").toLowerCase();
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".webp")) return "image/webp";
        if (n.endsWith(".gif")) return "image/gif";
        if (n.endsWith(".bmp")) return "image/bmp";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".pdf")) return "application/pdf";
        if (n.endsWith(".csv")) return "text/csv";
        if (n.endsWith(".md")) return "text/markdown";
        if (n.endsWith(".html") || n.endsWith(".htm")) return "text/html";
        if (n.endsWith(".txt")) return "text/plain";
        return "";
      };

      const name = String(a?.name || "file");
      const mime0 = String(a?.mime || "");
      const mime = mime0 || inferMimeFromName(name);
      const size = Number(a?.size || 0) || 0;
      const kind = String(a?.kind || "file");

      let data = "";
      let route = "file";
      let fallback = "";

      const lower = name.toLowerCase();
      const isPdf = (mime === "application/pdf") || lower.endsWith(".pdf");
      const isTextLike =
        mime.startsWith("text/") ||
        mime === "text/csv" ||
        lower.endsWith(".txt") ||
        lower.endsWith(".md") ||
        lower.endsWith(".csv");

      if (kind === "image") route = "image";
      else if (isPdf) route = "pdf";
      else if (isTextLike) route = "text";

      try {
        // image (ANALYSIS MUST USE ORIGINAL FILE BYTES)
        // - data が空になる事故を防ぐため、fileToDataUrl(FileReader) を正にして base64 を作る
        // - 失敗時は a.dataUrl(thumb) にフォールバック
        if (route === "image") {
          const MAX_IMG = 8 * 1024 * 1024; // 8MB

          const tryUseDataUrl = () => {
            try {
              const du = String(a?.dataUrl || "");
              if (!du.startsWith("data:image/")) return false;
              const idx = du.indexOf("base64,");
              if (idx < 0) return false;
              const b64 = du.slice(idx + 7).trim();
              if (!b64) return false;
              data = b64;
              return true;
            } catch {
              return false;
            }
          };

          const takeBase64FromDataUrl = (url) => {
            try {
              const s = String(url || "");
              const idx = s.indexOf("base64,");
              if (idx < 0) return "";
              return s.slice(idx + 7).trim();
            } catch {
              return "";
            }
          };

          const fileSize = Number(a?.file?.size || 0) || 0;

          // 1) File があり、8MB以内なら fileToDataUrl で base64 化（確実ルート）
          if (a?.file && fileSize > 0 && fileSize <= MAX_IMG) {
            const url = await fileToDataUrl(a.file);
            const b64 = takeBase64FromDataUrl(url);
            if (b64) {
              data = b64;
            } else {
              // FileReader が空の場合に備えて thumb にフォールバック
              if (!tryUseDataUrl()) fallback = "image_encode_failed";
            }
          } else {
            // 2) 8MB超 / size不明 / file無し：thumb にフォールバック
            if (!tryUseDataUrl()) {
              if (!a?.file) fallback = "image_file_missing";
              else fallback = (fileSize > MAX_IMG) ? "image_too_large" : "image_size_unknown";
            }
          }

          // === FINAL FALLBACK (GPT互換必須) ===
          // data が無ければ送信しない（サーバ側で再添付誘導へ）
          if (!data) {
            console.warn("[AUREA] image has no data, abort sending attachment");
            continue;
          }
        }

        // v1: text files (txt/md/csv) -> base64 (already prepared as dataUrl)
        if (!data && route === "text" && a?.dataUrl && String(a.dataUrl).startsWith("data:")) {
          const s = String(a.dataUrl);
          const idx = s.indexOf("base64,");
          if (idx >= 0) data = s.slice(idx + 7);
        }

        // fallback: text files -> read file and pack base64 (size guard)
        if (!data && route === "text" && a?.file && size > 0) {
          const MAX_TEXT = 2 * 1024 * 1024; // 2MB
          if (size <= MAX_TEXT) {
            const ab = await a.file.arrayBuffer();
            data = arrayBufferToBase64(ab);
          } else {
            fallback = "text_too_large";
          }
        }

        // v1: PDF -> read file and pack base64 (size guard)
        if (!data && route === "pdf" && a?.file && size > 0) {
          const MAX_PDF = 8 * 1024 * 1024; // 8MB
          if (size <= MAX_PDF) {
            const url = await fileToDataUrl(a.file);
            const idx = String(url || "").indexOf("base64,");
            if (idx >= 0) data = String(url).slice(idx + 7);
          } else {
            fallback = "pdf_too_large";
          }
        }
      } catch {
        fallback = fallback || "read_error";
      }

      if (!data && !fallback) fallback = "no_data";

      const typeOut =
        (route === "image") ? "image" :
        (route === "pdf")   ? "pdf"   :
        "file";

      // image は data が無い場合、data を送らず fallback のみ送る（サーバ側で明確に失敗扱いできる）
      if (route === "image" && !data) {
        out.push({
          type: typeOut,
          route,
          mime,
          name,
          size,
          fallback: fallback || "image_data_missing"
        });
      } else {
        out.push({
          type: typeOut,
          route,
          mime,
          name,
          size,
          data,
          fallback
        });
      }
    }

    return out;
  };

  /* ================= Ask bar behavior ================= */
  const setHasChat = (has) => body.classList.toggle("has-chat", !!has);

  const autosizeTextarea = () => {
    if (!askInput) return;
    askInput.style.height = "auto";
    const max = 240;
    const h = clamp(askInput.scrollHeight, 0, max);
    askInput.style.height = `${h}px`;
  };

  const updateSendButtonVisibility = () => {
    if (!askInput || !sendBtn) return;

    const hasText = askInput.value.trim().length > 0;
    const hasAttachments = pendingAttachments.length > 0;

    // send（↑）は常時表示、未入力は disabled（GPT準拠：添付があれば有効）
    const canSend = hasText || hasAttachments;

    sendBtn.style.display = "";
    sendBtn.disabled = !canSend;
    sendBtn.style.opacity = canSend ? "" : ".45";
    sendBtn.style.cursor = canSend ? "" : "not-allowed";
  };

  /* ================= project modal ================= */
  const openProjectModal = () => {
    body.classList.add("project-open");
    projectModal?.setAttribute("aria-hidden", "false");
    // hide setting icon in project modal (unneeded)
    const pSettingBtn = $(".project-modal [aria-label='設定']");
    if (pSettingBtn) pSettingBtn.style.display = "none";
    projectNameInput?.focus();
  };

  const closeProjectModal = () => {
    body.classList.remove("project-open");
    projectModal?.setAttribute("aria-hidden", "true");
  };

  /* ================= centered confirm modal ================= */
  const ensureConfirmModal = () => {
    let wrap = $("#aureaConfirmModal");
    if (wrap) return wrap;

    wrap = document.createElement("div");
    wrap.id = "aureaConfirmModal";
    wrap.setAttribute("aria-hidden", "true");
    wrap.style.cssText = `
      position:fixed; inset:0; display:none; align-items:center; justify-content:center;
      background:rgba(0,0,0,.45); z-index:99999; padding:18px;
    `;

    const L_CONFIRM = tr("confirmTitle");
    const L_CANCEL  = tr("cancel");
    const L_OK      = tr("ok");

    wrap.innerHTML = `
      <div style="
        width:min(420px, calc(100% - 24px));
        background:rgba(20,21,22,.96);
        border:1px solid rgba(255,255,255,.10);
        border-radius:18px;
        box-shadow:0 10px 30px rgba(0,0,0,.45);
        overflow:hidden;
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        color:rgba(255,255,255,.92);
        font-family: -apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Hiragino Sans','Noto Sans JP',sans-serif;
      ">
        <div style="padding:14px 16px;font-size:14px;font-weight:600;">${L_CONFIRM}</div>
        <div id="aureaConfirmText" style="padding:14px 16px;font-size:13px;line-height:1.6;color:rgba(255,255,255,.82);"></div>
        <div style="padding:14px 16px;display:flex;justify-content:flex-end;gap:10px;">
          <button id="aureaConfirmCancel" type="button" style="
            height:34px;padding:0 12px;border-radius:10px;border:1px solid rgba(255,255,255,.12);
            background:transparent;color:rgba(255,255,255,.80);cursor:pointer;font-size:13px;
          ">${L_CANCEL}</button>
          <button id="aureaConfirmOk" type="button" style="
            height:34px;padding:0 12px;border-radius:10px;border:1px solid rgba(255,255,255,.12);
            background:rgba(255,255,255,.08);color:rgba(255,255,255,.92);cursor:pointer;font-size:13px;
          ">${L_OK}</button>
        </div>
      </div>
    `;

    document.body.appendChild(wrap);

    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) $("#aureaConfirmCancel")?.click();
    });

    return wrap;
  };

  const confirmModal = (message) => new Promise((resolve) => {
    const wrap = ensureConfirmModal();
    const text = $("#aureaConfirmText");
    const btnCancel = $("#aureaConfirmCancel");
    const btnOk = $("#aureaConfirmOk");

    if (text) text.textContent = message || tr("areYouSure");

    const cleanup = () => {
      btnCancel?.removeEventListener("click", onCancel);
      btnOk?.removeEventListener("click", onOk);
      document.removeEventListener("keydown", onEsc);
    };

    const close = (val) => {
      cleanup();
      wrap.style.display = "none";
      wrap.setAttribute("aria-hidden", "true");
      resolve(val);
    };

    const onCancel = () => close(false);
    const onOk = () => close(true);
    const onEsc = (e) => { if (e.key === "Escape") close(false); };

    btnCancel?.addEventListener("click", onCancel);
    btnOk?.addEventListener("click", onOk);
    document.addEventListener("keydown", onEsc);

    wrap.style.display = "flex";
    wrap.setAttribute("aria-hidden", "false");
  });

  /* ================= create project ================= */
  const createProject = async () => {
    const name = (projectNameInput?.value || "").trim();
    if (!name) return;

    const ok1 = await confirmModal(tr("confirmCreateProject"));
    if (!ok1) return;

    const p = { id: uid(), name, updatedAt: nowISO() };
    state.projects.unshift(p);

    // project threads box ensure
    state.threads.projects[p.id] = state.threads.projects[p.id] || [];
    state.activeThreadIdByScope.projects[p.id] = state.activeThreadIdByScope.projects[p.id] || null;

    // 作成したPJを選択状態にする（ただしチャット(scope)は変えない）
    state.activeProjectId = p.id;

    if (projectNameInput) projectNameInput.value = "";
    closeProjectModal();

    save(state);
    renderSidebar();
    renderView();

    askInput?.focus();
  };

/* ================= threads ================= */
  const createThread = () => {
    const threads = getThreadsForContext();
    const t = { id: uid(), title: tr("threadNew"), updatedAt: nowISO(), messages: [] };
    threads.unshift(t);
    setActiveThreadId(t.id);
    state.view = "chat";
    save(state);

    renderSidebar();
    renderView();

    setHasChat(false);
    askInput?.focus();
  };

  const createProjectThread = (projectId) => {
    const pid = projectId;
    if (!pid) return;

    if (!state.threads.projects[pid]) state.threads.projects[pid] = [];
    if (!state.activeThreadIdByScope.projects) state.activeThreadIdByScope.projects = {};

    const threads = state.threads.projects[pid];
    const t = { id: uid(), title: tr("threadNew"), updatedAt: nowISO(), messages: [] };
    threads.unshift(t);

    state.activeProjectId = pid;
    state.context = { type: "project", projectId: pid };
    state.activeThreadIdByScope.projects[pid] = t.id;
    state.view = "chat";

    save(state);
    renderSidebar();
    renderView();

    setHasChat(false);
    askInput?.focus();
  };

  const renameThread = (threadId) => {
    // globalチャット欄の操作は global に固定
    const threads = state.threads.global || [];
    const t = threads.find(x => x.id === threadId);
    if (!t) return;

    const next = window.prompt(tr("promptNewName"), t.title || tr("threadNew"));
    if (next === null) return;
    const v = next.trim();
    if (!v) return;

    t.title = v;
    t.updatedAt = nowISO();
    save(state);
    renderSidebar();
  };

  const deleteThread = async (threadId) => {
    const ok1 = await confirmModal(tr("confirmDelete"));
    if (!ok1) return;

    const threads = state.threads.global || [];
    const idx = threads.findIndex(x => x.id === threadId);
    if (idx < 0) return;

    threads.splice(idx, 1);

    if (state.context?.type === "global" && state.activeThreadIdByScope.global === threadId) {
      state.activeThreadIdByScope.global = null;
    }

    save(state);
    renderSidebar();
    renderView();
  };

  const renameProjectThread = (projectId, threadId) => {
    const pid = String(projectId || "");
    const tid = String(threadId || "");
    const threads = state.threads.projects?.[pid] || [];
    const t = threads.find(x => x.id === tid);
    if (!t) return;

    const next = window.prompt(tr("promptNewName"), t.title || tr("threadNew"));
    if (next === null) return;
    const v = next.trim();
    if (!v) return;

    t.title = v;
    t.updatedAt = nowISO();
    save(state);
    renderSidebar();
  };

  const deleteProjectThread = async (projectId, threadId) => {
    const pid = String(projectId || "");
    const tid = String(threadId || "");

    const ok1 = await confirmModal(tr("confirmDelete"));
    if (!ok1) return;

    const threads = state.threads.projects?.[pid] || [];
    const idx = threads.findIndex(x => x.id === tid);
    if (idx < 0) return;

    threads.splice(idx, 1);

    if (state.activeThreadIdByScope?.projects?.[pid] === tid) {
      state.activeThreadIdByScope.projects[pid] = null;
    }

    if (state.context?.type === "project" && state.context?.projectId === pid && getActiveThreadId() === tid) {
      state.context = { type: "global" };
      state.view = "chat";
    }

    save(state);
    renderSidebar();
    renderView();
  };

  const appendMessage = (role, content) => {
    let t = getThreadByIdInContext(getActiveThreadId());

    if (!t) {
      createThread();
      t = getThreadByIdInContext(getActiveThreadId());
      if (!t) return null;
    }

    const m = { id: uid(), role, content: content || "", createdAt: nowISO() };
    t.messages.push(m);
    t.updatedAt = nowISO();

    if (role === "user" && (t.title === tr("threadNew") || !t.title)) {
      const s = content.trim();
      t.title = s.length > 28 ? s.slice(0, 28) : s;
    }

    save(state);
    renderSidebar();
    renderView();
    return m;
  };

  const updateMessage = (mid, content) => {
    const t = getThreadByIdInContext(getActiveThreadId());
    if (!t) return;
    const m = t.messages.find(x => x.id === mid);
    if (!m) return;
    m.content = content || "";
    t.updatedAt = nowISO();
    save(state);
  };

  const setMessageMeta = (mid, patch = {}) => {
    const t = getThreadByIdInContext(getActiveThreadId());
    if (!t) return;
    const m = t.messages.find(x => x.id === mid);
    if (!m) return;
    if (!m.meta || typeof m.meta !== "object") m.meta = {};
    Object.assign(m.meta, patch || {});
    t.updatedAt = nowISO();
    save(state);
  };

  /* ================= images library ================= */
  const makePlaceholderImageDataUrl = (prompt) => {
    // quick placeholder (no external deps): simple SVG as data URL
    const safe = (prompt || "").slice(0, 60);
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#2b2c2d"/>
            <stop offset="1" stop-color="#101112"/>
          </linearGradient>
        </defs>
        <rect width="800" height="800" fill="url(#g)"/>
        <circle cx="640" cy="180" r="140" fill="rgba(255,255,255,0.06)"/>
        <circle cx="250" cy="620" r="210" fill="rgba(255,255,255,0.04)"/>
        <text x="60" y="120" fill="rgba(255,255,255,0.88)" font-size="42" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Roboto">
          AUREA Image
        </text>
        <text x="60" y="190" fill="rgba(255,255,255,0.70)" font-size="26" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Roboto">
          ${safe.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")}
        </text>
      </svg>
    `.trim();
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  };

  const addImageToLibrary = ({ prompt, src, from }) => {
    // Freeプランはライブラリ保存しない
    if (String(state.plan || "Free").trim() === "Free") return;

    const item = {
      id: uid(),
      createdAt: nowISO(),
      prompt: prompt || "",
      src: src || makePlaceholderImageDataUrl(prompt || ""),
      from: from || null
    };
    state.images.unshift(item);
    save(state);
  };

  const deleteImageFromLibrary = async (imageId) => {
    const ok1 = await confirmModal(tr("confirmDeleteImage"));
    if (!ok1) return;
    state.images = state.images.filter(x => x.id !== imageId);
    save(state);
    renderView();
  };

  // ===== Repair: rebuild image library from history (AUREA_IMAGE) =====
  // - リロード後にライブラリ/履歴から画像が消えたように見える事故を防ぐ
  // - 既存state.imagesに無い画像だけ追加する（重複防止）
  const repairImagesLibraryFromThreads = () => {
    try {
      if (!Array.isArray(state.images)) state.images = [];

      const existsBySrc = new Set(state.images.map(x => String(x?.src || "").trim()).filter(Boolean));

      const addIfMissing = (src, prompt, from) => {
        const s = String(src || "").trim();
        if (!s) return;
        if (existsBySrc.has(s)) return;

        state.images.unshift({
          id: uid(),
          createdAt: nowISO(),
          prompt: String(prompt || "").trim(),
          src: s,
          from: from || null
        });

        existsBySrc.add(s);
      };

      const scanThread = (scopeType, projectId, thread) => {
        const t = thread || {};
        const tid = String(t.id || "").trim();
        const msgs = Array.isArray(t.messages) ? t.messages : [];

        for (const m of msgs) {
          if (!m || m.role !== "assistant") continue;
          const raw = String(m.content || "");

          if (!raw.startsWith("AUREA_IMAGE\n")) continue;

          const lines = raw.split("\n");
          const url = String(lines[1] || "").trim();
          const p = String(lines.slice(2).join("\n") || "").trim();

          addIfMissing(url, p, {
            threadId: tid || null,
            context: scopeType === "project"
              ? { type: "project", projectId: String(projectId || "") }
              : { type: "global" }
          });
        }
      };

      // global
      for (const t of (state.threads?.global || [])) {
        scanThread("global", null, t);
      }

      // projects
      const pj = state.threads?.projects || {};
      for (const pid of Object.keys(pj)) {
        for (const t of (pj[pid] || [])) {
          scanThread("project", pid, t);
        }
      }

      save(state);
    } catch {}
  };

  /* ================= search across all conversations ================= */
  const iterAllThreads = () => {
    const out = [];
    // global
    for (const t of (state.threads.global || [])) {
      out.push({ scopeType: "global", projectId: null, thread: t });
    }
    // projects
    const projects = state.threads.projects || {};
    for (const pid of Object.keys(projects)) {
      for (const t of (projects[pid] || [])) {
        out.push({ scopeType: "project", projectId: pid, thread: t });
      }
    }
    return out;
  };

  const searchAll = (q) => {
    const query = (q || "").trim().toLowerCase();
    if (!query) return [];

    const hits = [];
    const all = iterAllThreads();

    for (const item of all) {
      const t = item.thread;
      const title = (t.title || "").toLowerCase();

      // title match
      if (title.includes(query)) {
        hits.push({
          kind: "title",
          scopeType: item.scopeType,
          projectId: item.projectId,
          threadId: t.id,
          threadTitle: t.title || tr("threadNew"),
          snippet: tr("titleMatch")
        });
        continue;
      }

      // message match
      const msgs = Array.isArray(t.messages) ? t.messages : [];
      for (const m of msgs) {
        const c = (m.content || "").toLowerCase();
        if (!c.includes(query)) continue;

        const raw = (m.content || "");
        const pos = c.indexOf(query);
        const start = clamp(pos - 36, 0, raw.length);
        const end = clamp(pos + query.length + 90, 0, raw.length);
        const snip = raw.slice(start, end);

        hits.push({
          kind: "message",
          scopeType: item.scopeType,
          projectId: item.projectId,
          threadId: t.id,
          threadTitle: t.title || tr("threadNew"),
          snippet: snip
        });
        break; // one hit per thread is enough (v1)
      }
    }

    // newest thread first
    const getUpdatedAt = (h) => {
      const scopeThreads =
        h.scopeType === "global"
          ? (state.threads.global || [])
          : (state.threads.projects?.[h.projectId] || []);
      const t = scopeThreads.find(x => x.id === h.threadId);
      return t?.updatedAt || "";
    };

    hits.sort((a,b) => (getUpdatedAt(b)).localeCompare(getUpdatedAt(a)));
    return hits.slice(0, 80);
  };

  const openThreadFromSearchHit = (hit) => {
    if (!hit) return;
    clearPendingAttachments();

    if (hit.scopeType === "global") {
      state.context = { type: "global" };
      setActiveThreadId(hit.threadId);
    } else {
      state.activeProjectId = hit.projectId;
      state.context = { type: "project", projectId: hit.projectId };
      state.activeThreadIdByScope.projects[hit.projectId] = hit.threadId;
      save(state);
    }

    state.view = "chat";
    save(state);

    renderSidebar();
    renderView();
  };

  /* ================= view rendering ================= */
  const clearBoardViewNodes = () => {
    // keep .chat for chat view; other views are injected as #aureaView
    const v = $("#aureaView");
    if (v) v.remove();
  };

  const renderChat = () => {
    if (!chatRoot) return;

    chatRoot.innerHTML = "";

    const t = getThreadByIdInContext(getActiveThreadId());
    const msgs = t?.messages || [];

    if (!t || msgs.length === 0) {
      setHasChat(false);
      return;
    }

    setHasChat(true);

    for (const m of msgs) {
      const wrap = document.createElement("div");
      wrap.className = "msg " + (m.role === "user" ? "user" : "assistant");

      const bubble = document.createElement("div");
      bubble.className = "bubble";

      // user側：添付がある場合はbubble枠を消す（CSS側で無枠化）
      try {
        const hasUserAtt =
          (m && m.role === "user")
          && (m.meta && Array.isArray(m.meta.attachments))
          && (m.meta.attachments.length > 0);

        if (hasUserAtt) bubble.classList.add("bubble-user-attach");
      } catch {}

      const renderReportsAsDetails = (raw) => {
        const s0 = String(raw || "");

        const normalizeAureaAnswer = (src) => {
          const s = String(src || "").replace(/\r/g, "");

          // GPT同等：回答本文は圧縮しない（全文をそのまま表示）
          // ただし「AI Repo/Reportsラベル」だけは表示ノイズになるので除去する
          const rawLines = s.split("\n");
          const out = [];

          for (const ln of rawLines) {
            const t = String(ln || "");
            const tt = t.trim();

            // hide "AI Repo" labels inside the answer text
            if (/^\[?\s*AI\s*(Repo|Rep|Reports)\s*\]?$/.test(tt)) continue;
            if (/^AI\s*(Repo|Rep|Reports)\s*[:：]\s*/.test(tt)) continue;

            out.push(t);
          }

          return out.join("\n").trim();
        };

        const normalized = normalizeAureaAnswer(s0);

        const lines0 = String(normalized || s0).split("\n");
        const lines = [];
        for (const ln of lines0) {
          const t0 = String(ln || "").trim();
          if (!t0) { lines.push(""); continue; }
          lines.push(String(ln || ""));
        }

        let html = "";
        let inUl = false;
        let inOl = false;
        let inCode = false;
        let codeBuf = [];

        const closeLists = () => {
          if (inUl) { html += `</ul>`; inUl = false; }
          if (inOl) { html += `</ol>`; inOl = false; }
        };

        const openUl = () => {
          if (inOl) { html += `</ol>`; inOl = false; }
          if (!inUl) {
            html += `<ul style="margin:8px 0 12px 18px;padding:0;">`;
            inUl = true;
          }
        };

        const openOl = () => {
          if (inUl) { html += `</ul>`; inUl = false; }
          if (!inOl) {
            html += `<ol style="margin:8px 0 12px 18px;padding:0;">`;
            inOl = true;
          }
        };

        const formatInline = (src) => {
          const s = String(src || "");

          const codeParts = [];
          const s1 = s.replace(/`([^`]+)`/g, (_, c) => {
            const id = codeParts.length;
            codeParts.push(String(c || ""));
            return `@@CODE${id}@@`;
          });

          const boldParts = [];
          const s2 = s1.replace(/\*\*([^*]+)\*\*/g, (_, b) => {
            const id = boldParts.length;
            boldParts.push(String(b || ""));
            return `@@BOLD${id}@@`;
          });

          let out = escHtml(s2);

          out = out.replace(/@@BOLD(\d+)@@/g, (_, n) => {
            const v = escHtml(boldParts[Number(n)] || "");
            return `<span style="font-weight:700;">${v}</span>`;
          });

          out = out.replace(/@@CODE(\d+)@@/g, (_, n) => {
            const v = escHtml(codeParts[Number(n)] || "");
            return `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:12px;padding:1px 6px;border-radius:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.10);">${v}</span>`;
          });

          return out;
        };

        const addPara = (t) => {
          closeLists();
          if (!t) return;
          html += `<div style="margin:0 0 10px;line-height:1.7;">${t}</div>`;
        };

        const flushCode = () => {
          if (!codeBuf.length) return;
          closeLists();
          const code = escHtml(codeBuf.join("\n"));
          html += `<pre style="margin:10px 0 12px;padding:12px 12px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);overflow:auto;"><code style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:12px;line-height:1.55;white-space:pre;">${code}</code></pre>`;
          codeBuf = [];
        };

        for (const line0 of lines) {
          const line = String(line0 || "");
          const t = line.trim();

          if (/^```/.test(t)) {
            if (inCode) {
              inCode = false;
              flushCode();
            } else {
              inCode = true;
              codeBuf = [];
            }
            continue;
          }

          if (inCode) {
            codeBuf.push(line.replace(/\r/g, ""));
            continue;
          }

          if (!t) {
            closeLists();
            html += `<div style="height:10px;"></div>`;
            continue;
          }

          const mH = /^(#{1,3})\s+(.+)$/.exec(t);
          if (mH) {
            const lvl = mH[1].length;
            const tt = formatInline(mH[2]);
            closeLists();
            const fs = (lvl === 1) ? 16 : (lvl === 2) ? 14 : 13;
            const op = (lvl === 1) ? .98 : .94;
            html += `<div style="margin:10px 0 8px;font-weight:800;font-size:${fs}px;letter-spacing:-.2px;opacity:${op};">${tt}</div>`;
            continue;
          }

          const mBullet = /^[-•*]\s+(.+)$/.exec(t) || /^・\s*(.+)$/.exec(t);
          if (mBullet) {
            openUl();
            html += `<li style="margin:0 0 6px;line-height:1.65;">${formatInline(mBullet[1])}</li>`;
            continue;
          }

          const mNum = /^(\d+)\.\s+(.+)$/.exec(t);
          if (mNum) {
            openOl();
            html += `<li style="margin:0 0 6px;line-height:1.65;">${formatInline(mNum[2])}</li>`;
            continue;
          }

          const mKey = /^(.{1,60}?):\s*(.*)$/.exec(t);
          if (mKey) {
            const k = escHtml(mKey[1]);
            const v = formatInline(mKey[2] || "");
            const keySpan = `<span style="color:rgba(159,180,255,.95);font-weight:800;">${k}</span>`;
            const rest = v ? ` ${v}` : "";
            addPara(`${keySpan}:${rest}`);
            continue;
          }

          addPara(formatInline(t));
        }

        if (inCode) flushCode();
        closeLists();

        return html || escHtml(s0).replace(/\n/g, "<br>");
      };

      const renderMessageHtml = (msg) => {
        const raw0 = String(msg?.content || "");

        // User: attachments (persisted in meta) — restore on reload
        if (msg?.role === "user") {
          const atts = Array.isArray(msg?.meta?.attachments) ? msg.meta.attachments : [];
          if (atts.length) {
            const items = atts.slice(0, 8).map((a) => {
              const name = String(a?.name || "file").trim();
              const mime = String(a?.mime || "");
              const route = String(a?.route || "file");
              const isImg = (route === "image") || (String(a?.kind || "") === "image");
              const isPdf = (route === "pdf") || (mime === "application/pdf") || name.toLowerCase().endsWith(".pdf");
              const isText = (route === "text");

              const thumb = (isImg && a?.dataUrl && String(a.dataUrl).startsWith("data:"))
                ? `<img src="${escHtml(String(a.dataUrl))}" alt="" style="width:150px;height:96px;border-radius:14px;object-fit:cover;border:0;background:transparent;" />`
                : isPdf
                  ? `<div style="width:150px;height:96px;border-radius:14px;display:flex;align-items:center;justify-content:center;border:0;background:transparent;color:rgba(255,255,255,.92);font-size:11px;font-weight:800;letter-spacing:.06em;">PDF</div>`
                  : isText
                    ? `<div style="width:150px;height:96px;border-radius:14px;display:flex;align-items:center;justify-content:center;border:0;background:transparent;color:rgba(255,255,255,.86);font-size:12px;font-weight:700;">TXT</div>`
                    : `<div style="width:150px;height:96px;border-radius:14px;display:flex;align-items:center;justify-content:center;border:0;background:transparent;opacity:.9;">📄</div>`;

              return `<div style="flex:0 0 auto;">${thumb}</div>`;
            }).join("");

            // Assistant: attachments (persisted in meta) — enable preview
if (msg?.role === "assistant") {
  const atts = Array.isArray(msg?.meta?.attachments) ? msg.meta.attachments : [];
  if (atts.length) {
    const items = atts.slice(0, 8).map((a, i) => {
      const name = String(a?.name || "file").trim();
      const mime = String(a?.mime || "");
      const route = String(a?.route || "file");
      const isImg = (route === "image") || (String(a?.kind || "") === "image");

      const thumb = (isImg && a?.dataUrl && String(a.dataUrl).startsWith("data:"))
        ? `<img src="${escHtml(String(a.dataUrl))}" alt="" style="width:150px;height:96px;border-radius:14px;object-fit:cover;" />`
        : `<div style="width:150px;height:96px;border-radius:14px;display:flex;align-items:center;justify-content:center;opacity:.85;">📄</div>`;

      return `
        <button
          type="button"
          class="aurea-assistant-attach"
          data-mid="${escHtml(msg.id)}"
          data-idx="${i}"
          style="border:0;background:transparent;padding:0;cursor:pointer;"
        >
          ${thumb}
        </button>
      `;
    }).join("");

    return `
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        ${items}
      </div>
    `;
  }
}

            const textHtml = raw0.trim()
              ? `<div style="margin-top:10px;line-height:1.7;">${escHtml(raw0).replace(/\n/g, "<br>")}</div>`
              : "";

            return `
              <div style="display:flex;flex-direction:column;gap:0;">
                <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start;">
                  ${items}
                </div>
                ${textHtml}
              </div>
            `.trim();
          }
        }

        // Assistant only: Sora image message
        // Format:
        // AUREA_IMAGE
        // <url>
        // <prompt>
        //
        // Pending format (effect):
        // AUREA_IMAGE_PENDING
        // <prompt>
        const ensureSoraPendingFx = () => {
          if (document.getElementById("aureaSoraPendingFx")) return;

          const st = document.createElement("style");
          st.id = "aureaSoraPendingFx";
          st.textContent = `
            @keyframes aureaSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            .ai-image-card .aurea-sora-pending{
              width:100%;
              aspect-ratio:1/1;
              border-radius:18px;
              border:1px solid rgba(255,255,255,.10);
              background:rgba(255,255,255,.04);
              display:grid;
              place-items:center;
              position:relative;
              overflow:hidden;
            }
            .ai-image-card .aurea-sora-pending::before{
              content:"";
              position:absolute;
              inset:-40%;
              background:linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,.08) 50%, rgba(255,255,255,0) 100%);
              transform:translateX(-40%);
              animation:aureaSoraShimmer 1.2s ease-in-out infinite;
            }
            @keyframes aureaSoraShimmer {
              from { transform:translateX(-40%); }
              to   { transform:translateX(40%); }
            }
            .ai-image-card .aurea-sora-spinner{
              width:34px;height:34px;
              border-radius:999px;
              border:3px solid rgba(255,255,255,.22);
              border-top-color: rgba(255,255,255,.82);
              animation:aureaSpin .9s linear infinite;
              position:relative;
              z-index:1;
            }

            /* ===== progress (GPT-like) ===== */
            .ai-image-card .aurea-sora-progress{
              position:absolute;
              top:12px;
              left:12px;
              right:12px;
              z-index:1;
              pointer-events:none;
              display:flex;
              flex-direction:column;
              gap:8px;
              box-sizing:border-box;
            }
            .ai-image-card .aurea-sora-progress__top{
              display:flex;
              align-items:center;
              justify-content:space-between;
              gap:8px;
              font-size:12px;
              line-height:1;
              color:rgba(255,255,255,.86);
              opacity:.92;
              white-space:nowrap;

              /* %を見切らせない */
              overflow:visible;
            }
            .ai-image-card .aurea-sora-progress__title{
              min-width:0;
              overflow:hidden;
              text-overflow:ellipsis;
            }
            .ai-image-card .aurea-sora-progress__txt{
              flex:0 0 auto;
              margin-left:8px;
              min-width:42px;
              text-align:right;
              font-variant-numeric: tabular-nums;
              opacity:.82;
            }
            .ai-image-card .aurea-sora-progress__track{
              height:6px;
              border-radius:999px;
              background:rgba(255,255,255,.10);
              border:1px solid rgba(255,255,255,.10);
              overflow:hidden;
            }
            .ai-image-card .aurea-sora-progress__bar{
              height:100%;
              width:0%;
              border-radius:999px;
              background:rgba(255,255,255,.65);
            }

            .ai-image-card .aurea-sora-pending-label{
              position:absolute;
              bottom:12px;
              left:12px;
              right:12px;
              font-size:12px;
              line-height:1.45;
              opacity:.72;
              white-space:nowrap;
              overflow:hidden;
              text-overflow:ellipsis;
              z-index:1;
            }
          `.trim();

          document.head.appendChild(st);
        };

        // Pending (Sora running)
        // NOTE: 履歴表示では「生成中UI」を出さない（再読み込みで永久クルクルを防止）
        if (msg?.role === "assistant" && raw0.startsWith("AUREA_IMAGE_PENDING\n")) {
          const mid = String(msg?.id || "");

          const isThisStreaming =
            (typeof window.__AUREA_STREAMING_MID__ === "string")
            && window.__AUREA_STREAMING_MID__ === mid;

          // 生成中の当事者メッセージだけ、クルクル/進捗を表示
          if (isThisStreaming) {
            ensureSoraPendingFx();

            try {
              if (!window.__AUREA_IMG_PROGRESS__) window.__AUREA_IMG_PROGRESS__ = {};
            } catch {}

            const store = (() => {
              try { return window.__AUREA_IMG_PROGRESS__ || {}; } catch { return {}; }
            })();

            if (mid && !store[mid]) {
              store[mid] = { startedAt: Date.now() };
              try { window.__AUREA_IMG_PROGRESS__ = store; } catch {}
            }

            const calcPct = () => {
              const now = Date.now();
              const start = store[mid]?.startedAt ? Number(store[mid].startedAt) : now;
              const t = Math.max(0, (now - start) / 1000);
              const p = 5 + 85 * (1 - Math.exp(-t / 3.8));
              return Math.max(0, Math.min(90, Math.round(p)));
            };

            const isEn = ((state.settings?.language || "ja") === "en");
            const pct = calcPct();

            const ensureProgressLoop = () => {
              try {
                if (window.__AUREA_IMG_PROGRESS_TICK__) return;
                window.__AUREA_IMG_PROGRESS_TICK__ = setInterval(() => {
                  const els = Array.from(document.querySelectorAll(".aurea-sora-progress"));
                  if (!els.length) {
                    try { clearInterval(window.__AUREA_IMG_PROGRESS_TICK__); } catch {}
                    window.__AUREA_IMG_PROGRESS_TICK__ = null;
                    return;
                  }

                  const st = (() => {
                    try { return window.__AUREA_IMG_PROGRESS__ || {}; } catch { return {}; }
                  })();

                  const now = Date.now();

                  for (const el of els) {
                    const m = String(el.getAttribute("data-mid") || "");
                    const start = st[m]?.startedAt ? Number(st[m].startedAt) : now;
                    const t = Math.max(0, (now - start) / 1000);
                    const p = 5 + 85 * (1 - Math.exp(-t / 3.8));
                    const pct2 = Math.max(0, Math.min(90, Math.round(p)));

                    const bar = el.querySelector(".aurea-sora-progress__bar");
                    const txt = el.querySelector(".aurea-sora-progress__txt");

                    if (bar) bar.style.width = `${pct2}%`;
                    if (txt) txt.textContent = `${pct2}%`;
                  }
                }, 240);
              } catch {}
            };

            ensureProgressLoop();

            const lines = raw0.split("\n");
            const prompt = String(lines.slice(1).join("\n") || "").trim();

            const title = isEn ? "Creating image" : "画像を生成中";
            const sub = isEn ? "Generating…" : "生成中…";
            return `
              <div class="ai-image-card" style="position:relative;">
                <div class="aurea-sora-pending" aria-label="Generating image">

                  <div class="aurea-sora-progress" data-mid="${escHtml(mid)}">
                    <div class="aurea-sora-progress__top">
                      <div class="aurea-sora-progress__title">${escHtml(title)}</div>
                      <div class="aurea-sora-progress__txt">${pct}%</div>
                    </div>
                    <div class="aurea-sora-progress__track">
                      <div class="aurea-sora-progress__bar" style="width:${pct}%"></div>
                    </div>
                  </div>

                  <div class="aurea-sora-pending-label">${escHtml(prompt || sub)}</div>
                </div>
              </div>
            `.trim();
          }

          // 履歴表示：クルクルは出さず、静的表示にする
          const isEn = ((state.settings?.language || "ja") === "en");
          const lines = raw0.split("\n");
          const prompt = String(lines.slice(1).join("\n") || "").trim();

          return `
            <div class="ai-image-card" style="position:relative;">
              <div style="
                width:100%;
                aspect-ratio:1/1;
                border-radius:18px;
                border:1px solid rgba(255,255,255,.10);
                background:rgba(255,255,255,.04);
                display:flex;
                align-items:flex-end;
                justify-content:flex-start;
                padding:12px;
                box-sizing:border-box;
              ">
                <div style="font-size:12px;opacity:.72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%;">
                  ${escHtml(prompt || (isEn ? "Generation was interrupted." : "生成が中断されました。"))}
                </div>
              </div>
            </div>
          `.trim();
        }

        if (msg?.role === "assistant" && raw0.startsWith("AUREA_IMAGE\n")) {
          const lines = raw0.split("\n");
          const url = String(lines[1] || "").trim();

          if (url) {
            const safeUrl = escHtml(url);
            const fname = `aurea-image-${String(msg?.id || "").slice(0, 8) || "download"}.png`;

            return `
              <div class="ai-image-card" style="position:relative;">
                <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:block;">
                  <img src="${safeUrl}" alt="generated image" />
                </a>

                <a href="${safeUrl}" download="${escHtml(fname)}" aria-label="Download" style="
                  position:absolute;
                  top:10px;
                  right:10px;
                  width:32px;
                  height:32px;
                  border-radius:10px;
                  border:1px solid rgba(255,255,255,.14);
                  background:rgba(0,0,0,.28);
                  color:rgba(255,255,255,.92);
                  display:grid;
                  place-items:center;
                  text-decoration:none;
                  backdrop-filter: blur(10px);
                  -webkit-backdrop-filter: blur(10px);
                ">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:18px;height:18px;opacity:.95;">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <path d="M7 10l5 5 5-5"></path>
                    <path d="M12 15V3"></path>
                  </svg>
                </a>
              </div>
            `.trim();
          }
        }

        // Assistant only: fold "AI Stack" progress into details
        if (msg?.role === "assistant" && raw0.startsWith("AI Stack\n")) {
          const sep = raw0.indexOf("\n\n");
          const head = (sep >= 0) ? raw0.slice(0, sep) : raw0;
          const rest = (sep >= 0) ? raw0.slice(sep + 2) : "";

          const headBody = escHtml(head).replace(/\n/g, "<br>");
          const restHtml = renderReportsAsDetails(rest);

          const stackHtml = `
              <details class="ai-stack" open>
                <summary class="ai-stack__sum">AI Stack</summary>
                <div class="ai-stack__body">${headBody}</div>
              </details>
            `.trim();

          return rest ? `${stackHtml}<br><br>${restHtml}` : stackHtml;
        }

        // Assistant only: fold Reports into details
        if (msg?.role === "assistant") {
          return renderReportsAsDetails(raw0);
        }

        return escHtml(raw0).replace(/\n/g, "<br>");
      };

      const editingMid = String(window.__AUREA_EDITING_USER_MID__ || "");
      const isEditingThis = (m.role === "user" && editingMid && editingMid === m.id);

      if (isEditingThis) {
        const v0 = String(m.content || "");
        const isEn = ((state.settings?.language || "ja") === "en");

        bubble.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:10px;min-width:0;">
            <textarea data-role="user-edit" style="
              width:100%;
              min-height:96px;
              max-height:260px;
              resize:vertical;
              border-radius:14px;
              border:1px solid rgba(255,255,255,.12);
              background:rgba(255,255,255,.04);
              color:rgba(255,255,255,.92);
              outline:none;
              padding:12px 12px;
              font-size:14px;
              line-height:1.55;
              font-family:var(--font);
              white-space:pre-wrap;
            ">${escHtml(v0)}</textarea>

            <div style="display:flex;justify-content:flex-end;gap:10px;">
              <button type="button" data-action="cancel-user-edit" data-mid="${escHtml(m.id)}" style="
                height:34px;
                padding:0 12px;
                border-radius:12px;
                border:1px solid rgba(255,255,255,.12);
                background:transparent;
                color:rgba(255,255,255,.86);
                cursor:pointer;
                font-size:13px;
              ">${escHtml(isEn ? "Cancel" : "キャンセル")}</button>

              <button type="button" data-action="save-user-edit" data-mid="${escHtml(m.id)}" style="
                height:34px;
                padding:0 12px;
                border-radius:12px;
                border:1px solid rgba(255,255,255,.12);
                background:rgba(255,255,255,.10);
                color:rgba(255,255,255,.92);
                cursor:pointer;
                font-size:13px;
                font-weight:700;
              ">${escHtml(isEn ? "Save" : "保存")}</button>
            </div>
          </div>
        `;
      } else {
        bubble.innerHTML = renderMessageHtml(m);
      }

      wrap.appendChild(bubble);

      // user: edit icon (GPT-like)
      if (m.role === "user" && !isEditingThis) {
        const ua = document.createElement("div");
        ua.className = "actions";
        ua.style.display = "flex";
        ua.style.flexDirection = "column";
        ua.style.gap = "8px";
        ua.style.alignItems = "center";
        ua.style.opacity = ".92";

        const edit = document.createElement("div");
        edit.className = "act";
        edit.setAttribute("role", "button");
        edit.setAttribute("tabindex", "0");
        edit.dataset.action = "edit-user-message";
        edit.dataset.mid = m.id;
        edit.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z"></path>
          </svg>
        `;
        ua.appendChild(edit);
        wrap.appendChild(ua);
      }

      if (m.role === "assistant") {
        ensureAiMeteorFx();

        const isStreamingMsg = (typeof window.__AUREA_STREAMING_MID__ === "string" && window.__AUREA_STREAMING_MID__ === m.id);

        // 解析中表示はゲージに一本化（msg側のstreammarkは出さない）
        wrap.classList.remove("is-streaming");
        wrap.classList.remove("has-streammark");

        const existed = wrap.querySelector(".aurea-streammark");
        if (existed) {
          try { existed.remove(); } catch {}
        }

        // GPT互換：行単位のstreaming表示は使わない（Ask上shimmerに一本化）
        // ここで continue すると actions が付かず、見た目の残留が起きるため無効化
        void isStreamingMsg;

        // GPT同等：解析中（streaming中）は actions（コピー/Repo）を表示しない
        const streamingOn = (() => {
          try { return document.body.classList.contains("aurea-streaming"); } catch { return false; }
        })();

        if (!streamingOn) {
          const actions = document.createElement("div");
          actions.className = "actions";
          actions.style.display = "flex";
          actions.style.flexDirection = "column";
          actions.style.gap = "8px";
          actions.style.alignItems = "center";

          // copy
          const act = document.createElement("div");
          act.className = "act";
          act.setAttribute("role", "button");
          act.setAttribute("tabindex", "0");
          act.dataset.action = "copy-message";
          act.dataset.mid = m.id;
          act.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2"></rect>
              <rect x="2" y="2" width="13" height="13" rx="2"></rect>
            </svg>
          `;
          actions.appendChild(act);

          // AI Reports：設定ONなら常に表示（reportsRawが空なら disabled 扱い）
          const showReportsIcon = (state.settings?.showAiReports === true);

          if (showReportsIcon) {
            const hasReports = !!String(m?.meta?.reportsRaw || "").trim();

            const rep = document.createElement("div");
            rep.className = "act";
            rep.setAttribute("role", "button");
            rep.setAttribute("tabindex", hasReports ? "0" : "-1");
            rep.dataset.action = "open-reports";
            rep.dataset.mid = m.id;

            if (!hasReports) {
              rep.dataset.disabled = "1";
              rep.style.opacity = ".45";
              rep.style.cursor = "not-allowed";
            }

            rep.innerHTML = `
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M7 3h8l3 3v15a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z"></path>
                <path d="M15 3v5a3 3 0 0 0 3 3h3"></path>
                <path d="M8 13h8"></path>
                <path d="M8 17h8"></path>
              </svg>
            `;
            actions.appendChild(rep);
          }

          wrap.appendChild(actions);
        }
      }

      chatRoot.appendChild(wrap);
    }

    // scroll bottom (GPT-like boundary)
    const lastMsg = msgs[msgs.length - 1];
    const shouldFollow =
      userNearBottom
      || (lastMsg && lastMsg.role === "user");

    if (board && shouldFollow) {
      board.scrollTo({ top: board.scrollHeight, behavior: "smooth" });
    }

    // indicator sync
    syncScrollState();
  };

  const renderImagesView = () => {
    clearBoardViewNodes();

    const wrap = document.createElement("div");
    wrap.id = "aureaView";
    wrap.className = "view view-images";
    wrap.innerHTML = `
      <div class="images-head">
        <div>
          <div class="images-title">${escHtml(tr("images"))}</div>
          <div class="images-sub">${escHtml(tr("librarySub"))}</div>
        </div>
      </div>

      <div id="aureaImagesBody"></div>
    `;

    board?.appendChild(wrap);

    const bodyEl = $("#aureaImagesBody", wrap);
    if (!bodyEl) return;

    if (!state.images || state.images.length === 0) {
      bodyEl.innerHTML = `<div class="images-empty">${escHtml(tr("libraryEmpty"))}</div>`;
      return;
    }

    const grid = document.createElement("div");
    grid.className = "images-grid";

    for (const img of state.images) {
      const card = document.createElement("div");
      card.className = "img-card";
      card.dataset.id = img.id;

      const d = new Date(img.createdAt);
      const dateText = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;

      card.innerHTML = `
        <div class="img-thumb">
          <img src="${escHtml(img.src)}" alt="image" />
        </div>
        <div class="img-meta">
          <div class="img-date">${escHtml(dateText)}</div>
          <div class="img-actions">
            <button class="img-btn" type="button" data-action="download" title="Download">↓</button>
            <button class="img-btn" type="button" data-action="open" title="${escHtml(tr("open"))}">↗</button>
            <button class="img-btn" type="button" data-action="delete" title="${escHtml(tr("delete"))}">×</button>
          </div>
        </div>
      `;

      grid.appendChild(card);
    }

    bodyEl.appendChild(grid);
  };

  const renderSearchView = (q) => {
    clearBoardViewNodes();

    const query = (q ?? "").trim();
    const hits = searchAll(query);

    const wrap = document.createElement("div");
    wrap.id = "aureaView";
    wrap.className = "view view-search";

    wrap.innerHTML = `
      <div class="search-head">
        <div>
          <div class="search-title">${escHtml(tr("searchTitle"))}</div>
          <div class="search-sub">${
            q
              ? `${escHtml(tr("searchSubPrefix"))}${escHtml(q)}${escHtml(tr("searchSubMid"))}${hits.length}${escHtml(tr("searchSubSuffix"))}`
              : escHtml(tr("searchPrompt"))
          }</div>
        </div>
      </div>

      <div class="search-results" id="aureaSearchResults"></div>
    `;

    board?.appendChild(wrap);

    const list = $("#aureaSearchResults", wrap);
    if (!list) return;

    if (!q) return;

    if (hits.length === 0) {
      list.innerHTML = `<div class="images-empty">${escHtml(tr("searchNoMatch"))}</div>`;
      return;
    }

    for (const h of hits) {
      const projName = h.scopeType === "project"
        ? (state.projects.find(p => p.id === h.projectId)?.name || tr("project"))
        : tr("chat");

      const meta = h.scopeType === "project"
        ? `${tr("project")}: ${projName}`
        : tr("global");

      const card = document.createElement("div");
      card.className = "search-card";
      card.dataset.threadId = h.threadId;
      card.dataset.scopeType = h.scopeType;
      card.dataset.projectId = h.projectId || "";

      card.innerHTML = `
        <div class="top">
          <div class="ttl">${escHtml(h.threadTitle)}</div>
          <div class="meta">${escHtml(meta)}</div>
        </div>
        <div class="snip">${escHtml(h.snippet || "")}</div>
      `;

      list.appendChild(card);
    }
  };

  const renderProjectHomeView = () => {
    clearPendingAttachments();
    clearBoardViewNodes();

    const pid = String(state.activeProjectId || "");
    const proj = state.projects.find(p => p.id === pid) || null;
    const name = proj ? (proj.name || tr("project")) : tr("project");

    const isEn = ((state.settings?.language || "ja") === "en");

    // PJトップAsk（i18nキー未定義でも必ず表示が崩れない）
    const pjNewChatLabel = isEn ? `New chat in ${name}` : `${name} 内の新しいチャット`;

    // PJトップの＋メニュー（i18nキー未定義でも必ず表示が崩れない）
    const pjAddFileLabel = isEn ? "Add photos and files" : "写真とファイルを追加";
    const pjCreateImageLabel = isEn ? "Create an image" : "画像を作成する";

    const wrap = document.createElement("div");
    wrap.id = "aureaView";
    wrap.className = "view view-project";

    const list = (state.threads.projects?.[pid] || []).slice()
      .sort((a,b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

    const rows = list.map((t) => {
      const d = String(t.updatedAt || "").slice(0, 10);
      return `
        <div class="pj-home-row" data-thread-id="${escHtml(t.id)}" data-scope-type="project" data-project-id="${escHtml(pid)}">
          <div class="pj-home-row__main">
            <div class="pj-home-row__ttl">${escHtml(t.title || tr("threadNew"))}</div>
          </div>
          <div class="pj-home-row__date">
            <span class="pj-home-date">${escHtml(d)}</span>
            <span class="pj-home-actions" aria-label="${escHtml(tr("menu"))}">
              <button type="button" class="pj-home-act" data-action="pj-home-rename" data-project-id="${escHtml(pid)}" data-thread-id="${escHtml(t.id)}">${escHtml(tr("menuRename"))}</button>
              <button type="button" class="pj-home-act danger" data-action="pj-home-delete" data-project-id="${escHtml(pid)}" data-thread-id="${escHtml(t.id)}">${escHtml(tr("menuDelete"))}</button>
            </span>
          </div>
        </div>
      `;
    }).join("");

    wrap.innerHTML = `
      <div class="pj-home-head">
        <div class="pj-home-title">
          <span class="pj-home-ic" aria-hidden="true"></span>
          <span class="pj-home-name">${escHtml(name)}</span>
        </div>
      </div>

      <div class="pj-home-ask" aria-label="新しい会話を開始">
        <div class="pj-home-askbar">
          <details class="plus-menu pj-home-plus">
            <summary class="pj-home-plusbtn" aria-label="${escHtml(pjAddFileLabel)}">
              <span aria-hidden="true">+</span>
            </summary>
            <div class="plus-pop" role="menu" aria-label="${escHtml(pjAddFileLabel)}">
              <a href="#" role="menuitem" data-action="add-file">${escHtml(pjAddFileLabel)}</a>
            </div>
          </details>

          <input
            id="aureaProjectHomeAsk"
            type="text"
            placeholder="${escHtml(isEn ? `New chat in ${name}` : `${name} 内の新しいチャット`)}"
            aria-label="${escHtml(isEn ? `New chat in ${name}` : `${name} 内の新しいチャット`)}"
            autocomplete="off"
          />
        </div>
      </div>

      <div class="pj-home-list" id="aureaProjectHomeThreads">
        ${rows || `<div class="images-empty">${escHtml(tr("searchPrompt"))}</div>`}
      </div>
    `;

    board?.appendChild(wrap);

    const input = document.getElementById("aureaProjectHomeAsk");

    const start = async () => {
      const hasAttachments = pendingAttachments.length > 0;
      const text = (input?.value || "").trim();

      // テキストなし＋添付あり → prompt は空のまま送る（server側でIntent Discovery）
      if (!text && !hasAttachments) return;

      // PJ内で新規トーク作成 → そのトークに送信（GPT同等）
      createProjectThread(pid);

      let userMsg = null;

      // 添付がある場合はテキスト無しでも user message を作って保持（GPT同等）
      if (text || hasAttachments) {
        userMsg = appendMessage("user", text || "");
      }

      if (input) input.value = "";

      // 添付を確定して multiAiReply へ（解析・打ち返し）
      const rawAttachments = takePendingAttachments();

      // 添付を履歴に保存（Fileオブジェクトは保存しない）
      if (userMsg && Array.isArray(rawAttachments) && rawAttachments.length) {
        try {
          const safeAtts = rawAttachments.map((a) => ({
            name: String(a?.name || "file"),
            size: Number(a?.size || 0) || 0,
            mime: String(a?.mime || ""),
            kind: String(a?.kind || "file"),
            route: String(a?.route || "file"),
            fallback: String(a?.fallback || ""),
            dataUrl: String(a?.dataUrl || "")
          }));
          setMessageMeta(userMsg.id, { attachments: safeAtts });
          renderView();
        } catch {}
      }

      await multiAiReply(text, rawAttachments);
    };

    const pjPlus = wrap.querySelector(".pj-home-plus");
    const pjPlusItems = Array.from(wrap.querySelectorAll(".pj-home-plus .plus-pop a[role='menuitem']"));

    pjPlusItems.forEach((a) => {
      if (a.dataset.bound === "1") return;
      a.dataset.bound = "1";

      const action = (a.getAttribute("data-action") || "").trim();

      a.addEventListener("click", async (e) => {
        e.preventDefault();

        // close PJ plus menu
        if (pjPlus && pjPlus.hasAttribute("open")) pjPlus.removeAttribute("open");

        if (action === "add-file") {
          openFilePickerForAttachments();
          return;
        }
      });
    });

    if (input) {
      input.addEventListener("keydown", async (e) => {
        const mode = state.settings?.sendMode || (localStorage.getItem("aurea_send_mode") || "cmdEnter");
        const isEnter = (e.key === "Enter");

        if (mode === "cmdEnter") {
          if (isEnter && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            await start();
          }
          return;
        }

        if (mode === "enter") {
          if (isEnter) {
            e.preventDefault();
            await start();
          }
        }
      });

      setTimeout(() => input.focus(), 0);
    }
  };

  const applyBodyViewClass = () => {
    body.classList.toggle("view-chat", state.view === "chat");
    body.classList.toggle("view-images", state.view === "images");
    body.classList.toggle("view-search", state.view === "search");
    body.classList.toggle("view-project", state.view === "project");
  };

  const renderView = () => {
    applyBodyViewClass();

    // toggle active in sidebar
    if (btnImages) {
      if (state.view === "images") btnImages.setAttribute("data-active","1");
      else btnImages.removeAttribute("data-active");
    }

    // views:
    if (state.view === "images") {
      if (chatRoot) chatRoot.style.display = "none";
      renderImagesView();
      setHasChat(false);
      return;
    }

    if (state.view === "search") {
      // 検索は画面遷移ではなく、常にポップ（GPT準拠）
      state.view = "chat";
      save(state);

      clearBoardViewNodes();
      if (chatRoot) chatRoot.style.display = "";
      renderChat();
      applyI18n();

      openSearchModal();
      return;
    }

    if (state.view === "project") {
      if (chatRoot) chatRoot.style.display = "none";
      renderProjectHomeView();
      setHasChat(false);
      applyI18n();
      return;
    }

    // chat view
    clearBoardViewNodes();
    if (chatRoot) chatRoot.style.display = "";
    renderChat();
    applyI18n();
  };

  /* ================= sidebar render ================= */
  const clearNode = (el) => { if (el) el.innerHTML = ""; };

  const renderProjects = () => {
    if (!projectList) return;

    const createRow = $(".sb-create-project", projectList);
    const kept = createRow ? createRow.outerHTML : "";
    clearNode(projectList);
    if (kept) projectList.insertAdjacentHTML("beforeend", kept);

    state.projects
      .slice()
      .sort((a,b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
      .forEach((p) => {
        // PJ名行
        const row = document.createElement("div");
        row.className = "sb-row";
        row.setAttribute("role", "listitem");
        row.dataset.kind = "project";
        row.dataset.id = p.id;

        const link = document.createElement("a");
        link.className = "sb-link";
        link.href = "#";
        link.setAttribute("aria-label", p.name);
        link.textContent = p.name;

        // isExpanded: PJの展開状態（入れ物）
        const isExpanded = (state.activeProjectId === p.id);

        // isActive: PJトップ表示中 or PJ会話表示中
        const isActive =
          (state.view === "project" && state.activeProjectId === p.id)
          || (state.context?.type === "project" && state.context?.projectId === p.id);

        if (isActive) link.setAttribute("data-active","1");
        else link.removeAttribute("data-active");

        const more = document.createElement("details");
        more.className = "sb-more";

        const sum = document.createElement("summary");
        sum.className = "sb-dots";
        sum.setAttribute("aria-label", "メニュー");
        sum.textContent = "•••";

        const pop = document.createElement("div");
        pop.className = "sb-pop";
        pop.setAttribute("role","menu");
        pop.setAttribute("aria-label","メニュー");

        const rename = document.createElement("button");
        rename.type = "button";
        rename.className = "sb-act";
        rename.textContent = tr("menuRename");
        rename.dataset.action = "rename-project";

        const del = document.createElement("button");
        del.type = "button";
        del.className = "sb-act danger";
        del.textContent = tr("menuDelete");
        del.dataset.action = "delete-project";

        pop.appendChild(rename);
        pop.appendChild(del);

        more.appendChild(sum);
        more.appendChild(pop);

        row.appendChild(link);
        row.appendChild(more);
        projectList.appendChild(row);

        // 展開中のPJだけ、PJ内のUI（履歴）を出す
        if (isExpanded) {
          const inner = document.createElement("div");
          inner.className = "pj-inner";
          inner.dataset.projectId = p.id;

          // PJ threads（PJ内チャットのみ表示）
          const list = (state.threads.projects[p.id] || []).slice()
            .sort((a,b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

          list.forEach((t) => {
            const row = document.createElement("div");
            row.className = "pj-row";
            row.dataset.kind = "pj-thread";
            row.dataset.projectId = p.id;
            row.dataset.threadId = t.id;

            const a = document.createElement("a");
            a.href = "#";
            a.className = "pj-thread";
            a.dataset.action = "pj-open-thread";
            a.dataset.projectId = p.id;
            a.dataset.threadId = t.id;

            // active: 「表示中の会話」がこのPJ内スレッドのときだけ
            if (
              state.context?.type === "project"
              && state.context?.projectId === p.id
              && (state.activeThreadIdByScope?.projects?.[p.id] === t.id)
            ) {
              a.setAttribute("data-active", "1");
            } else {
              a.removeAttribute("data-active");
            }

            a.innerHTML = `<div class="t">${escHtml(t.title || tr("threadNew"))}</div>`;

            const more = document.createElement("details");
            more.className = "sb-more";

            const sum = document.createElement("summary");
            sum.className = "sb-dots";
            sum.setAttribute("aria-label", "メニュー");
            sum.textContent = "•••";

            const pop = document.createElement("div");
            pop.className = "sb-pop";
            pop.setAttribute("role","menu");
            pop.setAttribute("aria-label","メニュー");

            const rename = document.createElement("button");
            rename.type = "button";
            rename.className = "sb-act";
            rename.textContent = tr("menuRename");
            rename.dataset.action = "rename-pj-thread";

            const del = document.createElement("button");
            del.type = "button";
            del.className = "sb-act danger";
            del.textContent = tr("menuDelete");
            del.dataset.action = "delete-pj-thread";

            pop.appendChild(rename);
            pop.appendChild(del);

            more.appendChild(sum);
            more.appendChild(pop);

            row.appendChild(a);
            row.appendChild(more);
            inner.appendChild(row);
          });

          projectList.appendChild(inner);
        }
      });

    const newBtn = $(".sb-create-project", projectList);
    if (newBtn) {
      newBtn.addEventListener("click", (e) => {
        e.preventDefault();
        openProjectModal();
      }, { once: true });
    }
  };

  const renderChatList = () => {
    if (!chatList) return;

    // GPTと同じ意味：この「チャット」欄は常に global
    const threads = (state.threads.global || []).slice()
      .sort((a,b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

    clearNode(chatList);

    for (const t of threads) {
      const row = document.createElement("div");
      row.className = "sb-row";
      row.setAttribute("role","listitem");
      row.dataset.kind = "thread";
      row.dataset.id = t.id;

      const link = document.createElement("a");
      link.className = "sb-link";
      link.href = "#";
      link.setAttribute("aria-label", t.title || tr("threadNew"));
      link.textContent = t.title || tr("threadNew");

      // active only when current context is global
      if (state.context?.type === "global" && state.activeThreadIdByScope.global === t.id) {
        link.setAttribute("data-active","1");
      }

      const more = document.createElement("details");
      more.className = "sb-more";

      const sum = document.createElement("summary");
      sum.className = "sb-dots";
      sum.setAttribute("aria-label","メニュー");
      sum.textContent = "•••";

      const pop = document.createElement("div");
      pop.className = "sb-pop";
      pop.setAttribute("role","menu");
      pop.setAttribute("aria-label","メニュー");

      const rename = document.createElement("button");
      rename.type = "button";
      rename.className = "sb-act";
      rename.textContent = tr("menuRename");
      rename.dataset.action = "rename-thread";

      const del = document.createElement("button");
      del.type = "button";
      del.className = "sb-act danger";
      del.textContent = tr("menuDelete");
      del.dataset.action = "delete-thread";

      pop.appendChild(rename);
      pop.appendChild(del);

      more.appendChild(sum);
      more.appendChild(pop);

      row.appendChild(link);
      row.appendChild(more);

      chatList.appendChild(row);
    }
  };

  const renderSidebar = () => {
    renderProjects();
    renderChatList();
    applyI18n();
  };

  /* ================= rename/delete project ================= */
  const renameProject = (projectId) => {
    const p = state.projects.find(x => x.id === projectId);
    if (!p) return;
    const next = window.prompt(tr("promptNewName"), p.name);
    if (next === null) return;
    const v = next.trim();
    if (!v) return;
    p.name = v;
    p.updatedAt = nowISO();
    save(state);
    renderSidebar();
  };

  const deleteProject = async (projectId) => {
    const ok1 = await confirmModal(tr("confirmDeleteProject"));
    if (!ok1) return;

    // PJ本体削除
    state.projects = state.projects.filter(x => x.id !== projectId);

    // PJ配下データ削除（混線防止）
    if (state.threads?.projects) delete state.threads.projects[projectId];
    if (state.activeThreadIdByScope?.projects) delete state.activeThreadIdByScope.projects[projectId];

    // 展開中PJ解除
    if (state.activeProjectId === projectId) {
      state.activeProjectId = null;
    }

    // 表示中コンテキストが削除PJなら global に戻す
    if (state.context?.type === "project" && state.context?.projectId === projectId) {
      state.context = { type: "global" };
      state.view = "chat";
    }

    save(state);
    renderSidebar();
    renderView();
  };

/* ================= streaming (UI-only placeholder) ================= */
  let streamTimer = null;
  let streamAbort = false;

  // /api/chat fetch abort (STOPで確実に止める)
  let apiChatAbortCtrl = null;

  // multi-AI run control
  let multiAiAbort = false;
  let multiAiRunId = 0;

  const MULTI_AI = [
    { name: "GPT",        role: "final" },
    { name: "Gemini",     role: "research" },
    { name: "Claude",     role: "analysis" },
    { name: "Perplexity", role: "verify" },
    { name: "Mistral",    role: "fast" },
    { name: "Sora",       role: "image" }
  ];

  const isImageGenerationRequest = (text) => {
    const s0 = String(text || "");
    const s = s0.toLowerCase();

    // English triggers
    const en =
      /\b(generate|create|make|render|draw|illustrate)\b/i.test(s) ||
      /\b(image|illustration|photo)\b/i.test(s) ||
      /\b(png|jpg|jpeg|webp)\b/i.test(s);

    // Japanese triggers (include "イメージ画像" / future iPhone phrase)
    const ja =
      /画像|イメージ画像|イメージ|イラスト|写真|生成|描いて|作って|レンダ/.test(s0) ||
      /未来のiphone|未来のiPhone|iphoneのイメージ画像|iPhoneのイメージ画像/.test(s0);

    return !!(en || ja);
  };

  const shouldUseSora = (userText) => {
    // テキストが画像生成意図なら必ず Sora を使う（履歴/既存画像の有無に影響されない）
    return isImageGenerationRequest(String(userText || ""));
  };

  const setStreaming = (on) => {
    if (stopBtn) stopBtn.style.display = on ? "" : "none";

    // 解析中だけの見た目制御フラグ（赤丸の丸UIを消すため）
    try { document.body.classList.toggle("aurea-streaming", !!on); } catch {}

    // streaming中は送信ボタンを無効化（表示は維持）
    if (sendBtn) {
      const hasText = (askInput?.value || "").trim().length > 0;
      const hasAttachments = pendingAttachments.length > 0;
      const canSend = hasText || hasAttachments;

      sendBtn.style.display = "";

      if (on) {
        sendBtn.disabled = true;
        sendBtn.style.opacity = ".45";
        sendBtn.style.cursor = "not-allowed";
      } else {
        sendBtn.disabled = !canSend;
        sendBtn.style.opacity = canSend ? "" : ".45";
        sendBtn.style.cursor = canSend ? "" : "not-allowed";
      }
    }

    // 解析/生成％ピル
    if (on) {
      try { startStreamProgressPill(); } catch {}
    } else {
      try { finishStreamProgressPill(); } catch {}
    }

    // ★ 解析中UIの残留を確実に消す（丸アイコン/流星ラベル/AIインジケータ）
    // ★ 解析中UIの残留を確実に消す（丸アイコン/流星ラベル/AIインジケータ）
    // renderChat() はここで呼ばない（丸が残留する原因になる）
    if (!on) {
      try { window.__AUREA_STREAMING_MID__ = ""; } catch {}
      try { clearAiRunIndicator(); } catch {}
    }
  };

  const stopStreaming = () => {
    streamAbort = true;
    multiAiAbort = true;

    // 進行中runを無効化（後から返ってきたレスポンスを捨てる）
    multiAiRunId += 1;

    // 進行中fetchを中断
    try { apiChatAbortCtrl?.abort(); } catch {}
    apiChatAbortCtrl = null;

    if (streamTimer) { clearInterval(streamTimer); streamTimer = null; }

    setStreaming(false);
    try { clearAiRunIndicator(); } catch {}
    try { window.__AUREA_STREAMING_MID__ = ""; } catch {}
    renderChat();
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const statusText = (s) => {
    // stable labels (no new i18n keys)
    if (s === "queued") return "queued";
    if (s === "running") return "running";
    if (s === "done") return "done";
    if (s === "skipped") return "skipped";
    if (s === "aborted") return "aborted";
    if (s === "error") return "error";
    return String(s || "");
  };

  const buildMultiAiHeader = (statuses) => {
    const lines = [];
    lines.push("AI Stack");
    for (const a of MULTI_AI) {
      const st = statuses[a.name] || "queued";
      lines.push(`• ${a.name}: ${statusText(st)}`);
    }
    return lines.join("\n");
  };

  const pickBackend = () => {
    // Optional backend injection:
    // window.__AUREA_MULTI_AI_BACKEND__ = { run: async ({ ai, text, role }) => "..." }
    try {
      const b = window.__AUREA_MULTI_AI_BACKEND__;
      if (b && typeof b.run === "function") return b;
    } catch {}
    return null;
  };

  const runOneAi = async ({ ai, text }) => {
    const backend = pickBackend();
    if (backend) {
      return await backend.run({ ai, text, role: ai.role });
    }

    // UI-only stub (deterministic, ready to be replaced by API)
    await sleep(140 + (ai.name.length * 40));
    if (ai.name === "Gemini") {
      return `Key points to research:\n- Clarify requirements\n- Collect relevant info\n- Note constraints`;
    }
    if (ai.name === "Claude") {
      return `Structure / issues:\n- Break into steps\n- Identify risks\n- Propose safe plan`;
    }
    if (ai.name === "Perplexity") {
      return `Verification checklist:\n- Confirm assumptions\n- Cross-check critical facts\n- Add sources when backend is connected`;
    }
    if (ai.name === "Mistral") {
      return `Fast draft:\n- Short actionable answer\n- Minimal steps\n- Next action`;
    }
    if (ai.name === "Sora") {
      return `Image generation route active. (UI stub)`;
    }
    return `OK (stub)`;
  };

  const integrateFinal = ({ userText, reports, usedSora }) => {
    // UI-only: GPT final synthesis placeholder (backend will replace)
    // 本文は「回答のみ」(Reports/Sources/ログはRepoアイコン側で表示)
    return tr("replyPlaceholder");
  };

  const multiAiReply = async (userText, rawAttachments = []) => {
    const m = appendMessage("assistant", "");
    if (!m) return;

    // SSEでは行左の生成中マーク（__AUREA_STREAMING_MID__）を使わない（GPT互換）
    try { window.__AUREA_STREAMING_MID__ = ""; } catch {}

    streamAbort = false;
    multiAiAbort = false;
    // GPT互換：Ask上の「解析中...」だけ開始（行左の丸などは出さない）
    try { setStreamingLabelMode("analyzing"); } catch {}
    try { startStreamProgressPill(); } catch {}
    if (stopBtn) stopBtn.style.display = "";
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.style.opacity = ".45";
      sendBtn.style.cursor = "not-allowed";
    }

    // ===== Route guard: if image is attached, always ANALYZE (never generate) =====
    const hasImageAttachment = Array.isArray(rawAttachments) && rawAttachments.some((a) => {
      if (!a) return false;
      if (String(a.kind || "") === "image") return true;
      if (String(a.route || "") === "image") return true;
      const f = a.file;
      const mt = String(f && f.type ? f.type : "");
      if (mt && mt.startsWith("image/")) return true;
      const nm = String(a.name || "");
      return /\.(png|jpg|jpeg|webp|gif|bmp|svg)$/i.test(nm);
    });

    // ===== prompt guard (attachments must be analyzable even if text is empty) =====
    const promptText = (() => {
      const t = String(userText || "").trim();
      if (t) return t;

      if (Array.isArray(rawAttachments) && rawAttachments.length) {
        return ((state.settings?.language || "ja") === "en")
          ? "Analyze the attached file."
          : "添付ファイルを解析して。";
      }

      return "";
    })();

    // ===== build attachment payload once (shared) =====
    const attachmentPayload = await buildAttachmentsPayload(rawAttachments);

    // ===== guard: image must include base64 data (otherwise stop before calling API) =====
    const badImg = Array.isArray(attachmentPayload) && attachmentPayload.some((x) => {
      if (!x) return false;
      if (String(x.route || "") !== "image") return false;
      const d = String(x.data || "").trim();
      return !d;
    });

    if (badImg) {
      updateMessage(m.id, ((state.settings?.language || "ja") === "en")
        ? "Image could not be read. Please re-attach the image and send again."
        : "画像を読み取れませんでした。画像を再添付して送信してください。"
      );
      renderChat();
      setStreaming(false);
      unlockAndClearAttachments();
      renderSidebar();
      return;
    }

    // ===== Sora image generation (front complete) =====
    // NOTE: generation is allowed only when NO image attachments (GPT-like: attached images mean "analyze")
    if (!hasImageAttachment && shouldUseSora(promptText)) {

      // 送信直後に「生成中」を可視化（待ち時間の不安解消）
      try {
        updateMessage(m.id, `AUREA_IMAGE_PENDING\n${String(userText || "").trim()}`);
        renderChat();
      } catch {}

      try {
        const st = { Sora: "running", GPT: "queued" };
        try { setAiRunIndicator({ phase: "run", statuses: st }); } catch {}
      } catch {}

      try { showAiActivity("Sora"); } catch {}

      try {
        const payload = {
          prompt: promptText,
          attachments: attachmentPayload,
          context: {
            view: state.view,
            scope: state.context,
            projectId: state.context?.type === "project" ? state.context.projectId : null,
            threadId: getActiveThreadId(),
            language: state.settings?.language || "ja",
            trainerCases: (() => {
              try {
                const raw = localStorage.getItem("aurea_trainer_cases_v1");
                if (!raw) return [];
                const arr = JSON.parse(raw);
                if (!Array.isArray(arr)) return [];
                return arr
                  .map(x => ({
                    q: String(x?.q || "").trim(),
                    a: String(x?.a || "").trim()
                  }))
                  .filter(x => x.q && x.a)
                  .slice(0, 200);
              } catch { return []; }
            })()
          }
        };

        try { apiChatAbortCtrl?.abort(); } catch {}
        apiChatAbortCtrl = new AbortController();

        const __imgTimeout = setTimeout(() => {
          try { apiChatAbortCtrl.abort(); } catch {}
        }, 25000);

        let r = null;
        try {
          r = await apiFetchJson("/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: apiChatAbortCtrl.signal
          });

          if (!r) throw new Error("api_chat_unreachable");
        } finally {
          try { clearTimeout(__imgTimeout); } catch {}
        }

        const j = await r.json().catch(() => null);
        const url = String(j?.image?.url || "").trim();
        const p = String(j?.image?.prompt || userText || "").trim();

        if (r.ok && j && j.ok && url) {
          // save to images library
          try {
            addImageToLibrary({
              prompt: p,
              src: url,
              from: { threadId: getActiveThreadId(), context: state.context }
            });
          } catch {}

          // render as special image message
          const imgMsg = `AUREA_IMAGE\n${url}\n${p}`;
          updateMessage(m.id, imgMsg);

          // 完了ステータスを保存（リロード時の誤再稼働防止）
          try { setMessageMeta(m.id, { status: "done", ai: "Sora" }); } catch {}

          renderChat();
          setStreaming(false);
          unlockAndClearAttachments();
          renderSidebar();
          return;
        }

      } catch {}

      // fail-safe（backend未接続でも Sora発動＝必ず画像を返す）
        try {
          const p = String(userText || "").trim();
          const url = makePlaceholderImageDataUrl(p);

          try {
            addImageToLibrary({
              prompt: p,
              src: url,
              from: { threadId: getActiveThreadId(), context: state.context }
            });
          } catch {}

          const imgMsg = `AUREA_IMAGE\n${url}\n${p}`;
          updateMessage(m.id, imgMsg);

          // ★ 完了ステータスを保存（リロード時の誤再稼働防止）
          try { setMessageMeta(m.id, { status: "done", ai: "Sora" }); } catch {}

          try { setAiRunIndicator({ phase: "run", statuses: { Sora: "done", GPT: "queued" } }); } catch {}
          try { clearAiRunIndicator(); } catch {}
          try { window.__AUREA_STREAMING_MID__ = ""; } catch {}

          renderChat();
          setStreaming(false);
          unlockAndClearAttachments();
          renderSidebar();
          return;
        } catch {}

      // fail-safe（必ず placeholder 画像で返す）
      try {
        const p = String(userText || "").trim();
        const url = makePlaceholderImageDataUrl(p);

        try {
          addImageToLibrary({
            prompt: p,
            src: url,
            from: { threadId: getActiveThreadId(), context: state.context }
          });
        } catch {}

        const imgMsg = `AUREA_IMAGE\n${url}\n${p}`;
        updateMessage(m.id, imgMsg);

        try { setAiRunIndicator({ phase: "run", statuses: { Sora: "done", GPT: "queued" } }); } catch {}
        try { clearAiRunIndicator(); } catch {}
        try { window.__AUREA_STREAMING_MID__ = ""; } catch {}

        renderChat();
        setStreaming(false);
        unlockAndClearAttachments();
        renderSidebar();
        return;
      } catch {}

      // 最終フォールバック（UIを壊さない）
      updateMessage(m.id, `AUREA_IMAGE\n${makePlaceholderImageDataUrl(String(userText || "").trim())}\n${String(userText || "").trim()}`);

      // ★ 完了ステータスを保存（リロード時の誤再稼働防止）
      try { setMessageMeta(m.id, { status: "done", ai: "Sora" }); } catch {}

      try { setAiRunIndicator({ phase: "run", statuses: { Sora: "done", GPT: "queued" } }); } catch {}
      try { clearAiRunIndicator(); } catch {}
      try { window.__AUREA_STREAMING_MID__ = ""; } catch {}

      renderChat();
      setStreaming(false);
      unlockAndClearAttachments();
      renderSidebar();
      return;
      }

      const runId = ++multiAiRunId;

    const statuses = {};
    MULTI_AI.forEach((a) => (statuses[a.name] = "queued"));

    const usedSora = shouldUseSora(userText);
    if (!usedSora) statuses.Sora = "skipped";

    const reports = {};

    const renderProgress = (finalText = "") => {
      if (multiAiAbort || streamAbort || runId !== multiAiRunId) return;

      try { setAiRunIndicator({ phase: "run", statuses }); } catch {}

      updateMessage(m.id, finalText || "");
      renderChat();
    };

    renderProgress("");

    const targets = MULTI_AI.filter((a) => a.name !== "GPT" && (a.name !== "Sora" || usedSora));

    // ===== /api/chat/stream (SSE) -> fallback /api/chat (JSON) =====
    let apiMap = null;
    try {
      const payload = {
        prompt: promptText,
        attachments: attachmentPayload,
        context: {
          view: state.view,
          scope: state.context,
          projectId: state.context?.type === "project" ? state.context.projectId : null,
          threadId: getActiveThreadId(),
          language: state.settings?.language || "ja",
          trainerCases: (() => {
            try {
              const raw = localStorage.getItem("aurea_trainer_cases_v1");
              if (!raw) return [];
              const arr = JSON.parse(raw);
              if (!Array.isArray(arr)) return [];
              return arr
                .map(x => ({
                  q: String(x?.q || "").trim(),
                  a: String(x?.a || "").trim()
                }))
                .filter(x => x.q && x.a)
                .slice(0, 200);
            } catch { return []; }
          })()
        }
      };

      // ---- STREAM FIRST (POST SSE) ----
      try { apiChatAbortCtrl?.abort(); } catch {}
      apiChatAbortCtrl = new AbortController();

      let streamed = "";
      let streamDone = false;

      const startOk = await apiFetchSse({
        path: "/chat/stream",
        payload,
        signal: apiChatAbortCtrl.signal,
        onEvent: (ev, data) => {
          if (multiAiAbort || streamAbort || runId !== multiAiRunId) return;

          const e = String(ev || "").trim();

if (e === "start") {
  updateMessage(m.id, "");

  // 行単位streaming状態は使わない（丸残留の根を潰す）
  try { window.__AUREA_STREAMING_MID__ = ""; } catch {}

  // Ask上shimmerのみで表現（DOM差し替え直後でも確実に生成）
  try { setStreamingLabelMode("analyzing"); } catch {}
  try { ensureStreamProgressPill(); } catch {}
  try { startStreamProgressPill(); } catch {}

  // setStreaming(true/false) はボタン制御寄せ
  try { setStreaming(true); } catch {}

  renderChat();
  return;
}

          if (e === "delta") {
            const d = String(data || "");
            if (!d) return;

            // GPT同等：解析→回答生成へ表示を切替
            try {
              if (String(window.__AUREA_STREAMING_LABEL_MODE__ || "analyzing") !== "generating") {
                setStreamingLabelMode("generating");
                startStreamProgressPill();
              }
            } catch {}

            streamed += d;
            updateMessage(m.id, streamed);
            renderChat();
            return;
          }

          if (e === "done") {
            const full0 = String(data || "").trim() || streamed.trim();
            streamDone = true;

            // Reports: ブロックを meta に退避（Repoアイコン表示用）
            try {
              const parsed = parseReportsBlocks(full0);
              const head = String(parsed?.head || "").trim();
              const blocks = Array.isArray(parsed?.blocks) ? parsed.blocks : [];

              if (blocks.length) {
                const lines = [];
                lines.push("Reports:");
                for (const b of blocks) {
                  lines.push(`--- ${String(b.name || "").trim()} ---`);
                  lines.push(String(b.body || "").trim());
                }
                setMessageMeta(m.id, { reportsRaw: lines.join("\n").trim() });
              }

              updateMessage(m.id, head || full0);
            } catch {
              updateMessage(m.id, full0);
            }

            // 先に終了（残留ゼロ）
            try { window.__AUREA_STREAMING_MID__ = ""; } catch {}
            try { clearAiRunIndicator(); } catch {}
            finishStreamProgressPill();
            setStreaming(false);

            unlockAndClearAttachments();
            renderChat();
            renderSidebar();
            return;
          }

          if (e === "error") {
            const msg = String(data || "").trim() || "stream_failed";
            updateMessage(m.id, msg);

            // 先に終了（残留ゼロ）
            try { window.__AUREA_STREAMING_MID__ = ""; } catch {}
            try { clearAiRunIndicator(); } catch {}
            setStreaming(false);

            unlockAndClearAttachments();
            renderChat();
            renderSidebar();
            return;
          }
        }
      });

      // stream 成功（doneイベントで終了）ならここで終了
      if (startOk && startOk.ok) {
        // done が来ないまま終わった場合もあるので、最後に確定
        if (!streamDone && streamed.trim()) {
          updateMessage(m.id, streamed.trim());
          renderChat();
          setStreaming(false);
          unlockAndClearAttachments();
          renderSidebar();
        }
        return;
      }

      // ---- FALLBACK JSON ----
      const r = await apiFetchJson("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: apiChatAbortCtrl.signal
      });

      // ===== non-stream final answer (required) =====
      if (r && r.result && typeof r.result.GPT === "string") {
        updateMessage(m.id, r.result.GPT);
        renderChat();
        setStreaming(false);
        unlockAndClearAttachments();
        renderSidebar();
        return;
      }

      if (!r) throw new Error("api_chat_unreachable");

      if (!r.ok) {
        const safe = ((state.settings?.language || "ja") === "en")
          ? "I can’t continue this action yet.\n\n- A required connection or configuration is not ready.\n- Please try again later.\n- If this keeps happening, open Settings and check connections."
          : "この操作はまだ続行できない。\n\n- 必要な接続/設定が未完了\n- しばらくして再試行\n- 続く場合は設定で接続状況を確認";

        updateMessage(m.id, safe);
        renderChat();
        setStreaming(false);
        unlockAndClearAttachments();
        renderSidebar();
        return;
      }

      const j = await r.json().catch(() => null);

      if (r.ok && j && j.ok && j.image && j.image.url) {
        const url = String(j.image.url || "").trim();
        const p = String(j.image.prompt || userText || "").trim();
        const imgMsg = `AUREA_IMAGE\n${url}\n${p}`;
        updateMessage(m.id, imgMsg);
        renderChat();
        setStreaming(false);
        unlockAndClearAttachments();
        renderSidebar();
        return;
      }

      if (r.ok && j && j.ok && j.result && typeof j.result === "object") {
        apiMap = j.result;
        const gpt = String(apiMap.GPT || "").trim();
        updateMessage(m.id, gpt);
        renderChat();
        setStreaming(false);
        unlockAndClearAttachments();
        renderSidebar();
        return;
      }

    } catch (e) {
      apiMap = null;

      const msg = ((state.settings?.language || "ja") === "en")
        ? "API error: /api/chat did not return JSON.\n\n- Check Network > /api/chat response is JSON.\n- If it is HTML, Hosting rewrite is not reaching Functions."
        : "APIエラー：/api/chat が JSON を返していない。\n\n- Network > /api/chat の Response が JSON か確認。\n- HTMLなら Functions に到達していない（rewrite不整合）。";

      updateMessage(m.id, msg);
      renderChat();
      setStreaming(false);
      unlockAndClearAttachments();
      renderSidebar();
      return;
    }

    // ===== AI activity fade (active AIs only) =====
    if (apiMap && typeof apiMap === "object") {
      for (const k of Object.keys(apiMap)) {
        if (apiMap[k]) showAiActivity(k);
      }
    }

    // run in parallel, update status per AI
    const tasks = targets.map(async (ai) => {
      if (multiAiAbort || streamAbort || runId !== multiAiRunId) return;

      statuses[ai.name] = "running";
      try { noteAiBecameRunning(ai.name); } catch {}
      renderProgress("");

      try {
        const out =
          (apiMap && apiMap[ai.name] != null)
            ? apiMap[ai.name]
            : await runOneAi({ ai, text: userText });

        if (multiAiAbort || streamAbort || runId !== multiAiRunId) {
          statuses[ai.name] = "aborted";
          renderProgress("");
          return;
        }

        reports[ai.name] = String(out || "");
        statuses[ai.name] = "done";
        renderProgress("");
      } catch {
        statuses[ai.name] = "error";
        renderProgress("");
      }
    });

    await Promise.all(tasks);

    if (multiAiAbort || streamAbort || runId !== multiAiRunId) {
      setStreaming(false);
      return;
    }

    // Repo用：AI別レポートを保存（本文には出さない）
    try {
      const names = Object.keys(reports || {});
      const lines = [];
      if (names.length) {
        lines.push("Reports:");
        for (const n of names) {
          lines.push(`--- ${n} ---`);
          lines.push(String(reports[n] || "").trim());
        }
      }
      setMessageMeta(m.id, { reportsRaw: lines.join("\n").trim() });
    } catch {}

    // GPT final synthesis (UI stub for now)
    statuses.GPT = "running";
    renderProgress("");

    const final = integrateFinal({ userText, reports, usedSora });

    // stream final text
    let i = 0;
    const step = Math.max(1, Math.floor(final.length / 180));
    streamTimer = setInterval(() => {
      if (multiAiAbort || streamAbort || runId !== multiAiRunId) {
        if (streamTimer) { clearInterval(streamTimer); streamTimer = null; }
        setStreaming(false);
        return;
      }

      i += step;
      const chunk = final.slice(0, i);
      renderProgress(chunk);

      if (i >= final.length) {
        clearInterval(streamTimer);
        streamTimer = null;
        statuses.GPT = "done";
        renderProgress(final);
        setStreaming(false);
        try { clearAiRunIndicator(); } catch {}
        try { window.__AUREA_STREAMING_MID__ = ""; } catch {}

        // actions（コピー/Repo）を「完了瞬間」に必ず表示
        renderChat();

        renderSidebar();
      }
    }, 18);
  };

  const send = async () => {
    if (!askInput) return;

    const hasAttachments = pendingAttachments.length > 0;
    const text = askInput.value.trim();

    // テキストなし＋添付あり → prompt は空のまま送る（server側でIntent Discovery）
    if (!text && !hasAttachments) return;

    // PJトップからの送信は、PJ内の新規トークを作ってから送る（GPT仕様）
    if (state.view === "project" && state.activeProjectId) {
      createProjectThread(state.activeProjectId);
    }

    state.view = "chat";
    save(state);

    // チャットログ：添付がある場合は「テキスト無し」でも user message を作って保持（GPT同等）
    let userMsg = null;

    if (text || hasAttachments) {
      userMsg = appendMessage("user", text || "");
    }

    askInput.value = "";
    autosizeTextarea();
    updateSendButtonVisibility();

    const rawAttachments = takePendingAttachments();

    // ===== AI run indicator: attachments send should ALWAYS kick off (GPT-like) =====
    try {
      const hasImageAttachment = Array.isArray(rawAttachments) && rawAttachments.some((a) => {
        if (!a) return false;
        if (String(a.kind || "") === "image") return true;
        if (String(a.route || "") === "image") return true;
        const f = a.file;
        const mt = String(f && f.type ? f.type : "");
        if (mt && mt.startsWith("image/")) return true;
        const nm = String(a.name || "");
        return /\.(png|jpg|jpeg|webp|gif|bmp|svg)$/i.test(nm);
      });

      // label: analyzing
      setStreamingLabelMode("analyzing");

      // show GPT running immediately, others queued
      const st = {
        GPT: "running",
        Gemini: "queued",
        Claude: "queued",
        Perplexity: "queued",
        Mistral: "queued",
        Sora: hasImageAttachment ? "skipped" : "queued"
      };

      noteAiBecameRunning("GPT");
      setAiRunIndicator({ phase: "run", statuses: st });
    } catch {}

    // 添付を履歴に保存（Fileオブジェクトは保存しない）
    if (userMsg && Array.isArray(rawAttachments) && rawAttachments.length) {
      try {
        const safeAtts = rawAttachments.map((a) => ({
          name: String(a?.name || "file"),
          size: Number(a?.size || 0) || 0,
          mime: String(a?.mime || ""),
          kind: String(a?.kind || "file"),
          route: String(a?.route || "file"),
          fallback: String(a?.fallback || ""),
          dataUrl: String(a?.dataUrl || "")
        }));
        setMessageMeta(userMsg.id, { attachments: safeAtts });
        renderView();
      } catch {}
    }

    await multiAiReply(text, rawAttachments);
  };

  /* ================= special: create image (store to library) ================= */
  const createImageFromPrompt = async (prompt) => {
    addImageToLibrary({
      prompt,
      src: makePlaceholderImageDataUrl(prompt)
    });

    const line = tr("imageSavedInLibrary").replace("{images}", tr("images"));
    appendMessage("assistant", `${tr("imageSaved")}\n${line}\n\nPrompt:\n${prompt}`);
  };

  /* ================= clipboard ================= */
  const copyText = async (text) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch { return false; }
  };

  /* ================= UI bindings ================= */
    // attachment tray: force click handling (capture)
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;

    const chip = t.closest(".aurea-attach-chip");
    if (!chip) return;

    e.preventDefault();
    e.stopPropagation();

    const aid = String(chip.getAttribute("data-aid") || chip.dataset.aid || "");
    const hit = pendingAttachments.find(a => String(a.id) === aid) || null;
    if (!hit) return;

    // remove
    if (t.closest("[data-action='remove']")) {
      removeAttachmentById(aid);
      return;
    }

    // open preview
    openAttachModal(hit);
  }, true);

    // ===== board-level drag & drop (project home included) =====
const boardHasFileItems = (dt) => {
  try {
    if (!dt) return false;

    // 1) 通常ファイル
    if (dt.files && dt.files.length) return true;

    // 2) items(file)
    if (dt.items && dt.items.length) {
      if (Array.from(dt.items).some(it => it && it.kind === "file")) return true;
    }

    // 3) スクショ系（data:image / uri-list / text/plain）
    const uri =
      String(dt.getData ? (dt.getData("text/uri-list") || dt.getData("text/plain") || "") : "").trim();

    if (uri.startsWith("data:image/")) return true;
    if (/^https?:\/\/.+\.(png|jpg|jpeg|webp|gif|bmp|svg)(\?.*)?$/i.test(uri)) return true;

    return false;
  } catch { return false; }
};

  board?.addEventListener("dragover", (e) => {
    const dt = e.dataTransfer;
    if (!boardHasFileItems(dt)) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);

board?.addEventListener("drop", async (e) => {
  const dt = e.dataTransfer;
  if (!boardHasFileItems(dt)) return;

  e.preventDefault();
  e.stopPropagation();

  try { ensureAttachTray(); } catch {}

  // dt.files が空でも dt.items / uri / dataURL から拾う（スクショ/ドラッグ差異吸収）
  const collectFiles = async (dt0) => {
    try {
      if (!dt0) return [];

      // 1) 通常ファイル
      if (dt0.files && dt0.files.length) return Array.from(dt0.files);

      // 2) items(file)
      const items = Array.from(dt0.items || []).filter(it => it && it.kind === "file");
      const out = [];
      for (const it of items) {
        try {
          const f = it.getAsFile ? it.getAsFile() : null;
          if (f) out.push(f);
        } catch {}
      }
      if (out.length) return out;

      // 3) uri-list / text/plain が画像(data: / http) の場合も拾う
      const uri =
        String(dt0.getData ? (dt0.getData("text/uri-list") || dt0.getData("text/plain") || "") : "").trim();

      if (!uri) return [];

      const isDataImage = uri.startsWith("data:image/");
      const isHttpImage = /^https?:\/\/.+\.(png|jpg|jpeg|webp|gif|bmp|svg)(\?.*)?$/i.test(uri);

      if (!isDataImage && !isHttpImage) return [];

      const toFileFromDataUrl = (dataUrl) => {
        try {
          const m = /^data:([^;]+);base64,(.+)$/i.exec(String(dataUrl || "").trim());
          if (!m) return null;
          const mime = String(m[1] || "image/png").trim();
          const b64 = String(m[2] || "").trim();
          if (!b64) return null;

          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

          const ext =
            mime.includes("png") ? "png" :
            mime.includes("jpeg") ? "jpg" :
            mime.includes("webp") ? "webp" :
            mime.includes("gif") ? "gif" :
            mime.includes("bmp") ? "bmp" :
            mime.includes("svg") ? "svg" : "png";

          const name = `drop_${Date.now()}.${ext}`;
          return new File([bytes], name, { type: mime });
        } catch {
          return null;
        }
      };

      if (isDataImage) {
        const f = toFileFromDataUrl(uri);
        return f ? [f] : [];
      }

      // http(s) の画像URL：fetch して File 化
      try {
        const r = await fetch(uri, { method: "GET", mode: "cors", cache: "no-store" });
        if (!r || !r.ok) return [];
        const blob = await r.blob();
        const mime = String(blob.type || "image/png");
        const ext =
          mime.includes("png") ? "png" :
          mime.includes("jpeg") ? "jpg" :
          mime.includes("webp") ? "webp" :
          mime.includes("gif") ? "gif" :
          mime.includes("bmp") ? "bmp" :
          mime.includes("svg") ? "svg" : "png";

        const name = `drop_${Date.now()}.${ext}`;
        return [new File([blob], name, { type: mime })];
      } catch {
        return [];
      }

    } catch {
      return [];
    }
  };

  const files = await collectFiles(dt);
  if (!files.length) return;

  await addFilesAsAttachments(files);
  try { renderAttachTray(); } catch {}
  try { updateSendButtonVisibility(); } catch {}

  // GPT準拠：ドロップ後はプレビューに載せるだけ（自動送信しない）
}, true);

    /* ================= drag & drop (Ask bar attach) ================= */
  const hasFileItems = (dt) => {
    try {
      if (!dt) return false;

      // 1) 通常ファイル
      if (dt.files && dt.files.length) return true;

      // 2) items(file)
      if (dt.items && dt.items.length) {
        if (Array.from(dt.items).some(it => it && it.kind === "file")) return true;
      }

      // 3) スクショ系（data:image / uri-list / text/plain）
      const uri =
        String(dt.getData ? (dt.getData("text/uri-list") || dt.getData("text/plain") || "") : "").trim();

      if (uri.startsWith("data:image/")) return true;
      if (/^https?:\/\/.+\.(png|jpg|jpeg|webp|gif|bmp|svg)(\?.*)?$/i.test(uri)) return true;

      return false;
    } catch {
      return false;
    }
  };

  // captureで強制（PJトップでも確実に preventDefault）
  document.addEventListener("dragover", (e) => {
    const dt = e.dataTransfer;
    if (!hasFileItems(dt)) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);

document.addEventListener("drop", async (e) => {
  const dt = e.dataTransfer;
  if (!hasFileItems(dt)) return;

  e.preventDefault();
  e.stopPropagation();

  try { ensureAttachTray(); } catch {}

  const collectFiles = async (dt0) => {
    try {
      if (!dt0) return [];

      // 1) 通常ファイル
      if (dt0.files && dt0.files.length) return Array.from(dt0.files);

      // 2) items(file)
      const items = Array.from(dt0.items || []).filter(it => it && it.kind === "file");
      const out = [];
      for (const it of items) {
        try {
          const f = it.getAsFile ? it.getAsFile() : null;
          if (f) out.push(f);
        } catch {}
      }
      if (out.length) return out;

      // 3) uri-list / text/plain が画像(data: / http) の場合も拾う
      const uri =
        String(dt0.getData ? (dt0.getData("text/uri-list") || dt0.getData("text/plain") || "") : "").trim();

      if (!uri) return [];

      const isDataImage = uri.startsWith("data:image/");
      const isHttpImage = /^https?:\/\/.+\.(png|jpg|jpeg|webp|gif|bmp|svg)(\?.*)?$/i.test(uri);

      if (!isDataImage && !isHttpImage) return [];

      const toFileFromDataUrl = (dataUrl) => {
        try {
          const m = /^data:([^;]+);base64,(.+)$/i.exec(String(dataUrl || "").trim());
          if (!m) return null;
          const mime = String(m[1] || "image/png").trim();
          const b64 = String(m[2] || "").trim();
          if (!b64) return null;

          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

          const ext =
            mime.includes("png") ? "png" :
            mime.includes("jpeg") ? "jpg" :
            mime.includes("webp") ? "webp" :
            mime.includes("gif") ? "gif" :
            mime.includes("bmp") ? "bmp" :
            mime.includes("svg") ? "svg" : "png";

          const name = `drop_${Date.now()}.${ext}`;
          return new File([bytes], name, { type: mime });
        } catch {
          return null;
        }
      };

      if (isDataImage) {
        const f = toFileFromDataUrl(uri);
        return f ? [f] : [];
      }

      // http(s) の画像URL：fetch して File 化
      try {
        const r = await fetch(uri, { method: "GET", mode: "cors", cache: "no-store" });
        if (!r || !r.ok) return [];
        const blob = await r.blob();
        const mime = String(blob.type || "image/png");
        const ext =
          mime.includes("png") ? "png" :
          mime.includes("jpeg") ? "jpg" :
          mime.includes("webp") ? "webp" :
          mime.includes("gif") ? "gif" :
          mime.includes("bmp") ? "bmp" :
          mime.includes("svg") ? "svg" : "png";

        const name = `drop_${Date.now()}.${ext}`;
        return [new File([blob], name, { type: mime })];
      } catch {
        return [];
      }

    } catch {
      return [];
    }
  };

  const files = await collectFiles(dt);
  if (!files.length) return;

  await addFilesAsAttachments(files);
  try { renderAttachTray(); } catch {}
  try { updateSendButtonVisibility(); } catch {}

  // ドロップ時は Ask に入れるだけ（自動送信しない）
}, true);

  // (removed) legacy sidebar search handler
  // 検索は mountSidebarSearch() で生成される input (#aureaSearchInput) のみを使用

btnNewChat?.addEventListener("click", (e) => {
    e.preventDefault();

    // 左カラムの「新しいチャット」は常に global（PJと混線させない）
    // PJの展開状態（activeProjectId）は変更しない
    state.context = { type: "global" };

    clearPendingAttachments();
    createThread();
  });

  btnImages?.addEventListener("click", (e) => {
    e.preventDefault();
    state.view = "images";
    save(state);
    renderView();
  });

  btnShare?.addEventListener("click", async (e) => {
    e.preventDefault();
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: document.title, url });
        return;
      }
    } catch {}
    await copyText(url);
  });

  // settings open（composedPath で確実に拾う）
  const isSettingsTrigger = (node) => {
    if (!(node instanceof Element)) return false;
    return !!node.closest("[data-action='open-settings'], #btnOpenSettings, .user-pop a[aria-label='設定']");
  };

  const openSettingsIfTriggered = (e) => {
    const path = (typeof e.composedPath === "function") ? e.composedPath() : [];
    const hit = path.find(isSettingsTrigger);

    // composedPath が無い/空の環境フォールバック
    const t = hit || ((e.target instanceof Element) ? e.target : (e.target && e.target.parentElement));
    if (!t || !isSettingsTrigger(t)) return;

    e.preventDefault();
    e.stopPropagation();

    closeDetails(userMenuDetails);
    openSettings();

    // Settings表示後にi18nを再適用（DOM生成/描画遅延でも確実に反映）
    try { applyI18n(); } catch {}
    try { syncSettingsUi(); } catch {}
  };

  document.addEventListener("pointerdown", openSettingsIfTriggered, true);

  // settings close
  settingsClose?.addEventListener("click", (e) => {
    e.preventDefault();
    closeSettings();
  });

  // settings内の close（button.close）でも閉じる
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!t) return;
    if (settingsModal && settingsModal.contains(t) && t.closest("button.close")) {
      e.preventDefault();
      closeSettings();
    }
  });

linkLogout?.addEventListener("click", async (e) => {
    e.preventDefault();
    const ok1 = await confirmModal(tr("confirmLogout"));
    if (!ok1) return;

    try {
      // auth / mode / invite を完全初期化
      localStorage.removeItem("aurea_auth_state_v1");
      localStorage.removeItem("aurea_auth_mode");
      localStorage.removeItem("aurea_company_invite_v1");
    } catch {}

    window.location.href = "/login.html";
});

  // project modal close buttons
  $$(".project-modal [aria-label='閉じる']").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      closeProjectModal();
    });
  });

  // create project click
  projectCreateBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    createProject();
  });

  // enable create
  projectNameInput?.addEventListener("input", () => {
    const v = (projectNameInput.value || "").trim();
    if (projectCreateBtn) projectCreateBtn.disabled = !v;
  });

  // plus menu items（i18n対応：aria-label では判定しない）
  $$(".plus-pop a[role='menuitem']").forEach((a) => {
    const action = (a.getAttribute("data-action") || "").trim();
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      closeDetails(plusDetails);

      if (action === "add-file") {
        openFilePickerForAttachments();
        return;
      }

      if (action === "create-image") {
        const prompt = (askInput?.value || "").trim() || tr("promptEmpty");
        if (!getActiveThreadId()) createThread();
        await createImageFromPrompt(prompt);
        state.view = "images";
        save(state);
        renderSidebar();
        renderView();
        return;
      }
    });
  });

  // ask input
  if (askInput) {
    askInput.addEventListener("input", () => {
      autosizeTextarea();
      updateSendButtonVisibility();
    });

askInput.addEventListener("keydown", (e) => {
  const mode = (state?.settings?.sendMode || localStorage.getItem("aurea_send_mode") || "cmdEnter");
  const isEnter = (e.key === "Enter");
  const hasAttachments = pendingAttachments.length > 0;
  const hasText = askInput.value.trim().length > 0;

  if (!isEnter) return;

  if (mode === "cmdEnter") {
    if (e.metaKey || e.ctrlKey) {
      if (!hasText && !hasAttachments) return;
      e.preventDefault();
      send();
    }
    return;
  }

  if (mode === "enter") {
    if (!e.shiftKey) {
      if (!hasText && !hasAttachments) return;
      e.preventDefault();
      send();
    }
  }
});
  }

  sendBtn?.addEventListener("click", (e) => { e.preventDefault(); send(); });
  stopBtn?.addEventListener("click", (e) => { e.preventDefault(); stopStreaming(); });

  // mic / voice buttons removed in index.html (no-op)

/* ================= global close rules ================= */
  document.addEventListener("pointerdown", (e) => {
    const t = e.target;

    // Legal popup close: 「特定商取引法 / 利用規約 / プライバシー」以外をタップで閉じる（背景タップも閉じる）
    const legalOverlay = document.getElementById("legalOverlay");
    if (legalOverlay && legalOverlay.style.display !== "none") {
      const legalBtn = (t instanceof Element) ? t.closest(".settings-modal [data-legal]") : null;

      const legalModal = legalOverlay.querySelector(".modal");
      const insideLegalModal = isInside(legalModal, t);

      if (!legalBtn && !insideLegalModal) {
        legalOverlay.style.display = "none";
      }
    }

    // settings: 背景（overlay）を直接タップした時だけ閉じる
    // ※ radio(tab-input) や select option がモーダル外判定になって誤閉じするのを防止
    if (settingsModal && !settingsModal.hasAttribute("hidden")) {
      if (suppressSettingsBackdropOnce) {
        suppressSettingsBackdropOnce = false;
        return;
      }

      const overlay = settingsModal.querySelector(":scope > .overlay");
      if (overlay && t === overlay) {
        closeSettings();
        return;
      }
    }

    if (userMenuDetails?.hasAttribute("open") && !isInside(userMenuDetails, t)) closeDetails(userMenuDetails);
    if (plusDetails?.hasAttribute("open") && !isInside(plusDetails, t)) closeDetails(plusDetails);

    const pjPlus = document.querySelector(".pj-home-plus");
    if (pjPlus?.hasAttribute("open") && !isInside(pjPlus, t)) closeDetails(pjPlus);

    $$(".sb-more[open]").forEach(d => { if (!isInside(d, t)) closeDetails(d); });

    // project backdrop close
    if (body.classList.contains("project-open") && projectModal) {
      const card = $(".project-modal .project-card");
      if (isInside(projectModal, t) && !isInside(card, t)) closeProjectModal();
    }
  });

  document.addEventListener("toggle", (e) => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement)) return;
    if (!d.hasAttribute("open")) return;
    closeAllDetailsExcept(d);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;

    // AI Stack が開いていれば最優先で閉じる
    if (aiStackOverlay && aiStackOverlay.style.display !== "none") { closeAiStackPopup(); return; }

    // Legal modal first (inside settings)
    const legalOverlay = document.getElementById("legalOverlay");
    if (legalOverlay && legalOverlay.style.display !== "none") { legalOverlay.style.display = "none"; return; }

    // settings first
    if (settingsModal && !settingsModal.hasAttribute("hidden")) { closeSettings(); return; }

    if (body.classList.contains("project-open")) { closeProjectModal(); return; }
    if (streamTimer) { stopStreaming(); return; }

    // exit search view quickly
    if (state.view === "search") {
      if (sbSearchInput) sbSearchInput.value = "";
      state.view = "chat";
      save(state);
      renderView();
      return;
    }

    closeAllDetailsExcept(null);
  });

  /* ================= delegate clicks ================= */

  document.addEventListener("click", async (e) => {
    const t = e.target;

    // Assistant attachment preview
    const btn = t.closest(".aurea-assistant-attach");
    if (btn) {
      e.preventDefault();
      const mid = String(btn.getAttribute("data-mid") || "");
      const idx = Number(btn.getAttribute("data-idx"));
      const th = getThreadByIdInScope(getActiveThreadId());
      const msg = th?.messages?.find(m => m.id === mid);
      const att = msg?.meta?.attachments?.[idx];
      if (att) openAttachModal(att);
      return;
    }

    /* ===== Apps: SaaS card click → connect (same tab) ===== */
    const saasCard = t.closest(".panel-apps .apps-grid .saas");
    if (saasCard) {
      // status button は bindAppsConnectorsOnce() に任せる（ここでは触らない）
      if (t.closest(".status-btn")) return;

      const name = (saasCard.querySelector(".saas-name")?.textContent || "").trim();

      const goConnect = (path) => {
        const rt = encodeURIComponent(`${window.location.origin}/`);
        window.location.href = `${path}?returnTo=${rt}`;
      };

      if (name === "Google") {
        e.preventDefault();
        goConnect("/api/google/connect");
        return;
      }

      if (name === "Gmail") {
        e.preventDefault();
        goConnect("/api/gmail/connect");
        return;
      }

      if (name === "Google Drive") {
        e.preventDefault();
        goConnect("/api/drive/connect");
        return;
      }

      // それ以外はカードクリックでは何もしない
      return;
    }

    // PJ内：新しいチャット
    const pjNew = t.closest(".pj-thread[data-action='pj-new-thread']");
    if (pjNew) {
      e.preventDefault();
      const pid = pjNew.dataset.projectId;
      createProjectThread(pid);
      return;
    }

    // PJ内スレッド：••• メニュー（名前変更 / 削除）
    const pjRowMenu = t.closest(".pj-row[data-kind='pj-thread']");
    if (pjRowMenu) {
      const actionBtn = t.closest("button.sb-act");
      if (actionBtn?.dataset.action === "rename-pj-thread") {
        e.preventDefault();
        renameProjectThread(pjRowMenu.dataset.projectId, pjRowMenu.dataset.threadId);
        closeDetails(pjRowMenu.querySelector(".sb-more"));
        return;
      }
      if (actionBtn?.dataset.action === "delete-pj-thread") {
        e.preventDefault();
        await deleteProjectThread(pjRowMenu.dataset.projectId, pjRowMenu.dataset.threadId);
        closeDetails(pjRowMenu.querySelector(".sb-more"));
        return;
      }
    }

    // PJ内スレッド（pj-thread）クリック：ここでのみ project context に切替
    const pjThread = t.closest(".pj-thread[data-action='pj-open-thread']");
    if (pjThread) {
      // メニュークリックは開閉に任せる
      if (t.closest(".sb-more") || t.classList.contains("sb-dots")) return;

      e.preventDefault();
      clearPendingAttachments();

      const pid = pjThread.dataset.projectId;
      const tid = pjThread.dataset.threadId;

      if (!pid || !tid) return;

      state.activeProjectId = pid;
      state.context = { type: "project", projectId: pid };
      state.activeThreadIdByScope.projects[pid] = tid;
      state.view = "chat";

      save(state);
      renderSidebar();
      renderView();
      askInput?.focus();
      return;
    }

    // project row click / menu
    const pRow = t.closest(".sb-row[data-kind='project']");
    if (pRow && projectList && projectList.contains(pRow)) {
      const id = pRow.dataset.id;

      const actionBtn = t.closest("button.sb-act");
      if (actionBtn?.dataset.action === "rename-project") {
        e.preventDefault();
        renameProject(id);
        closeDetails(pRow.querySelector(".sb-more"));
        return;
      }
      if (actionBtn?.dataset.action === "delete-project") {
        e.preventDefault();
        await deleteProject(id);
        closeDetails(pRow.querySelector(".sb-more"));
        return;
      }

      if (t.closest(".sb-more") || t.classList.contains("sb-dots")) return;

      e.preventDefault();
      clearPendingAttachments();

      // 1回目：PJトップ（プロジェクト名＋新規Ask＋履歴）を表示するための状態へ
      // 2回目（同PJ再クリック）：PJ内で新規トーク作成→即オープン
      const same = (state.view === "project" && state.activeProjectId === id);

      if (same) {
        createProjectThread(id);
        return;
      }

      state.activeProjectId = id;
      state.view = "project";
      save(state);

      renderSidebar();
      renderView();
      askInput?.focus();
      return;
    }

    // thread row click / menu（チャット欄は global）
    const thRow = t.closest(".sb-row[data-kind='thread']");
    if (thRow && chatList && chatList.contains(thRow)) {
      const id = thRow.dataset.id;

      const actionBtn = t.closest("button.sb-act");
      if (actionBtn?.dataset.action === "rename-thread") {
        e.preventDefault();
        renameThread(id);
        closeDetails(thRow.querySelector(".sb-more"));
        return;
      }
      if (actionBtn?.dataset.action === "delete-thread") {
        e.preventDefault();
        await deleteThread(id);
        closeDetails(thRow.querySelector(".sb-more"));
        return;
      }

      if (t.closest(".sb-more") || t.classList.contains("sb-dots")) return;

      e.preventDefault();
      clearPendingAttachments();
      state.context = { type: "global" };
      setActiveThreadId(id);
      state.view = "chat";
      save(state);

      renderSidebar();
      renderView();
      askInput?.focus();
      return;
    }

    // PJトップ：履歴の「名前変更 / 削除」
    const pjHomeAct = t.closest("button.pj-home-act[data-action]");
    if (pjHomeAct) {
      e.preventDefault();
      e.stopPropagation();

      const pid = String(pjHomeAct.getAttribute("data-project-id") || "");
      const tid = String(pjHomeAct.getAttribute("data-thread-id") || "");
      const act = String(pjHomeAct.getAttribute("data-action") || "");

      if (act === "pj-home-rename") {
        renameProjectThread(pid, tid);
        renderView();
        return;
      }

      if (act === "pj-home-delete") {
        await deleteProjectThread(pid, tid);
        return;
      }
    }

    // search card click / project home row click
    const sCard = t.closest(".search-card, .pj-home-row");
    if (sCard && sCard.dataset.threadId) {
      e.preventDefault();
      openThreadFromSearchHit({
        scopeType: sCard.dataset.scopeType,
        projectId: sCard.dataset.projectId || null,
        threadId: sCard.dataset.threadId
      });
      return;
    }

    // user message edit (GPT-like)
    const editUserBtn = t.closest(".act[data-action='edit-user-message']");
    if (editUserBtn) {
      e.preventDefault();
      if (typeof window.__AUREA_STREAMING_MID__ === "string" && window.__AUREA_STREAMING_MID__) return;

      const mid = String(editUserBtn.dataset.mid || "");
      if (!mid) return;

      window.__AUREA_EDITING_USER_MID__ = mid;
      renderChat();

      // focus textarea
      setTimeout(() => {
        try {
          const ta = document.querySelector(".msg.user .bubble textarea[data-role='user-edit']");
          ta?.focus();
          ta?.setSelectionRange(ta.value.length, ta.value.length);
        } catch {}
      }, 0);

      return;
    }

    const cancelEditBtn = t.closest("[data-action='cancel-user-edit']");
    if (cancelEditBtn) {
      e.preventDefault();
      window.__AUREA_EDITING_USER_MID__ = "";
      renderChat();
      return;
    }

    const saveEditBtn = t.closest("[data-action='save-user-edit']");
    if (saveEditBtn) {
      e.preventDefault();
      if (typeof window.__AUREA_STREAMING_MID__ === "string" && window.__AUREA_STREAMING_MID__) return;

      const mid = String(saveEditBtn.getAttribute("data-mid") || "");
      if (!mid) return;

      const th = getThreadByIdInScope(getActiveThreadId());
      if (!th || !Array.isArray(th.messages)) return;

      const ta = document.querySelector(".msg.user .bubble textarea[data-role='user-edit']");
      const nextText = String(ta ? ta.value : "").trim();
      if (!nextText) return;

      // 1) update edited user message
      try { updateMessage(mid, nextText); } catch {}

      // 2) truncate messages after this user message (GPT-like: regenerate from here)
      try {
        const idx = th.messages.findIndex(x => x && x.id === mid);
        if (idx >= 0) {
          th.messages = th.messages.slice(0, idx + 1);
          th.updatedAt = nowISO();
          save(state);
        }
      } catch {}

      // 3) exit edit mode and rerender
      window.__AUREA_EDITING_USER_MID__ = "";
      renderSidebar();
      renderView();

      // 4) regenerate assistant response from edited user message (no attachments)
      await multiAiReply(nextText, []);

      return;
    }

    // open AI reports (repo icon)
    const repBtn = t.closest(".act[data-action='open-reports']");
    if (repBtn) {
      e.preventDefault();

      // disabled時は開かない
      if (repBtn.dataset.disabled === "1") return;

      const mid = repBtn.dataset.mid;
      const th = getThreadByIdInScope(getActiveThreadId());
      const msg = th?.messages?.find(m => m.id === mid);

      const raw = String(msg?.meta?.reportsRaw || "").trim();
      openAiReportsModal(mid, raw);
      return;
    }

    // copy assistant message
    const copyBtn = t.closest(".act[data-action='copy-message']");
    if (copyBtn) {
      e.preventDefault();

      // guard: prevent rapid re-click flicker
      if (copyBtn.dataset.busy === "1") return;
      copyBtn.dataset.busy = "1";

      // keep original icon once
      if (!copyBtn.dataset.origHtml) {
        copyBtn.dataset.origHtml = copyBtn.innerHTML || "";
      }

      const mid = copyBtn.dataset.mid;
      const th = getThreadByIdInScope(getActiveThreadId());
      const msg = th?.messages?.find(m => m.id === mid);

      const ok = msg ? await copyText(msg.content || "") : false;

      // UI feedback: copy -> checkmark -> revert
      if (ok) {
        copyBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 6L9 17l-5-5"></path>
          </svg>
        `;
      }

      setTimeout(() => {
        copyBtn.innerHTML = copyBtn.dataset.origHtml || "";
        copyBtn.dataset.busy = "0";
      }, ok ? 900 : 150);

      return;
    }

    // images view buttons
    const imgBtn = t.closest(".img-btn");
    if (imgBtn) {
      e.preventDefault();
      const card = t.closest(".img-card");
      const id = card?.dataset?.id;
      if (!id) return;

      const act = imgBtn.dataset.action;
      const item = state.images.find(x => x.id === id);
      if (!item) return;

      if (act === "delete") {
        await deleteImageFromLibrary(id);
        return;
      }

      if (act === "download") {
        const a = document.createElement("a");
        a.href = item.src;

        const ts = String(item.createdAt || "").replace(/[:.]/g, "-");
        a.download = `aurea-image-${ts || id}.png`;

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
      }

      if (act === "open") {
        window.open(item.src, "_blank", "noopener,noreferrer");
        return;
      }
    }

    // create project button (static kept row)
    const createP = t.closest(".sb-create-project");
    if (createP) {
      e.preventDefault();
      openProjectModal();
      return;
    }
  });

  /* ================= auth / welcome gate ================= */
  const AUTH_MODE_KEY = "aurea_auth_mode"; // "personal" | "company"
  const AUTH_STATE_KEY = "aurea_auth_state_v1"; // json
  const INVITE_KEY = "aurea_company_invite_v1"; // json { token, receivedAt }

  const getAuthMode = () => {
    try {
      const v = localStorage.getItem(AUTH_MODE_KEY);
      return (v === "company") ? "company" : (v === "personal" ? "personal" : null);
    } catch { return null; }
  };

  const setAuthMode = (mode) => {
    try { localStorage.setItem(AUTH_MODE_KEY, mode); } catch {}
  };

  const getAuthState = () => {
    try {
      const raw = localStorage.getItem(AUTH_STATE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return (obj && typeof obj === "object") ? obj : null;
    } catch { return null; }
  };

  const setAuthState = (obj) => {
    try { localStorage.setItem(AUTH_STATE_KEY, JSON.stringify(obj || {})); } catch {}
  };

  const clearAuthState = () => {
    try { localStorage.removeItem(AUTH_STATE_KEY); } catch {}
  };

  const getInvite = () => {
    try {
      const raw = localStorage.getItem(INVITE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return (obj && typeof obj === "object") ? obj : null;
    } catch { return null; }
  };

  const setInvite = (obj) => {
    try { localStorage.setItem(INVITE_KEY, JSON.stringify(obj || {})); } catch {}
  };

  const clearInvite = () => {
    try { localStorage.removeItem(INVITE_KEY); } catch {}
  };

  const authGate = document.getElementById("authGate");
  const appRoot = document.querySelector(".app");
  const btnAuthPersonal = document.getElementById("btnAuthPersonal");
  const btnAuthCompany = document.getElementById("btnAuthCompany");

  // authGate UI は廃止（login.html に一本化）
  try { authGate?.remove(); } catch {}

  const ensureGateMessage = () => {
    if (!authGate) return null;
    let msg = document.getElementById("authGateMsg");
    if (msg) return msg;

    msg = document.createElement("div");
    msg.id = "authGateMsg";
    msg.style.cssText = "margin-top:12px;opacity:.92;font-size:12px;line-height:1.55;color:#fff;";

    const btn = authGate.querySelector("#btnAuthPersonal") || authGate.querySelector("#btnAuthCompany");
    const btnRow = btn ? btn.closest("div") : null;
    const panel = btnRow ? btnRow.parentElement : null;

    const host = panel || authGate;
    host.appendChild(msg);

    return msg;
  };

  const setGateMessage = (text) => {
    const msg = ensureGateMessage();
    if (!msg) return;
    msg.textContent = text || "";
    msg.style.display = text ? "block" : "none";
  };

  const showAuthGate = () => {
    try {
      if (appRoot) appRoot.setAttribute("aria-hidden", "true");
      document.body.classList.add("data-auth-required");
    } catch {}
  };

    const hideAuthGate = () => {
    try {
      if (appRoot) appRoot.removeAttribute("aria-hidden");
      document.body.classList.remove("data-auth-required");
    } catch {}
  };

    const startGoogleLogin = (mode) => {
    // Googleログインは login.html で実行（Email/Password導線は作らない）
    const m = (mode === "company") ? "company" : "personal";
    const invite = getInvite();
    const st = getAuthState();

    // Company は invite 必須（authState 残留でも通さない）
    if (m === "company") {
      if (!invite?.token) {
        setGateMessage("この招待URLは無効です。管理者に再招待を依頼してください。");
        return;
      }
      if (st?.loggedIn) {
        setGateMessage("一度ログアウトしてください。招待URL経由でのみログイン可能です。");
        return;
      }
    }

    const url = new URL("/login.html", window.location.origin);
    url.searchParams.set("mode", m);

    // company 招待（token）を login.html 側へ渡す
    if (m === "company" && invite?.token) {
      url.searchParams.set("invite", String(invite.token));
    }

    window.location.href = url.toString();
  };

  // URL params（招待 / auth戻り）
  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get("invite");
  const authResult = params.get("auth"); // "ok" | "error"
  const authReason = params.get("reason") || ""; // "invite_expired" | "invite_used" | etc
  const authEmail = params.get("email") || "";
  const authUid = params.get("uid") || "";

  // 招待リンクから来た場合：company固定 + token保存 + 次回自動
  if (inviteToken) {
    setAuthMode("company");
    window.__AUREA_AUTH_MODE__ = "company";
    setInvite({ token: String(inviteToken), receivedAt: nowISO() });
  }

// login.html からの戻り（OKなら入場、ERRORならGateに留める）
if (authResult === "ok") {
  // company invite は一度成功したら破棄（再利用防止）
  clearInvite();

  const email = String(authEmail || "").trim();
  const uid = String(authUid || "").trim();

  setAuthState({
    loggedIn: true,
    mode: getAuthMode() || (inviteToken ? "company" : "personal"),
    email,
    uid,
    authedAt: nowISO()
  });

  // ===== UI用 user 情報を state に反映（初回ユーザー体験のため必須）=====
  try {
    if (!state.user || typeof state.user !== "object") state.user = {};

    // email
    state.user.email = email;

    // displayName（Google表示名はこの戻りでは取れないので、初回はメールのローカル部を使う）
    if (!String(state.user.displayName || "").trim()) {
      const local = email ? email.split("@")[0] : "";
      state.user.displayName = local || "";
    }

    // trusted device は初回は「この端末」として扱う（固定値は禁止）
    const ua = String(navigator.userAgent || "");
    const isChrome = /Chrome\//.test(ua) && !/Edg\//.test(ua) && !/OPR\//.test(ua);
    const isSafari = /Safari\//.test(ua) && !/Chrome\//.test(ua);
    const isEdge = /Edg\//.test(ua);
    const isFirefox = /Firefox\//.test(ua);

    const browser =
      isEdge ? "Edge" :
      isChrome ? "Chrome" :
      isFirefox ? "Firefox" :
      isSafari ? "Safari" : "Browser";

    const platform = String(navigator.platform || "").trim() || "Device";

    state.user.trustedDevice = `${platform} ・ ${browser}`;
    state.user.deviceTrusted = true;

    save(state);
  } catch {}

  // Gate解除
  setGateMessage("");
  hideAuthGate();

  // 反映
  try { syncAccountUi(); } catch {}
  try { syncSettingsUi(); } catch {}

  // クエリ掃除（履歴汚染防止）
  history.replaceState({}, document.title, "/");
} else if (authResult === "error") {

    // エラー文言（再招待ボタン等は一切出さない）
    let msg = "ログインに失敗しました。管理者に確認してください。";

    if (authReason === "invite_expired") {
      msg = "この招待URLは期限切れです（有効期限：発行から7日）。管理者に再招待を依頼してください。";
    } else if (authReason === "invite_used") {
      msg = "この招待URLは既に使用済みです。管理者に再招待を依頼してください。";
    } else if (authReason === "invite_invalid") {
      msg = "この招待URLは無効です。管理者に再招待を依頼してください。";
    } else if (authReason === "domain_not_allowed") {
      msg = "このGoogleアカウントは企業利用に対応していません。管理者に確認してください。";
    } else if (authReason === "company_personal_blocked") {
      msg = "企業アカウントはPersonal利用できません。個人利用は個人アドレスで登録してください。";
    }

    setGateMessage(msg);

    // クエリ掃除
    history.replaceState({}, document.title, "/");
  }

    // auth gate buttons: capture fallback (clickが拾われない環境対策)
  document.addEventListener("pointerdown", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;

    const b = t.closest("#btnAuthPersonal, #btnAuthCompany");
    if (!b) return;

    e.preventDefault();
    e.stopPropagation();

    if (b.id === "btnAuthPersonal") {
      // 企業アカウントを personal にさせない（別アドレス運用）
      const st2 = getAuthState();
      if (st2?.loggedIn && st2.mode === "company") {
        setGateMessage("企業アカウントはPersonal利用できません。個人利用は個人アドレスで登録してください。");
        return;
      }

      setAuthMode("personal");
      window.__AUREA_AUTH_MODE__ = "personal";
      clearInvite();
      startGoogleLogin("personal");
      return;
    }

    if (b.id === "btnAuthCompany") {
      // Company は invite 必須（無ければ遷移させない）
      const inv = getInvite();
      if (!(inv?.token)) {
        setGateMessage("この招待URLは無効です。管理者に再招待を依頼してください。");
        return;
      }

      setAuthMode("company");
      window.__AUREA_AUTH_MODE__ = "company";
      startGoogleLogin("company");
    }
  }, true);

  btnAuthPersonal?.addEventListener("click", (e) => {
    e.preventDefault();

    // 企業アカウントを personal にさせない（別アドレス運用）
    const st2 = getAuthState();
    if (st2?.loggedIn && st2.mode === "company") {
      setGateMessage("企業アカウントはPersonal利用できません。個人利用は個人アドレスで登録してください。");
      return;
    }

    setAuthMode("personal");
    window.__AUREA_AUTH_MODE__ = "personal";
    clearInvite();
    startGoogleLogin("personal");
  });

  btnAuthCompany?.addEventListener("click", (e) => {
    e.preventDefault();

    // Company は invite 必須（無ければ遷移させない）
    const inv = getInvite();
    if (!(inv?.token)) {
      setGateMessage("この招待URLは無効です。管理者に再招待を依頼してください。");
      return;
    }

    setAuthMode("company");
    window.__AUREA_AUTH_MODE__ = "company";
    startGoogleLogin("company");
  });

    // ===== auth startup guard =====
  (() => {
    const st = getAuthState();
    if (!st || !st.loggedIn) {
      showAuthGate();
      return;
    }
    hideAuthGate();
  })();

  /* ================= boot ================= */
  if (!state.plan) state.plan = "Free";

  if (!state.user) {
    state.user = {
      displayName: "",
      email: "",
      trustedDevice: "",
      deviceTrusted: false
    };
  }

  if (typeof state.user.deviceTrusted !== "boolean") state.user.deviceTrusted = true;

  if (!state.context || (state.context.type !== "global" && state.context.type !== "project")) {
    state.context = { type: "global" };
  }

  if (!state.threads) state.threads = { global: [], projects: {} };
  if (!state.threads.global) state.threads.global = [];
  if (!state.threads.projects) state.threads.projects = {};
  if (!state.projects) state.projects = [];
  if (!state.images) state.images = [];

  // 起動時：履歴から画像ライブラリを自動復元（重複なし）
  try { repairImagesLibraryFromThreads(); } catch {}

  // 旧state互換（settings/apps/customApps が無い場合の補完）
  if (!state.settings) {
    state.settings = {
      theme: "dark",        // "system" | "light" | "dark"
      sendMode: "cmdEnter", // "cmdEnter" | "enter"
      dataStorage: "cloud", // "cloud" | "local"
      language: "ja",       // "ja" | "en"
      showAiReports: false
    };
  }

  // v1: AI Reports はデフォルト非表示（初回のみ false）
  // 既存ユーザーの設定は localStorage / state を尊重する
  if (typeof state.settings.showAiReports !== "boolean") {
    state.settings.showAiReports = false;
  }

  // 保存先（クラウド/端末内）を常に優先（起動時に反映）
  state.settings.dataStorage = getStorageMode();

  if (!state.apps) {
    state.apps = {
      Google: false,
      Gmail: false,
      "Google Drive": false,
      GitHub: false,
      Notion: false,
      Slack: false,
      Dropbox: false,
      Jira: false,
      Salesforce: false,
      Zoom: false
    };
  }
  if (!Array.isArray(state.customApps)) state.customApps = [];

  /* ===== i18n (v1) ===== */

  // Apps connectors click (bind once)
  let appsClickBound = false;
  const bindAppsConnectorsOnce = () => {
    if (appsClickBound) return;
    appsClickBound = true;

    document.addEventListener("click", async (e) => {
      const t = e.target;

      const btn = t.closest(".panel-apps .status-btn");
      if (!btn) return;

      const card = btn.closest(".saas");
      const name = (card?.querySelector(".saas-name")?.textContent || "").trim();
      if (!name) return;

      const isCustom = (Array.isArray(state.customApps) && state.customApps.some(a => a.name === name));

      const on = isCustom
        ? !!(state.customApps.find(a => a.name === name)?.connected)
        : !!state.apps?.[name];

      if (!on) {
        const msg = (name === "Google" || name === "Gmail" || name === "Google Drive")
          ? tr("confirmConnectGoogle")
          : tr("confirmConnectSaas").replace("{name}", name);

        const ok = await confirmModal(msg);
        if (!ok) return;

        if (name === "Google" || name === "Gmail" || name === "Google Drive") {
          const url =
            (name === "Gmail") ? "/api/gmail/connect"
            : (name === "Google Drive") ? "/api/drive/connect"
            : "/api/google/connect";

          const rt = encodeURIComponent(`${window.location.origin}/`);
          window.location.href = `${url}?returnTo=${rt}`;
          return;
        }

        if (isCustom) {
          const a = state.customApps.find(x => x.name === name);
          if (a) a.connected = true;
        } else {
          state.apps[name] = true;
        }

        save(state);
        syncSettingsUi();
        return;
      }

      {
        const ok = await confirmModal(tr("confirmDisconnectSaas").replace("{name}", name));
        if (!ok) return;

        if (isCustom) {
          const a = state.customApps.find(x => x.name === name);
          if (a) a.connected = false;
        } else {
          state.apps[name] = false;
        }

        save(state);
        syncSettingsUi();
      }
    });
  };

  /* ================= SaaS add popup (UI only) ================= */
  let saasAddWrap = null;

  const pickFirstOkUrl = async (paths) => {
    for (const p of paths) {
      try {
        const r = await fetch(p, { method: "HEAD" });
        if (r && r.ok) return p;
      } catch {}
    }
    return paths[0] || "";
  };

  const startGoogleAccountConnect = async (serviceName) => {
    const name = String(serviceName || "Google");

    // Hosting rewrite で /ai/* が index.html を返す環境があるため、/api/* を優先
    const paths =
      (name === "Gmail")
        ? ["/api/gmail/connect", "/api/google/connect", "/ai/gmail/connect", "/ai/google/connect"]
        : (name === "Google Drive")
          ? ["/api/drive/connect", "/api/google/connect", "/ai/drive/connect", "/ai/google/connect"]
          : ["/api/google/connect", "/api/drive/connect", "/ai/google/connect", "/ai/drive/connect"];

    const url = await pickFirstOkUrl(paths);
    if (!url) return;

    window.open(url, "_blank", "noopener,noreferrer");
  };

  const SAAS_CATALOG = [
    { name: "Google",        icon: `<i class="fa-brands fa-google"></i>`,        desc: "Googleアカウント連携" },
    { name: "Gmail",         icon: `<i class="fa-solid fa-envelope"></i>`,       desc: "メールの検索・参照" },
    { name: "Google Drive",  icon: `<i class="fa-brands fa-google-drive"></i>`,  desc: "Driveの検索・参照" }
  ];

  function ensureAppsGrid(){
    const grid = document.querySelector(".panel-apps .apps-grid");
    if (!grid) return;

    // 既にカードがあるなら何もしない
    if (grid.querySelector(".saas")) return;

    const custom = Array.isArray(state.customApps)
      ? state.customApps.map(a => ({
          name: a.name,
          icon: `<i class="fa-solid fa-plug"></i>`,
          _custom: true
        }))
      : [];

    const merged = [...SAAS_CATALOG, ...custom];

    merged.forEach((s) => {
      const isCustom = !!s._custom;
      const on = isCustom
        ? !!(state.customApps.find(a => a.name === s.name)?.connected)
        : !!state.apps?.[s.name];

      const card = document.createElement("div");
      card.className = "saas";
      card.innerHTML = `
        <div class="saas-top">
          <div class="brand" aria-hidden="true">${s.icon}</div>
        </div>
        <div>
          <div class="saas-name">${escHtml(s.name)}</div>
          <button class="status-btn ${on ? "on" : "off"}" type="button" aria-pressed="${on ? "true" : "false"}">${escHtml(on ? tr("connected") : tr("notConnected"))}</button>
        </div>
      `;

      grid.appendChild(card);
    });
  }

  const ensureSaasAddPopup = () => {
    if (saasAddWrap) return saasAddWrap;

    saasAddWrap = document.createElement("div");
    saasAddWrap.id = "aureaSaasAdd";
    saasAddWrap.setAttribute("aria-hidden", "true");
    saasAddWrap.style.cssText = `
      position:fixed; inset:0; display:none; align-items:center; justify-content:center;
      background:rgba(0,0,0,.45); z-index:10060; padding:18px;
    `;

    saasAddWrap.innerHTML = `
      <div id="aureaSaasAddCard" style="
        width:min(720px, calc(100% - 24px));
        max-height:calc(100vh - 64px);
        background:rgba(20,21,22,.96);
        border:1px solid rgba(255,255,255,.10);
        border-radius:18px;
        box-shadow:0 10px 30px rgba(0,0,0,.45);
        overflow:hidden;
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        color:rgba(255,255,255,.92);
        font-family: -apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Hiragino Sans','Noto Sans JP',sans-serif;
        display:flex;
        flex-direction:column;
        min-width:0;
      ">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08);">
          <div style="font-size:14px;font-weight:600;">${escHtml(tr("addSaas"))}</div>
          <button type="button" data-action="close" style="
            width:36px;height:36px;border-radius:12px;border:1px solid rgba(255,255,255,.12);
            background:rgba(255,255,255,.06);color:rgba(255,255,255,.92);
            cursor:pointer; font-size:18px; line-height:34px;
          ">×</button>
        </div>

        <div style="padding:14px 16px 16px;display:flex;flex-direction:column;gap:12px;">
          <div style="display:flex;flex-direction:column;gap:6px;">
            <div style="font-size:12px;opacity:.72;">${escHtml(tr("saasName"))}</div>
            <input id="aureaSaasName" type="text" placeholder="${escHtml(tr("saasNamePh"))}" style="
              width:100%;height:40px;border-radius:12px;border:1px solid rgba(255,255,255,.12);
              background:rgba(255,255,255,.05);color:rgba(255,255,255,.92);
              outline:none;padding:0 12px;font-size:13px;
            "/>
          </div>

          <div style="display:flex;flex-direction:column;gap:6px;">
            <div style="font-size:12px;opacity:.72;">${escHtml(tr("apiBaseUrl"))}</div>
            <input id="aureaSaasBaseUrl" type="text" placeholder="${escHtml(tr("apiBaseUrlPh"))}" style="
              width:100%;height:40px;border-radius:12px;border:1px solid rgba(255,255,255,.12);
              background:rgba(255,255,255,.05);color:rgba(255,255,255,.92);
              outline:none;padding:0 12px;font-size:13px;
            "/>
          </div>

          <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;">
            <div style="flex:1;min-width:220px;display:flex;flex-direction:column;gap:6px;">
              <div style="font-size:12px;opacity:.72;">${escHtml(tr("authMode"))}</div>
              <select id="aureaSaasAuthMode" style="
                width:100%;height:40px;border-radius:12px;border:1px solid rgba(255,255,255,.12);
                background:rgba(255,255,255,.05);color:rgba(255,255,255,.92);
                outline:none;padding:0 10px;font-size:13px;
              ">
                <option value="apiKey">${escHtml(tr("authApiKey"))}</option>
                <option value="bearer">${escHtml(tr("authBearer"))}</option>
              </select>
            </div>

            <div style="flex:2;min-width:260px;display:flex;flex-direction:column;gap:6px;">
              <div style="font-size:12px;opacity:.72;">${escHtml(tr("apiToken"))}</div>
              <input id="aureaSaasToken" type="password" placeholder="${escHtml(tr("apiTokenPh"))}" style="
                width:100%;height:40px;border-radius:12px;border:1px solid rgba(255,255,255,.12);
                background:rgba(255,255,255,.05);color:rgba(255,255,255,.92);
                outline:none;padding:0 12px;font-size:13px;
              "/>
            </div>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:10px;padding-top:6px;">
            <button type="button" data-action="cancel" style="
              height:40px;padding:0 14px;border-radius:12px;border:1px solid rgba(255,255,255,.12);
              background:transparent;color:rgba(255,255,255,.86);cursor:pointer;font-size:13px;
            ">${escHtml(tr("cancel"))}</button>
            <button type="button" data-action="save" style="
              height:40px;padding:0 14px;border-radius:12px;border:1px solid rgba(255,255,255,.12);
              background:rgba(255,255,255,.08);color:rgba(255,255,255,.92);cursor:pointer;font-size:13px;
            ">${escHtml(tr("save"))}</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(saasAddWrap);

    saasAddWrap.addEventListener("click", (e) => {
      if (e.target === saasAddWrap) closeSaasAddPopup();
    });

    saasAddWrap.addEventListener("click", (e) => {
      const t = e.target;

      const closeBtn = t.closest("[data-action='close']");
      if (closeBtn) { e.preventDefault(); closeSaasAddPopup(); return; }

      const cancelBtn = t.closest("[data-action='cancel']");
      if (cancelBtn) { e.preventDefault(); closeSaasAddPopup(); return; }

      const saveBtn = t.closest("[data-action='save']");
      if (!saveBtn) return;

      e.preventDefault();

      const name = (document.getElementById("aureaSaasName")?.value || "").trim();
      const baseUrl = (document.getElementById("aureaSaasBaseUrl")?.value || "").trim();
      const authMode = (document.getElementById("aureaSaasAuthMode")?.value || "apiKey").trim();
      const token = (document.getElementById("aureaSaasToken")?.value || "").trim();

      if (!name) return;

      state.customApps = Array.isArray(state.customApps) ? state.customApps : [];
      const exists = state.customApps.some(a => (a.name || "").trim() === name);
      if (!exists) {
        state.customApps.unshift({
          name,
          baseUrl,
          authMode: (authMode === "bearer") ? "bearer" : "apiKey",
          token,
          connected: false,
          createdAt: nowISO()
        });
        save(state);
      }

      syncSettingsUi();
      closeSaasAddPopup();
    });

    return saasAddWrap;
  };

  const renderSaasAddList = (q) => {
    void q;
  };

  const openSaasAddPopup = () => {
    ensureSaasAddPopup();

    const n = document.getElementById("aureaSaasName");
    const u = document.getElementById("aureaSaasBaseUrl");
    const m = document.getElementById("aureaSaasAuthMode");
    const k = document.getElementById("aureaSaasToken");

    if (n) n.value = "";
    if (u) u.value = "";
    if (m) m.value = "apiKey";
    if (k) k.value = "";

    saasAddWrap.style.display = "flex";
    saasAddWrap.setAttribute("aria-hidden", "false");
  };

  const closeSaasAddPopup = () => {
    if (!saasAddWrap) return;
    saasAddWrap.style.display = "none";
    saasAddWrap.setAttribute("aria-hidden", "true");
  };

  // Settings bindings (General / Apps / Data / Account)
  const bindSettings = () => {

        const chkAi = document.getElementById("settingsShowAiReports");
    if (chkAi) {
      chkAi.addEventListener("change", () => {
        state.settings.showAiReports = !!chkAi.checked;
        try { persistEverywhereMain(); } catch { save(state); }
        renderView();
      });
    }

    /* ===== General ===== */
    const selTheme = document.querySelector(".settings-modal #settingsTheme");
    const selLang  = document.querySelector(".settings-modal #settingsLang");
    const selSend  = document.querySelector(".settings-modal #settingsSendMode");

    const saveSettings = () => {
      save(state);
      syncSettingsUi();
      syncAccountUi();
    };

    if (selTheme) {
      selTheme.addEventListener("change", () => {
        const v = (selTheme.value || "dark").trim();
        state.settings.theme = (v === "light" || v === "system" || v === "dark") ? v : "dark";
        saveSettings();
      });
    }

    if (selLang) {
      selLang.addEventListener("change", () => {
        const v = (selLang.value || "ja").trim();
        state.settings.language = String(v).toLowerCase().startsWith("en") ? "en" : "ja";

        // 既に生成済みのポップアップは文言が固定化されるため、破棄して作り直す
        const cm = document.getElementById("aureaConfirmModal");
        if (cm) cm.remove();

        const sp = document.getElementById("aureaSaasAdd");
        if (sp) sp.remove();
        saasAddWrap = null;

        const pm = document.getElementById("aureaPlanModal");
        if (pm) pm.remove();

        // Trainer: 既に生成済みの「ケース追加」モーダルも破棄（言語固定化対策）
        const tm = document.getElementById("aureaTrainerCaseModal");
        if (tm) tm.remove();

        // Trainer: 辞書ポップも破棄（見出しが固定化されるため、リロード不要で更新）
        if (window.trainerDictWrap) {
          window.trainerDictWrap.remove();
          window.trainerDictWrap = null;
        }
        try { window.trainerSelectedId = null; } catch {}

        saveSettings();
        applyI18n();
        renderSidebar();

        // 強制再描画（混在防止）
        clearBoardViewNodes();
        renderView();

        // Lang反映後の select 表示幅も追従（見切れ/余白ズレ防止）
        syncSettingsUi();

        // Trainer: 「まだケースがありません。」等を言語に追従させるため再描画
        try { renderTrainerCases(); } catch {}
      });
    }

    if (selSend) {
      selSend.addEventListener("change", () => {
        const v = (selSend.value || "cmdEnter").trim();
        const mode = (v === "enter") ? "enter" : "cmdEnter";
        state.settings.sendMode = mode;
        try { localStorage.setItem("aurea_send_mode", mode); } catch {}
        saveSettings();
      });
    }

    // Data storage dropdown (cloud/local)
    const isGoogleConnected = () => {
      try { return !!state.apps?.Google; } catch { return false; }
    };

    const isFreePlan = () => {
      const p = String(state.plan || "Free").trim();
      return (p === "Free");
    };

    const openPlanModalForCloudStorage = () => {
      // bindSettings() 実行後は btnBilling に click handler が付与されるので、ここはクリックで開く
      const btn = document.getElementById("btnBilling");
      if (btn) {
        try { btn.click(); } catch {}
        return;
      }

      // fallback: 既に存在する場合は直接開く
      const m = document.getElementById("aureaPlanModal");
      if (m) {
        m.style.display = "flex";
        m.setAttribute("aria-hidden", "false");
      }
    };

    const setStorageMode = (nextMode) => {
      const mode = (nextMode === "local") ? "local" : "cloud";
      const prevKey = getStorageKey();

      try { localStorage.setItem(STORAGE_PREF_KEY, mode); } catch {}

      state.settings.dataStorage = mode;

      // 移行：新キーへ保存（旧キーは保持）
      try { localStorage.setItem(getStorageKey(), JSON.stringify(state)); } catch {}

      saveSettings();
      void prevKey;
    };

    const startGoogleConnectForCloudStorage = () => {
      try { localStorage.setItem(PENDING_STORAGE_MODE_KEY, "cloud"); } catch {}

      const rt = encodeURIComponent(`${window.location.origin}/`);
      window.location.href = `/api/google/connect?returnTo=${rt}`;
    };

    // Use existing buttons in index.html (btnStorageCloud / btnStorageLocal)
    const btnCloud = document.getElementById("btnStorageCloud");
    const btnLocal = document.getElementById("btnStorageLocal");

    const applyToggleUi = (mode) => {
      const isLocal = (mode === "local");
      if (btnCloud) btnCloud.classList.toggle("is-active", !isLocal);
      if (btnLocal) btnLocal.classList.toggle("is-active", isLocal);
      syncSettingsUi();
    };

    btnCloud?.addEventListener("click", () => {
      // cloud is Pro gated
      if (isFreePlan()) {
        try { localStorage.setItem(PENDING_STORAGE_MODE_KEY, "cloud"); } catch {}
        openPlanModalForCloudStorage();
        applyToggleUi("local");
        return;
      }

      // cloud requires Google connect
      if (!isGoogleConnected()) {
        startGoogleConnectForCloudStorage();
        applyToggleUi("local");
        return;
      }

      setStorageMode("cloud");
      applyToggleUi("cloud");
    });

    btnLocal?.addEventListener("click", () => {
      setStorageMode("local");
      applyToggleUi("local");
    });

/* ===== Apps ===== */
    const btnAddSaas = document.querySelector(".panel-apps .apps-header .btn");
    btnAddSaas?.addEventListener("click", (e) => {
      e.preventDefault();
      openSaasAddPopup();
    });

    bindAppsConnectorsOnce();

    /* ===== Data ===== */
    const btnDeleteAll = document.getElementById("btnDeleteAllChats");
    btnDeleteAll?.addEventListener("click", async (e) => {
      e.preventDefault();
      const ok = await confirmModal(tr("confirmDeleteAllChats"));
      if (!ok) return;

      state.threads.global = [];
      state.threads.projects = {};
      state.activeThreadIdByScope.global = null;
      state.activeThreadIdByScope.projects = {};
      state.context = { type: "global" };
      state.activeProjectId = null;

      save(state);
      renderSidebar();
      renderView();
    });

    const kbBtns = Array.from(document.querySelectorAll(".panel-data .section[aria-label='ナレッジベース'] .btn.secondary"));

    const pickFirstOkUrl = async (paths) => {
      for (const p of paths) {
        try {
          const r = await fetch(p, { method: "HEAD" });
          if (r && r.ok) return p;
        } catch {}
      }
      return paths[0] || "";
    };

    const startGoogleDriveConnect = async () => {
      // 既存AI Earth側の実装に寄せてパス候補を用意（存在する方へ）
      const url = await pickFirstOkUrl([
        "/ai/drive/connect",
        "/api/drive/connect"
      ]);

      if (!url) return;

      // 別タブでOAuth開始
      window.open(url, "_blank", "noopener,noreferrer");
    };

    kbBtns.forEach((b) => {
      b.addEventListener("click", async (e) => {
        e.preventDefault();
        const txt = (b.textContent || "").trim();

        if (txt.startsWith("クラウドストレージと接続する")) {
          await startGoogleDriveConnect();
          return;
        }

        if (txt.startsWith("ドキュメントを一時アップロード")) {
          const input = document.createElement("input");
          input.type = "file";
          input.multiple = true;
          input.accept = ".txt,.md,.pdf,.png,.jpg,.jpeg,.webp";
          input.style.display = "none";
          document.body.appendChild(input);
          input.addEventListener("change", () => document.body.removeChild(input));
          input.click();
        }
      });
    });

    /* ===== Account ===== */
    const dn = document.getElementById("displayName");

    let dnTimer = null;

    const saveUser = () => {
      save(state);
      syncAccountUi();
      syncSettingsUi();
    };

    if (dn) {
      dn.addEventListener("input", () => {
        const v = (dn.value || "").trim();
        state.user.displayName = v || "";
        if (dnTimer) clearTimeout(dnTimer);
        dnTimer = setTimeout(saveUser, 250);
      });
      dn.addEventListener("blur", saveUser);
    }

    const ensurePlanModal = () => {
      let wrap = document.getElementById("aureaPlanModal");
      if (wrap) return wrap;

      wrap = document.createElement("div");
      wrap.id = "aureaPlanModal";
      wrap.setAttribute("aria-hidden", "true");
      wrap.style.cssText = `
        position:fixed; inset:0; display:none; align-items:center; justify-content:center;
        background:rgba(0,0,0,.45); z-index:99999; padding:18px;
      `;

      const L_TITLE = tr("planListTitle");
      const L_NOTE = tr("planPaidNote");

      const PRICE = {
        Free: "¥0",
        Pro: "¥30,000",
      };

      const rt = encodeURIComponent(`${window.location.origin}/`);

      const goStripe = async (plan) => {
        const p = String(plan || "Free").trim() || "Free";

        // 多重クリック防止（checkout中の連打で挙動が壊れるのを防ぐ）
        try {
          if (window.__AUREA_PADDLE_CHECKOUT_LOCK__ === true) return;
          window.__AUREA_PADDLE_CHECKOUT_LOCK__ = true;
        } catch {}

        const unlock = () => {
          try { window.__AUREA_PADDLE_CHECKOUT_LOCK__ = false; } catch {}
        };

        try {
          // 同一プランを選択した場合は何もしない（不要な確認/遷移を防ぐ）
          if (String(state.plan || "Free").trim() === p) {
            unlock();
            return;
          }

          const st = (typeof getAuthState === "function") ? (getAuthState() || {}) : {};
          const uid = String(st.uid || "").trim();
          const email = String(st.email || "").trim();
          if (!uid || !email) {
            alert("checkout_failed: missing_uid_or_email");
            unlock();
            return;
          }

          // Free は（Webhook未使用の間）サーバ側の確定ができないため、ここでは何もしない
          if (p === "Free") {
            const msg = ((state.settings?.language || "ja") === "en")
              ? "Free downgrade will be available after billing is fully activated."
              : "Freeへのダウングレードは決済の本稼働後に有効化します。";
            alert(msg);
            unlock();
            return;
          }

          const successUrl = `${window.location.origin}/?billing=success`;
          const cancelUrl = `${window.location.origin}/?billing=cancel`;

          try {
            const r = await fetch("/api/billing/checkout", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ plan: p, uid, email, successUrl, cancelUrl })
            });

            const ct = String(r.headers.get("content-type") || "");
            const j = ct.includes("application/json") ? await r.json().catch(() => null) : null;

            if (!r.ok) {
              const reason = String(j?.reason || "").trim();
              const code = String(j?.code || "").trim();
              const msg = String(j?.msg || "").trim();
              const hint = [reason, code, msg].filter(Boolean).join(" / ");
              alert(`checkout_failed: http_${r.status}${hint ? ` (${hint})` : ""}`);
              unlock();
              return;
            }

            if (!j || !j.ok || !j.url) {
              alert("checkout_failed: bad_response");
              unlock();
              return;
            }

            // Paddle Hosted Checkout へ遷移（戻りは billing=success/cancel）
            window.location.href = j.url;
            return;

          } catch (e) {
            alert(`checkout_failed: ${String(e && e.message ? e.message : e)}`);
            unlock();
            return;
          }

        } finally {
          unlock();
        }
      };

      wrap.innerHTML = `
        <div style="
          width:min(520px, calc(100% - 24px));
          background:rgba(20,21,22,.96);
          border:1px solid rgba(255,255,255,.10);
          border-radius:18px;
          box-shadow:0 10px 30px rgba(0,0,0,.45);
          overflow:hidden;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          color:rgba(255,255,255,.92);
          font-family: -apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Hiragino Sans','Noto Sans JP',sans-serif;
        ">
          <div style="padding:16px 18px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
            <div style="min-width:0;">
              <div style="font-size:16px;font-weight:700;line-height:1.2;">${escHtml(L_TITLE)}</div>
              <div style="margin-top:8px;font-size:12px;line-height:1.6;color:rgba(255,255,255,.70);white-space:pre-line;">${escHtml(L_NOTE)}</div>
            </div>
            <button id="aureaPlanClose" type="button" style="
              width:32px;height:32px;border-radius:10px;border:1px solid rgba(255,255,255,.12);
              background:rgba(255,255,255,.06);color:rgba(255,255,255,.92);
              cursor:pointer;font-size:16px;line-height:30px;flex:0 0 auto;
            ">×</button>
          </div>

          <div style="padding:14px 16px 16px;display:flex;flex-direction:column;gap:10px;">
            <button type="button" class="aurea-plan-row" data-plan="Free" style="
              width:100%;text-align:left;border-radius:14px;border:1px solid rgba(255,255,255,.10);
              background:rgba(255,255,255,.03);color:rgba(255,255,255,.92);cursor:pointer;
              padding:12px 12px;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;
            ">
              <div style="min-width:0;">
                <div style="font-weight:700;font-size:14px;line-height:1.2;">Free</div>
                <div style="margin-top:6px;font-size:12px;line-height:1.5;color:rgba(255,255,255,.70);">${escHtml(tr("planFreeDesc"))}</div>
              </div>
              <div style="text-align:right;flex:0 0 auto;">
                <div style="font-weight:700;font-size:14px;">${escHtml(PRICE.Free)}</div>
                <div style="font-size:11px;color:rgba(255,255,255,.65);">${escHtml(tr("perMonth"))}</div>
              </div>
            </button>

            <button type="button" class="aurea-plan-row" data-plan="Pro" style="
              width:100%;text-align:left;border-radius:14px;border:1px solid rgba(255,255,255,.10);
              background:rgba(255,255,255,.03);color:rgba(255,255,255,.92);cursor:pointer;
              padding:12px 12px;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;
            ">
              <div style="min-width:0;">
                <div style="font-weight:700;font-size:14px;line-height:1.2;">Pro</div>
                <div style="margin-top:6px;font-size:12px;line-height:1.5;color:rgba(255,255,255,.70);">${escHtml(tr("planProDesc"))}</div>
              </div>
              <div style="text-align:right;flex:0 0 auto;">
                <div style="font-weight:700;font-size:14px;">${escHtml(PRICE.Pro)}</div>
                <div style="font-size:11px;color:rgba(255,255,255,.65);">${escHtml(tr("perMonth"))}</div>
              </div>
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(wrap);

      wrap.addEventListener("click", (e) => {
        if (e.target === wrap) document.getElementById("aureaPlanClose")?.click();
      });

      wrap.querySelector("#aureaPlanClose")?.addEventListener("click", () => {
        wrap.style.display = "none";
        wrap.setAttribute("aria-hidden", "true");
      });

      wrap.querySelectorAll("button.aurea-plan-row[data-plan]").forEach((b) => {
        b.addEventListener("click", () => {
          const plan = b.getAttribute("data-plan") || "Free";
          goStripe(plan);
        });
      });

      return wrap;
    };

    const btnBilling = document.getElementById("btnBilling");
    btnBilling?.addEventListener("click", (e) => {
      e.preventDefault();
      const m = ensurePlanModal();
      m.style.display = "flex";
      m.setAttribute("aria-hidden", "false");
    });

    // Legal modal (3 items) — login.html と同一仕様（固定文言 / 編集不可 / fetch無し）
    const legalOverlay = document.getElementById("legalOverlay");
    const btnCloseLegalModal = document.getElementById("btnCloseLegalModal");
    const legalModalTitle = document.getElementById("legalModalTitle");
    const legalModalBody = document.getElementById("legalModalBody");

    // 改行を潰さない（login.html と同じ読みやすさへ）
    try {
      if (legalModalBody) {
        legalModalBody.style.whiteSpace = "pre-wrap";
        legalModalBody.style.wordBreak = "break-word";
        legalModalBody.style.lineHeight = "1.75";
      }
    } catch {}

    // ===== JA (login.html と同じ「箇条書き + 空行」) =====
    const TOKUSHO_JA = [
      "■ 製品名：AUREA（オーリア）",
      "",
      "■ 事業代表者名：杉浦 広之",
      "",
      "■ 所在地：",
      "〒106-0044",
      "東京都港区東麻布3（※開示請求があった際は開示致します）",
      "",
      "■ お問い合わせ：",
      "・メールアドレス：contact@aurea-ai.app",
      "※お問い合わせは原則「メール」での対応になります",
      "",
      "■ 販売 URL：https://aurea-2026.web.app/",
      "",
      "■ 販売価格：",
      "・Proプラン：月額 30,000円（税込）",
      "",
      "■ 商品代金以外の必要料金：",
      "・インターネット接続にかかる通信料は利用者の負担となります",
      "",
      "■ 支払方法：",
      "・クレジットカード決済（Stripe）",
      "",
      "■ 支払時期：",
      "お申込み時に初回決済が行われます。",
      "但し、継続的な課金はサービス提供開始後に適用されます",
      "",
      "■ 提供時期：",
      "・決済完了後にサービスの受け渡し、提供されます",
      "",
      "■ 解約について：",
      "・本サービスは月額課金制のデジタルサービスです",
      "・ユーザーはいつでも解約することができます",
      "（プラン解約処理は解約設定時の月末になります）",
      "・解約後も、次回更新日まではサービスをご利用いただけます",
      "・日割りによる返金は行っておりません",
      "",
      "■ 返品・返金について：",
      "デジタルサービスの性質上、購入後の返品・返金には対応しておりません",
      "但し、法令に基づく場合はこの限りではありません"
    ].join("\n");

    const TERMS_JA = [
      "この利用規約（以下、「本規約」）は、AUREA（以下、「当サービス」）が提供するSaaS型サービスの利用条件を定めるものです。",
      "ユーザーは、本規約に同意した上で当サービスを利用するものとします。",
      "",
      "■ 第1条（適用）",
      "・本規約は、ユーザーと当サービスとの間の一切の関係に適用されます",
      "",
      "■ 第2条（利用登録）",
      "・ユーザーは正確な情報を登録するものとします",
      "・虚偽が判明した場合、当サービスは利用停止等の措置を取ることがあります",
      "",
      "■ 第3条（利用料金および支払方法）",
      "・当サービスは月額課金制です",
      "・決済は Stripe（Stripe, Inc.）を通じて行われます",
      "",
      "■ 第4条（解約）",
      "・ユーザーはいつでも解約することができます",
      "・解約後も次回更新日までは利用できます",
      "・日割りによる返金は行いません",
      "",
      "■ 第5条（禁止事項）",
      "・法令違反、不正アクセス、運営妨害、第三者の権利侵害、その他不適切な行為を禁止します",
      "",
      "■ 第6条（サービスの停止・変更）",
      "・必要に応じて、事前通知なく変更または停止することがあります",
      "",
      "■ 第7条（免責事項）",
      "・情報の正確性・完全性を保証せず、利用により生じた損害について責任を負いません",
      "",
      "■ 第8条（規約の変更）",
      "・変更後の規約は掲載時点で効力を生じます",
      "",
      "■ 第9条（準拠法・管轄）",
      "・日本法準拠、東京地方裁判所を専属的合意管轄裁判所とします",
      "",
      "■ 第10条（お問い合わせ先）",
      "・メールアドレス：contact@aurea-ai.app"
    ].join("\n");

    const PRIVACY_JA = [
      "AUREA（以下、「当サービス」）は、ユーザーの個人情報の保護を重要な責務と考え、以下のとおりプライバシーポリシーを定めます。",
      "",
      "■ 1. 取得する情報",
      "当サービスでは、以下の情報を取得する場合があります。",
      "・氏名、メールアドレスなどの登録情報",
      "・ログイン情報、利用履歴、操作ログ",
      "・決済に関連する情報（※クレジットカード情報は当サービスでは保持せず、Stripeが管理します）",
      "・お問い合わせ時に提供される情報",
      "",
      "■ 2. 利用目的",
      "取得した情報は、以下の目的で利用します。",
      "・サービスの提供・運営・改善のため",
      "・認証、セキュリティ確保のため",
      "・利用状況の分析および機能改善のため",
      "・お問い合わせへの対応のため",
      "・利用規約違反や不正行為への対応のため",
      "",
      "■ 3. 外部サービスの利用",
      "当サービスでは、決済処理のために Stripe（Stripe, Inc.）を利用しています。",
      "決済に関連する個人情報は、Stripeのプライバシーポリシーに基づき管理されます。",
      "",
      "■ 4. 個人情報の第三者提供",
      "法令に基づく場合を除き、本人の同意なく第三者に個人情報を提供することはありません。",
      "",
      "■ 5. 個人情報の管理",
      "当サービスは、個人情報の漏洩、滅失、改ざん等を防止するため、適切な安全管理措置を講じます。",
      "",
      "■ 6. 開示・訂正・削除",
      "ユーザーは、当サービスが保有する自己の個人情報について、開示、訂正、削除を求めることができます。",
      "ご希望の場合は、下記お問い合わせ先までご連絡ください。",
      "",
      "■ 7. プライバシーポリシーの変更",
      "本ポリシーの内容は、必要に応じて変更されることがあります。",
      "変更後の内容は、本ページにて公表します。",
      "",
      "■ 8. お問い合わせ先",
      "・メールアドレス：contact@aurea-ai.app"
    ].join("\n");

    // ===== EN =====
    const TOKUSHO_EN = [
      "■ Product: AUREA",
      "",
      "■ Business Operator: Hiroyuki Sugiura",
      "",
      "■ Address:",
      "Tokyo, Japan (disclosed upon legitimate request)",
      "",
      "■ Contact:",
      "Email: contact@aurea-ai.app",
      "",
      "■ Sales URL: https://aurea-2026.web.app/",
      "",
      "■ Pricing:",
      "• Pro: JPY 30,000 / month (tax incl.)",
      "",
      "■ Additional fees:",
      "Internet connection fees are borne by the user.",
      "",
      "■ Payment method:",
      "Credit card (Stripe)",
      "",
      "■ Payment timing:",
      "The first payment is processed at the time of purchase.",
      "Recurring charges will apply after service availability begins.",
      "",
      "■ Delivery:",
      "Service is provided after payment is completed.",
      "",
      "■ Cancellation:",
      "You may cancel at any time (effective at the end of the billing period).",
      "No prorated refunds.",
      "",
      "■ Refund policy:",
      "No refunds after purchase due to the nature of digital services, except as required by law."
    ].join("\n");

    const TERMS_EN = [
      "These Terms of Service (\"Terms\") govern your use of AUREA (the \"Service\").",
      "By using the Service, you agree to these Terms.",
      "",
      "■ 1. Applicability",
      "These Terms apply to all relationships between you and the Service.",
      "",
      "■ 2. Registration",
      "You must provide accurate information. We may suspend access if false information is found.",
      "",
      "■ 3. Fees & Payment",
      "The Service is subscription-based. Payments are processed via Stripe (Stripe, Inc.).",
      "",
      "■ 4. Cancellation",
      "You may cancel at any time. Access remains available until the next renewal date. No prorated refunds.",
      "",
      "■ 5. Prohibited conduct",
      "Illegal acts, unauthorized access, interference, infringement of third-party rights, and other improper acts are prohibited.",
      "",
      "■ 6. Changes / Suspension",
      "We may change or suspend features without prior notice when necessary.",
      "",
      "■ 7. Disclaimer",
      "We do not guarantee accuracy or completeness and are not liable for damages arising from use.",
      "",
      "■ 8. Changes to Terms",
      "Updated Terms become effective when posted.",
      "",
      "■ 9. Governing law / jurisdiction",
      "Governed by Japanese law. Exclusive jurisdiction: Tokyo District Court.",
      "",
      "■ 10. Contact",
      "Email: contact@aurea-ai.app"
    ].join("\n");

    const PRIVACY_EN = [
      "AUREA (the \"Service\") values the protection of personal information and sets this Privacy Policy.",
      "",
      "■ 1. Information we collect",
      "We may collect: registration details (e.g., name, email), login data, usage history, operation logs, payment-related info (card data is not stored by us and is handled by Stripe), and inquiry contents.",
      "",
      "■ 2. Purposes",
      "Service operation/improvement, authentication, security, analytics, customer support, and prevention of fraud/violations.",
      "",
      "■ 3. Third-party services",
      "We use Stripe for payment processing. Payment-related personal data is handled under Stripe’s policies.",
      "",
      "■ 4. Sharing",
      "We do not share personal information with third parties without consent except where required by law.",
      "",
      "■ 5. Security",
      "We take reasonable measures to prevent leakage, loss, or alteration.",
      "",
      "■ 6. Requests",
      "You may request disclosure, correction, or deletion. Contact us if needed.",
      "",
      "■ 7. Updates",
      "This policy may be updated as necessary and will be published on this page.",
      "",
      "■ 8. Contact",
      "Email: contact@aurea-ai.app"
    ].join("\n");

    // ===== Regulations open handler (data-legal) =====
    const openLegal = (kind) => {
      const k = String(kind || "").trim();
      if (!legalOverlay || !legalModalTitle || !legalModalBody) return;

      const isEn = String(state.settings?.language || "ja").toLowerCase().startsWith("en");

      let title = "";
      let body = "";

      if (k === "tokusho") {
        title = isEn ? "Legal Notice" : "特定商取引法に基づく表記";
        body  = isEn ? TOKUSHO_EN : TOKUSHO_JA;
      } else if (k === "terms") {
        title = isEn ? "Terms of Service" : "利用規約";
        body  = isEn ? TERMS_EN : TERMS_JA;
      } else if (k === "privacy") {
        title = isEn ? "Privacy Policy" : "プライバシーポリシー";
        body  = isEn ? PRIVACY_EN : PRIVACY_JA;
      } else {
        return;
      }

      // 改行崩れ防止（毎回保険）
      try {
        legalModalBody.style.whiteSpace = "pre-wrap";
        legalModalBody.style.wordBreak = "break-word";
        legalModalBody.style.lineHeight = "1.75";
      } catch {}

      legalModalTitle.textContent = title;
      legalModalBody.textContent = body;

      legalOverlay.style.display = "flex";
      legalOverlay.classList.add("is-open");
      legalOverlay.setAttribute("aria-hidden", "false");
    };

    // Settings 内の data-legal ボタンで開く（capture）
    document.addEventListener("click", (e) => {
      const t = e.target;
      const btn = (t instanceof Element) ? t.closest(".settings-modal [data-legal]") : null;
      if (!btn) return;

      e.preventDefault();
      e.stopPropagation();

      const kind = String(btn.getAttribute("data-legal") || "").trim();
      openLegal(kind);
    }, true);

    btnCloseLegalModal?.addEventListener("click", (e) => {
      e.preventDefault();
      if (!legalOverlay) return;
      legalOverlay.style.display = "none";
      legalOverlay.classList.remove("is-open");
      legalOverlay.setAttribute("aria-hidden", "true");
    }, true);
  };

  ensureActiveThread();

  // render
  renderSidebar();
  renderView();

  // sidebar search（render 後に必ず mount）
  mountSidebarSearch();

  // scroll state init
  syncScrollState();

  /* ================= OAuth return (v1) ================= */
  (() => {
    const params = new URLSearchParams(window.location.search);
    const connect = params.get("connect");
    const stateParam = params.get("state"); // e.g. "svc=google"

    const persistEverywhere = () => {
      try {
        // save() は選択中の保存先に書く
        save(state);

        // 念のため両方へも書く（cloud/localズレ対策）
        localStorage.setItem("aurea_main_v1_cloud", JSON.stringify(state));
        localStorage.setItem("aurea_main_v1_local", JSON.stringify(state));
      } catch {}
    };

    if (connect === "ok" && stateParam) {
      let svc = null;
      try {
        const parts = stateParam.split("|").map(s => s.trim()).filter(Boolean);
        for (const p of parts) {
          if (p.startsWith("svc=")) svc = p.slice(4);
        }
      } catch {
        svc = null;
      }

      if (svc === "google") state.apps.Google = true;
      if (svc === "gmail") state.apps.Gmail = true;
      if (svc === "drive") state.apps["Google Drive"] = true;

      // apply pending "cloud" switch after successful Google connect
      try {
        const pending = localStorage.getItem(PENDING_STORAGE_MODE_KEY);
        if (pending === "cloud" && state.apps?.Google) {
          localStorage.removeItem(PENDING_STORAGE_MODE_KEY);
          localStorage.setItem(STORAGE_PREF_KEY, "cloud");
          state.settings.dataStorage = "cloud";
        }
      } catch {}

      persistEverywhere();

      // UI反映（apps-grid が空の場合があるので先に生成）
      try { ensureAppsGrid(); } catch {}
      syncSettingsUi();

      // クエリを消す（履歴汚染防止）
      history.replaceState({}, document.title, "/");

      setTimeout(() => {
        alert(tr("googleConnectedAlert"));
      }, 0);

      return;
    }

    if (connect === "error") {
      const err = params.get("error") || "unknown";
      history.replaceState({}, document.title, "/");
      setTimeout(() => {
        alert(tr("googleConnectFailedAlert").replace("{err}", String(err || "unknown")));
      }, 0);
    }
  })();

  const persistEverywhereMain = () => {
    try {
      // save() は選択中の保存先に書く
      save(state);

      // 念のため両方へも書く（cloud/localズレ対策）
      localStorage.setItem("aurea_main_v1_cloud", JSON.stringify(state));
      localStorage.setItem("aurea_main_v1_local", JSON.stringify(state));
    } catch {}
  };

  const refreshPlanFromServer = async () => {
    try {
      // auth 未読込ページ（billing=success 等）は何もしない
      if (typeof getAuthState !== "function") return;

      const st = getAuthState() || {};
      const uid = String(st.uid || "").trim();
      if (!st.loggedIn || !uid) return;

      const r = await fetch(`/api/user/plan?uid=${encodeURIComponent(uid)}`, { method: "GET" });
      const j = await r.json().catch(() => null);
      if (j && j.ok && j.plan) {
        state.plan = String(j.plan || "Free").trim() || "Free";
        persistEverywhereMain();
        try { syncAccountUi(); } catch {}
        try { syncSettingsUi(); } catch {}
      }
    } catch {}
  };

  // Profile は未実装でも壊さない（404/非OKは無視）
  const refreshProfileFromServer = async () => {
    try {
      if (typeof getAuthState !== "function") return;

      const st = getAuthState() || {};
      const uid = String(st.uid || "").trim();
      if (!st.loggedIn || !uid) return;

      const r = await fetch(`/api/user/profile?uid=${encodeURIComponent(uid)}`, { method: "GET" });
      if (!r || !r.ok) return;

      const j = await r.json().catch(() => null);
      if (!j || !j.ok) return;

      // 想定: { ok:true, profile:{ displayName,userName,email } }
      const p = (j.profile && typeof j.profile === "object") ? j.profile : j;

      const dn = String(p.displayName || "").trim();
      const em = String(p.email || "").trim();

      if (!state.user || typeof state.user !== "object") state.user = {};

      if (em) state.user.email = em;
      if (dn) state.user.displayName = dn;

      persistEverywhereMain();
      try { syncAccountUi(); } catch {}
      try { syncSettingsUi(); } catch {}
    } catch {}
  };

  // reflect immediately
  syncAccountUi();
  applyI18n();
  syncSettingsUi();
  bindSettings();

    // ===== i18n late-load guard =====
  // i18n.js がネットワーク/順序で遅れてロードされた場合でも、表示を即座に翻訳へ同期する
  (() => {
    let tries = 0;
    const tick = () => {
      tries += 1;

      const ready =
        !!(window.AUREA_I18N && typeof window.AUREA_I18N.tr === "function");

      if (ready) {
        try { applyI18n(); } catch {}
        try { syncSettingsUi(); } catch {}
        try { renderSidebar(); } catch {}
        try { renderView(); } catch {}
        return;
      }

      if (tries >= 80) return; // 約 8秒で打ち切り（無限ループ防止）
      setTimeout(tick, 100);
    };

    setTimeout(tick, 0);
  })();

  // Firestore(users/{uid}.plan) 追従（auth確定前に1回で終わるのを防ぐ）
  (async () => {
    try {
      for (let i = 0; i < 20; i++) {
        const st = (typeof getAuthState === "function") ? (getAuthState() || {}) : {};
        const uid = String(st.uid || "").trim();
        if (st.loggedIn && uid) break;
        await new Promise((r) => setTimeout(r, 250));
      }

      // 初回ロード
      await refreshPlanFromServer();
      await refreshProfileFromServer();

      // billing=success の直後は webhook 反映に遅延があるため追加で再取得
      try {
        const qs = new URLSearchParams(window.location.search);
        if (qs.get("billing") === "success") {
          for (let i = 0; i < 12; i++) {
            await new Promise((r) => setTimeout(r, 500));
            await refreshPlanFromServer();
            await refreshProfileFromServer();
            if (String(state.plan || "") === "Pro") break;
          }
        }
      } catch {}

      try {
        persistEverywhereMain();
      } catch {}

      syncAccountUi();
      syncSettingsUi();
    } catch {}
  })();

  // centered ask (no thread selected / no messages)
  setHasChat(false);

  // ask init（DOM確定後）
  if (askInput) {
    autosizeTextarea();
    updateSendButtonVisibility();
  }

  // APIルーティング判定（/api or /ai）
  (async () => {
    try { await detectApiPrefix(); } catch {}
  })();

})();

// ===== AUREA: hide askbar pending indicator while streaming =====
(() => {
  const style = document.createElement("style");
  style.textContent = `
    /* 解析中は Askバー周辺の疑似要素（赤丸）を完全に無効化 */
    body.aurea-streaming .ask::before,
    body.aurea-streaming .ask::after,
    body.aurea-streaming .ask-wrap::before,
    body.aurea-streaming .ask-wrap::after{
      display: none !important;
      content: none !important;
      opacity: 0 !important;
    }
  `;
  document.head.appendChild(style);
})();
