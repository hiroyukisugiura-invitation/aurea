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
  const root = ensureAiActivityRoot();

  const pill = document.createElement("div");
  pill.className = "ai-pill";
  pill.textContent = name;

  root.appendChild(pill);

  // fade in
  requestAnimationFrame(() => pill.classList.add("show"));

  // fade out
  setTimeout(() => {
    pill.classList.remove("show");
    setTimeout(() => {
      try { root.removeChild(pill); } catch {}
    }, 260);
  }, 1200);
};

  /* ================= storage ================= */
  const STORAGE_KEY_LOCAL = "aurea_main_v1_local";
  const STORAGE_KEY_CLOUD = "aurea_main_v1_cloud";
  const STORAGE_PREF_KEY = "aurea_data_storage"; // "cloud" | "local"

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
      const raw = localStorage.getItem(getStorageKey());
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  };

  const save = (s) => {
    try { localStorage.setItem(getStorageKey(), JSON.stringify(s)); } catch {}
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
      theme: "dark",        // "system" | "light" | "dark"
      sendMode: "cmdEnter", // "cmdEnter" | "enter"
      dataStorage: "cloud", // "cloud" | "local"
      language: "ja"        // i18nは次工程で使用
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
      displayName: "User name",
      userName: "@Username",
      email: "user@dmain.com",
      trustedDevice: "MacBook Pro ・ Japan ・ Chrome",
      deviceTrusted: true
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
      selLang.value = (state.settings?.language || "ja");
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

    const ensureStorageSelect = () => {
      let sel = document.getElementById("dataStorageSelect");
      if (sel) return sel;

      const panel = document.querySelector(".settings-modal .panel-data");
      if (!panel) return null;

      // 「クラウド」「端末内」ボタンの親に差し込む（IDが無くても動く）
      const btns = Array.from(panel.querySelectorAll("button"));
      const cloudBtn = btns.find(b => (b.textContent || "").trim() === "クラウド") || null;
      const localBtn = btns.find(b => (b.textContent || "").trim() === "端末内") || null;

      const host = cloudBtn?.parentElement || localBtn?.parentElement;
      if (!host) return null;

      sel = document.createElement("select");
      sel.id = "dataStorageSelect";
      sel.className = "select";
      sel.setAttribute("aria-label", "データの保存先");
      sel.innerHTML = `
        <option value="cloud">クラウド</option>
        <option value="local">端末内</option>
      `;

      // 既存の2ボタンは非表示（レイアウトは保持）
      if (cloudBtn) cloudBtn.style.display = "none";
      if (localBtn) localBtn.style.display = "none";

      host.appendChild(sel);
      return sel;
    };

    const storageSelect = ensureStorageSelect();
    if (storageSelect) {
      storageSelect.value = onLocal ? "local" : "cloud";
      autoSizeSelect(storageSelect);
    }

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

    // sidebar user card
    const sbName = document.querySelector(".user-card .user-meta .name");
    const sbPlan = document.querySelector(".user-card .user-meta .plan");
    if (sbName && u.displayName) sbName.textContent = u.displayName;
    if (sbPlan && state.plan) sbPlan.textContent = state.plan;

    // user pop head
    const popName = document.querySelector(".user-pop .uhead .n");
    const popMail = document.querySelector(".user-pop .uhead .m");
    if (popName && u.displayName) popName.textContent = u.displayName;
    if (popMail && u.email) popMail.textContent = u.email;

    // settings account inputs / fields
    const dn = document.getElementById("displayName");
    const un = document.getElementById("userName");
    if (dn && u.displayName != null) dn.value = u.displayName;
    if (un && u.userName != null) un.value = u.userName;

    const planV = document.querySelector(".panel-account .section[aria-label='プラン'] .row .l .v");
    if (planV && state.plan) planV.textContent = state.plan;

    const emailV = document.querySelector(".panel-account .section[aria-label='サインイン'] .row .l .v");
    if (emailV && u.email) emailV.textContent = u.email;

    const devV = document.querySelector(".panel-account .section[aria-label='信頼できるデバイス'] .row .l .v");
    if (devV) devV.textContent = u.deviceTrusted ? (u.trustedDevice || "") : "なし";

    const devBtn = document.getElementById("btnRevokeDevice");
    if (devBtn) {
      devBtn.disabled = !u.deviceTrusted;
      devBtn.style.opacity = u.deviceTrusted ? "" : ".45";
      devBtn.style.cursor = u.deviceTrusted ? "" : "not-allowed";
    }
  };

  const applyI18n = () => {
    const lang = state.settings?.language || "ja";

    // html lang も同期
    try { document.documentElement.lang = (lang === "en") ? "en" : "ja"; } catch {}

    const setText = (sel, text) => {
      const el = document.querySelector(sel);
      if (el && text != null) el.textContent = text;
    };

    // ===== Sidebar =====
    setText(".sb-item[data-nav='newChat'] .label", tr("newChat"));
    setText(".sb-item[data-nav='images'] .label", tr("library"));

    // Group headers（中身は data-i18n で反映）

    // Sidebar search (icon button)
    const sbSearchBtn = document.getElementById("aureaSearchBtn");
    if (sbSearchBtn) {
      sbSearchBtn.setAttribute("aria-label", tr("search"));
    }

    // ===== Settings modal (embedded) =====
    setText(".settings-modal .nav-title", tr("settings"));

    setText(".settings-modal label[for='tab-general'] .nav-txt", tr("general"));
    setText(".settings-modal label[for='tab-apps'] .nav-txt", tr("apps"));
    setText(".settings-modal label[for='tab-data'] .nav-txt", tr("data"));
    setText(".settings-modal label[for='tab-trainer'] .nav-txt", tr("trainer"));
    setText(".settings-modal label[for='tab-account'] .nav-txt", tr("accountSecurity"));

    setText(".settings-modal .panel-general .content-title", tr("general"));
    setText(".settings-modal .panel-apps .content-title", tr("apps"));
    setText(".settings-modal .panel-data .content-title", tr("data"));
    setText(".settings-modal .panel-account .content-title", tr("accountSecurity"));

    // Apps: "SaaS 追加" button label
    const addBtn = document.querySelector(".settings-modal .panel-apps .apps-header .btn");
    if (addBtn) {
      addBtn.innerHTML = `<i class="fa-solid fa-plus"></i> ${tr("addSaas")}`;
    }

    // Settings: language select placeholder-like consistency (表示のみ)
    const selLang = document.querySelector(".settings-modal #settingsLang");
    if (selLang) {
      selLang.setAttribute("aria-label", tr("language"));
    }

    // ===== Settings selects: option text normalize (ja/en) =====
    const isEn = (lang === "en");

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
        if (v === "en") o.text = isEn ? "English" : "英語";
      });
    }

    // Send mode select options
    const sendSel = document.querySelector(".settings-modal #settingsSendMode");
    if (sendSel) {
      Array.from(sendSel.options || []).forEach((o) => {
        const v = String(o.value || "").trim();
        if (v === "cmdEnter") o.text = isEn ? "⌘ + Enter to send (Enter for newline)" : "⌘ + Enterで送信（Enterは改行）";
        if (v === "enter")    o.text = isEn ? "Enter to send (Shift + Enter for newline)" : "Enterで送信（Shift + Enterで改行）";
      });
    }

    // Data storage dropdown options (cloud/local)
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

    // ===== Trainer (AET) : static texts (no data-i18n) =====
    const btnTrainer = document.getElementById("btnAddTrainerCase");
    if (btnTrainer) btnTrainer.textContent = isEn ? "+ Manage cases" : "ケースを管理";

    const trainerPanel = document.querySelector(".settings-modal .panel-trainer");
    if (trainerPanel) {
      const swapLeafText = (from, to) => {
        trainerPanel.querySelectorAll("*").forEach((el) => {
          if (!(el instanceof HTMLElement)) return;
          if (el.children && el.children.length) return;
          const t = (el.textContent || "").trim();
          if (t === from) el.textContent = to;
        });
      };

      swapLeafText("最適回答を登録", isEn ? "Register best answers" : "最適回答を登録");
      swapLeafText("\"質問\" → \"最適回答\"を登録", isEn ? 'Register "Question" → "Best answer"' : "\"質問\" → \"最適回答\"を登録");

      swapLeafText("質問", isEn ? "Question" : "質問");
      swapLeafText("最適回答", isEn ? "Best answer" : "最適回答");
    }

        // ===== Search modal (popup) i18n =====
    const smInput = document.getElementById("aureaSearchModalInput");
    if (smInput) {
      smInput.placeholder = tr("search");
      smInput.setAttribute("aria-label", tr("search"));
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

  syncAccountUi();
  syncSettingsUi();
  applyI18n();
};

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
    e.preventDefault();
    openAiStackPopup();
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

    // 2) PJトップ（#aureaProjectHomeAsk のある .pj-home-askbar）
    const pjAskInput = document.getElementById("aureaProjectHomeAsk");
    const pjBar = pjAskInput ? pjAskInput.closest(".pj-home-askbar") : null;

    // 優先：PJトップが存在するならPJトップ、無ければ通常チャット
    const anchor = pjBar || ask;
    if (!anchor) return null;

    const host = anchor.parentElement || null;

    // 既存トレイがあれば「今の画面のアンカー位置へ移動」する
    if (attachTrayEl) {
      try {
        if (host && attachTrayEl.parentElement !== host) {
          host.insertBefore(attachTrayEl, anchor);
        } else if (host && attachTrayEl.nextSibling !== anchor) {
          host.insertBefore(attachTrayEl, anchor);
        }
      } catch {}
      return attachTrayEl;
    }

    const tray = document.createElement("div");
    tray.id = "aureaAttachTray";
    tray.style.cssText = `
      width:100%;
      max-width:760px;
      margin:0 auto;
      padding:0 10px 10px;
      box-sizing:border-box;

      display:none;
      flex-wrap:wrap;
      gap:10px;
      justify-content:flex-start;
      align-items:center;

      pointer-events:auto;
    `;

    if (host) host.insertBefore(tray, anchor);
    else document.body.appendChild(tray);

    attachTrayEl = tray;
    return tray;
  };

  const renderAttachTray = () => {
    const tray = ensureAttachTray();
    if (!tray) return;

    tray.innerHTML = "";

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

      chip.style.cssText = `
        max-width:360px;
        border-radius:999px;
        border:1px solid rgba(255,255,255,.12);
        background:rgba(255,255,255,.06);
        color:rgba(255,255,255,.92);
        cursor:pointer;
        padding:7px 10px;
        display:flex;
        align-items:center;
        gap:10px;
        font-size:12px;
        line-height:1;
        font-family:var(--font);
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

      const thumb = (isImg && a.dataUrl)
        ? `<img src="${escHtml(a.dataUrl)}" alt="" style="width:22px;height:22px;border-radius:6px;object-fit:cover;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);" />`
        : isPdf
          ? `<span aria-hidden="true" style="width:30px;height:22px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.12);background:rgba(255,60,60,.16);color:rgba(255,255,255,.92);font-size:10px;font-weight:700;letter-spacing:.04em;">PDF</span>`
          : `<span aria-hidden="true" style="width:22px;height:22px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);opacity:.85;">📄</span>`;

      chip.innerHTML = `
        ${thumb}
        <span style="opacity:.92;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(name)}</span>
        <span style="opacity:.62;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(meta)}</span>
        <span data-action="remove" aria-label="remove" style="opacity:.72;margin-left:auto;display:inline-flex;width:22px;height:22px;align-items:center;justify-content:center;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);">×</span>
      `;

      // ✅ 削除（×）はここで直バインド（確実）
      const rm = chip.querySelector("[data-action='remove']");
      if (rm) {
        rm.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          removeAttachmentById(a.id);
        });
      }

      // ✅ チップクリックはプレビュー（確実）
      chip.addEventListener("click", (e) => {
        // × のクリックは上で stopPropagation 済み
        e.preventDefault();
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
        font-family: -apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Hiragino Sans','Noto Sans JP',sans-serif;
        display:flex;
        flex-direction:column;
        min-width:0;
      ">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08);">
          <div id="aureaAttachModalTitle" style="font-size:14px;font-weight:600;">Attachment</div>
          <button type="button" data-action="close" style="
            width:36px;height:36px;border-radius:12px;border:1px solid rgba(255,255,255,.12);
            background:rgba(255,255,255,.06);color:rgba(255,255,255,.92);
            cursor:pointer;font-size:18px;line-height:34px;
          ">×</button>
        </div>

        <div id="aureaAttachModalBody" style="padding:14px 16px;overflow:auto;min-height:0;flex:1 1 auto;"></div>

        <div style="padding:14px 16px;border-top:1px solid rgba(255,255,255,.08);display:flex;justify-content:flex-end;gap:10px;">
          <button type="button" data-action="remove" style="
            height:36px;padding:0 12px;border-radius:12px;border:1px solid rgba(255,255,255,.12);
            background:transparent;color:rgba(255,255,255,.86);cursor:pointer;font-size:13px;
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

        if (t.closest("[data-action='close']")) {
          e.preventDefault();
          closeAttachModal();
          return;
        }

        if (t.closest("[data-action='remove']")) {
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
        ? `<img src="${escHtml(att.dataUrl)}" alt="image" style="max-width:100%;border-radius:14px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);" />`
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
  };

  const sniffKind = (mime, name) => {
    const m = String(mime || "").toLowerCase();
    if (m.startsWith("image/")) return "image";
    const n = String(name || "").toLowerCase();
    if (/\.(png|jpg|jpeg|webp|gif|bmp|svg)$/.test(n)) return "image";
    return "file";
  };

  const fileToDataUrl = (file) => new Promise((resolve) => {
    try {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ""));
      fr.onerror = () => resolve("");
      fr.readAsDataURL(file);
    } catch {
      resolve("");
    }
  });

  const addFilesAsAttachments = async (files) => {
    const list = Array.from(files || []).filter(f => f && typeof f.size === "number");
    if (!list.length) return;

    for (const f of list) {
      const mime = String(f.type || "").trim();
      const name = String(f.name || "file").trim();
      const kind = sniffKind(mime, name);

      // v1: image + small text files (txt/md/csv) keep dataUrl for payload/preview
      let dataUrl = "";

      const lower = name.toLowerCase();
      const isTextLike =
        mime.startsWith("text/") ||
        mime === "text/csv" ||
        lower.endsWith(".txt") ||
        lower.endsWith(".md") ||
        lower.endsWith(".csv");

      if (kind === "image") {
        // 8MB上限（UI負荷対策）
        if ((f.size || 0) <= (8 * 1024 * 1024)) {
          dataUrl = await fileToDataUrl(f);
        }
      } else if (isTextLike) {
        // 512KB上限（即解析用）
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

  const takePendingAttachments = () => {
    const out = pendingAttachments.slice();
    pendingAttachments = [];
    renderAttachTray();
    return out;
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
      const name = String(a?.name || "file");
      const mime = String(a?.mime || "");
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
        // v1: image -> base64 (already prepared as dataUrl)
        if (route === "image" && a?.dataUrl && String(a.dataUrl).startsWith("data:")) {
          const s = String(a.dataUrl);
          const idx = s.indexOf("base64,");
          if (idx >= 0) data = s.slice(idx + 7);
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

      out.push({
        type: (route === "image") ? "image" : "file",
        route,
        mime,
        name,
        size,
        data,
        fallback
      });
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
        <div style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08);font-size:14px;font-weight:600;">${L_CONFIRM}</div>
        <div id="aureaConfirmText" style="padding:14px 16px;font-size:13px;line-height:1.6;color:rgba(255,255,255,.82);"></div>
        <div style="padding:14px 16px;border-top:1px solid rgba(255,255,255,.08);display:flex;justify-content:flex-end;gap:10px;">
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
    clearPendingAttachments();
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
    clearPendingAttachments();
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

      const renderReportsAsDetails = (raw) => {
        if (!raw.includes("\nReports:\n")) {
          return escHtml(raw).replace(/\n/g, "<br>");
        }

        const parts = raw.split("\nReports:\n");
        const head = parts[0] || "";
        const tail = parts.slice(1).join("\nReports:\n");

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

        const headHtml = escHtml(head).replace(/\n/g, "<br>");

        const detailsHtml = blocks.map((b) => {
          const nm = String(b.name || "").trim();
          const body = String(b.body || "").trim();
          const isClaude = (nm === "Claude");
          return `
              <details class="ai-report"${isClaude ? " open" : ""}>
                <summary class="ai-report__sum">${escHtml(nm)}</summary>
                <div class="ai-report__body">${escHtml(body).replace(/\n/g, "<br>")}</div>
              </details>
            `.trim();
        }).join("");

        return `${headHtml}<br><br>${detailsHtml}`;
      };

      const renderMessageHtml = (msg) => {
        const raw0 = String(msg?.content || "");

        // Assistant only: Sora image message
        // Format:
        // AUREA_IMAGE
        // <url>
        // <prompt>
        if (msg?.role === "assistant" && raw0.startsWith("AUREA_IMAGE\n")) {
          const lines = raw0.split("\n");
          const url = String(lines[1] || "").trim();
          const prompt = String(lines.slice(2).join("\n") || "").trim();

          if (url) {
            return `
              <div class="ai-image-card">
                <img src="${escHtml(url)}" alt="generated image" />
                ${prompt ? `<div class="ai-image-caption">${escHtml(prompt).replace(/\n/g, "<br>")}</div>` : ""}
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

      bubble.innerHTML = renderMessageHtml(m);

      wrap.appendChild(bubble);

      if (m.role === "assistant") {
        const actions = document.createElement("div");
        actions.className = "actions";

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
        wrap.appendChild(actions);
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
      let text = (input?.value || "").trim();

      // GPT準拠：テキストなし＋添付あり → 自動分析プロンプト補完
      if (!text && hasAttachments) {
        text = (state.settings?.language === "en")
          ? "Please analyze the attached file."
          : "このファイルを分析してください";
      }

      if (!text && !hasAttachments) return;

      // PJ内で新規トーク作成 → そのトークに送信（GPT同等）
      createProjectThread(pid);

      appendMessage("user", text);

      if (input) input.value = "";

      // 添付を確定して multiAiReply へ（解析・打ち返し）
      const rawAttachments = takePendingAttachments();
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

  const shouldUseSora = (userText) => {
    const s = String(userText || "");
    return /\b(image|render|illustration|photo|png|jpg|webp)\b/i.test(s) || /画像|イラスト|写真|生成|レンダ/.test(s);
  };

    const isImageGenerationRequest = (text) => {
    const s = String(text || "");
    return (
      /\b(generate|create|make|render|draw|illustrate)\b/i.test(s) ||
      /画像|イラスト|生成|描いて|作って/.test(s)
    );
  };

  const setStreaming = (on) => {
    if (stopBtn) stopBtn.style.display = on ? "" : "none";

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
  };

  const stopStreaming = () => {
    streamAbort = true;
    multiAiAbort = true;
    if (streamTimer) { clearInterval(streamTimer); streamTimer = null; }
    setStreaming(false);
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
    const lines = [];
    lines.push(`${tr("aureaPrefix")}`);
    lines.push("");
    lines.push(userText);
    lines.push("");
    lines.push(tr("replyPlaceholder"));

    // Attach full reports (UI will render as expandable details)
    const names = Object.keys(reports || {});
    if (names.length) {
      lines.push("");
      lines.push("Reports:");
      for (const n of names) {
        lines.push(`--- ${n} ---`);
        lines.push(String(reports[n] || "").trim());
      }
    }

    if (usedSora) {
      lines.push("");
      lines.push("Sora: active (image)");
    }

    return lines.join("\n");
  };

  const multiAiReply = async (userText, rawAttachments = []) => {
    const m = appendMessage("assistant", "");
    if (!m) return;

    streamAbort = false;
    multiAiAbort = false;
    setStreaming(true);
        // ===== Sora image generation (front complete) =====
    if (isImageGenerationRequest(userText)) {
      try { showAiActivity("Sora"); } catch {}

      try {
        const payload = {
          prompt: userText,
          attachments: await buildAttachmentsPayload(rawAttachments),
          context: {
            view: state.view,
            scope: state.context,
            projectId: state.context?.type === "project" ? state.context.projectId : null,
            threadId: getActiveThreadId(),
            language: state.settings?.language || "ja"
          }
        };

        const r = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

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

          // render image message
          const imgMsg = `AUREA_IMAGE\n${url}\n${p}`;
          updateMessage(m.id, imgMsg);
          renderChat();

          setStreaming(false);
          renderSidebar();
          return;
        }

      } catch {}

      // fail-safe
      updateMessage(m.id, "Image generation failed.");
      renderChat();
      setStreaming(false);
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
      const header = buildMultiAiHeader(statuses);
      const content = finalText ? `${header}\n\n${finalText}` : `${header}\n\n`;
      updateMessage(m.id, content);
      renderChat();
    };

    renderProgress("");

    const targets = MULTI_AI.filter((a) => a.name !== "GPT" && (a.name !== "Sora" || usedSora));

    // ===== /api/chat (Unified Request Schema v1) =====
    let apiMap = null;
    try {
      const payload = {
        prompt: userText,
        attachments: await buildAttachmentsPayload(rawAttachments),
        context: {
          view: state.view,
          scope: state.context,
          projectId: state.context?.type === "project" ? state.context.projectId : null,
          threadId: getActiveThreadId(),
          language: state.settings?.language || "ja"
        }
      };

      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const j = await r.json().catch(() => null);

      // ===== Sora image response (v1) =====
      if (r.ok && j && j.ok && j.image && j.image.url) {
        const url = String(j.image.url || "").trim();
        const p = String(j.image.prompt || userText || "").trim();

        // show activity
        try { showAiActivity("Sora"); } catch {}

        // save to images library (real image)
        try {
          addImageToLibrary({
            prompt: p,
            src: url,
            from: {
              threadId: getActiveThreadId(),
              context: state.context
            }
          });
        } catch {}

        // render as special image message
        const imgMsg = `AUREA_IMAGE\n${url}\n${p}`;
        updateMessage(m.id, imgMsg);
        renderChat();

        setStreaming(false);
        renderSidebar();
        return;
      }

      if (r.ok && j && j.ok && j.result && typeof j.result === "object") {
        apiMap = j.result;
      }
    } catch {
      apiMap = null;
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
        renderSidebar();
      }
    }, 18);
  };

  const send = async () => {
    if (!askInput) return;

    const hasAttachments = pendingAttachments.length > 0;
    let text = askInput.value.trim();

    // GPT準拠：テキストなし＋添付あり → 自動分析プロンプト補完
    if (!text && hasAttachments) {
      text = (state.settings?.language === "en")
        ? "Please analyze the attached file."
        : "このファイルを分析してください";
    }

    if (!text && !hasAttachments) return;

    // PJトップからの送信は、PJ内の新規トークを作ってから送る（GPT仕様）
    if (state.view === "project" && state.activeProjectId) {
      createProjectThread(state.activeProjectId);
    }

    state.view = "chat";
    save(state);

    appendMessage("user", text);
    askInput.value = "";
    autosizeTextarea();
    updateSendButtonVisibility();

    const rawAttachments = takePendingAttachments();
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
      if (dt.files && dt.files.length) return true;
      if (dt.items && dt.items.length) return Array.from(dt.items).some(it => it && it.kind === "file");
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

    const files = (dt && dt.files && dt.files.length) ? dt.files : null;
    if (files) {
      await addFilesAsAttachments(files);
      try { renderAttachTray(); } catch {}
    }
  }, true);

    /* ================= drag & drop (Ask bar attach) ================= */
  const hasFileItems = (dt) => {
    try {
      if (!dt) return false;
      if (dt.files && dt.files.length) return true;
      if (dt.items && dt.items.length) {
        return Array.from(dt.items).some(it => it && it.kind === "file");
      }
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

    const files = (dt && dt.files && dt.files.length) ? dt.files : null;
    if (files) {
      await addFilesAsAttachments(files);
      try { renderAttachTray(); } catch {}
    }
  }, true);

  // (removed) legacy sidebar search handler
  // 検索は mountSidebarSearch() で生成される input (#aureaSearchInput) のみを使用

btnNewChat?.addEventListener("click", (e) => {
    e.preventDefault();

    // 左カラムの「新しいチャット」は常に global（PJと混線させない）
    // PJの展開状態（activeProjectId）は変更しない
    state.context = { type: "global" };

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
      const mode = localStorage.getItem("aurea_send_mode") || "cmdEnter";
      const isEnter = (e.key === "Enter");

      if (mode === "cmdEnter") {
        if (isEnter && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          send();
        }
        return;
      }

      if (mode === "enter") {
        if (isEnter && !e.shiftKey) {
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

  const ensureGateMessage = () => {
    if (!authGate) return null;
    let msg = document.getElementById("authGateMsg");
    if (msg) return msg;

    msg = document.createElement("div");
    msg.id = "authGateMsg";
    msg.style.cssText = "margin-top:12px;opacity:.92;font-size:12px;line-height:1.55;color:#fff;";
    const card = authGate.querySelector("div > div"); // gate card
    if (card) card.appendChild(msg);
    return msg;
  };

  const setGateMessage = (text) => {
    const msg = ensureGateMessage();
    if (!msg) return;
    msg.textContent = text || "";
    msg.style.display = text ? "block" : "none";
  };

  const showAuthGate = () => {
    if (authGate) {
      authGate.style.display = "flex";

      // クリック不能の原因になりがちな「上に被さる透明要素」対策として最前面固定
      authGate.style.zIndex = "100000";
      authGate.style.pointerEvents = "auto";
    }
    if (appRoot) appRoot.setAttribute("aria-hidden", "true");
  };

const hideAuthGate = () => {
  try {
    if (authGate) {
      authGate.style.display = "none";
      authGate.setAttribute("aria-hidden", "true");
    }
    if (appRoot) {
      appRoot.removeAttribute("aria-hidden");
    }
    document.body.classList.remove("data-auth-required");
  } catch (e) {
    dbg("hideAuthGate failed", e);
  }
};

  const startGoogleLogin = (mode) => {
    // Googleログインは login.html で実行（Email/Password導線は作らない）
    const m = (mode === "company") ? "company" : "personal";
    const invite = getInvite();

    const url = new URL("/login.html", window.location.origin);
    url.searchParams.set("mode", m);

    // company 招待（token）を login.html 側へ渡す
    if (m === "company" && invite?.token) {
      url.searchParams.set("invite", String(invite.token));
    }

    window.location.href = url.toString();
  };

  // 初期は必ず Gate 表示（未ログインは本体に入れない）
  showAuthGate();

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

    setAuthState({
      loggedIn: true,
      mode: getAuthMode() || (inviteToken ? "company" : "personal"),
      email: authEmail || "",
      uid: authUid || "",
      authedAt: nowISO()
    });

    // Gate解除
    setGateMessage("");
    hideAuthGate();

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

  // 既にログイン済みなら Gate を閉じる（認証は最終的にサーバ/APIでも必須化する）
  const st = getAuthState();
  if (st?.loggedIn) {
    setGateMessage("");
    hideAuthGate();
} else {
  // 未ログイン時は Welcome Gate に留める（自動遷移しない）
  showAuthGate();
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
    setAuthMode("company");
    window.__AUREA_AUTH_MODE__ = "company";
    startGoogleLogin("company");
  });

  /* ================= boot ================= */
  if (!state.plan) state.plan = "Free";

  if (!state.user) {
    state.user = {
      displayName: "User name",
      userName: "@user name",
      email: "user@domain.com",
      trustedDevice: "MacBook Pro ・ Japan ・ Chrome",
      deviceTrusted: true
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

  // 旧state互換（settings/apps/customApps が無い場合の補完）
  if (!state.settings) {
    state.settings = {
      theme: "dark",        // "system" | "light" | "dark"
      sendMode: "cmdEnter", // "cmdEnter" | "enter"
      dataStorage: "cloud", // "cloud" | "local"
      language: "ja"        // "ja" | "en"
    };
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
        state.settings.language = (v === "en") ? "en" : "ja";

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
        if (trainerDictWrap) {
          trainerDictWrap.remove();
          trainerDictWrap = null;
        }
        trainerSelectedId = null;

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

    // select は openSettings() 後に動的生成されるので委譲で拾う
    document.addEventListener("change", (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.id !== "dataStorageSelect") return;

      const v = String(t.value || "cloud").trim();
      setStorageMode(v === "local" ? "local" : "cloud");
      syncSettingsUi();
    }, true);

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
    const un = document.getElementById("userName");

    let dnTimer = null;
    let unTimer = null;

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

    if (un) {
      un.addEventListener("input", () => {
        const v = (un.value || "").trim();
        state.user.userName = v || "";
        if (unTimer) clearTimeout(unTimer);
        unTimer = setTimeout(saveUser, 250);
      });
      un.addEventListener("blur", saveUser);
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
        Team: "¥69,000",
        Enterprise: "¥200,000〜"
      };

      const rt = encodeURIComponent(`${window.location.origin}/`);

      const goStripe = async (plan) => {
        const p = String(plan || "Free");

        const st = (typeof getAuthState === "function") ? (getAuthState() || {}) : {};
        const uid = String(st.uid || "").trim();
        const email = String(st.email || "").trim();
        if (!uid || !email) {
          alert("checkout_failed: missing_uid_or_email");
          return;
        }

        // Free は即時ダウングレード（Stripeを通さない）
        if (p === "Free") {
          const msg = ((state.settings?.language || "ja") === "en")
            ? "Downgrade to Free plan?"
            : "Freeプランにダウングレードしますか？";
          const ok = await confirmModal(msg);
          if (!ok) return;

          try {
            const r = await fetch("/api/billing/downgrade", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ uid, email })
            });

            const ct = String(r.headers.get("content-type") || "");
            const j = ct.includes("application/json") ? await r.json().catch(() => null) : null;

            if (!r.ok) {
              alert(`downgrade_failed: http_${r.status}`);
              return;
            }
            if (!j || !j.ok) {
              alert("downgrade_failed: bad_response");
              return;
            }
          } catch (e) {
            alert(`downgrade_failed: ${String(e && e.message ? e.message : e)}`);
            return;
          }

          wrap.style.display = "none";
          wrap.setAttribute("aria-hidden", "true");
          try { await refreshPlanFromServer(); } catch {}
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
            alert(`checkout_failed: http_${r.status}`);
            return;
          }
          if (!j || !j.ok || !j.url) {
            alert(`checkout_failed: bad_response`);
            return;
          }

          window.location.href = j.url;
        } catch (e) {
          alert(`checkout_failed: ${String(e && e.message ? e.message : e)}`);
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

            <button type="button" class="aurea-plan-row" data-plan="Team" style="
              width:100%;text-align:left;border-radius:14px;border:1px solid rgba(255,255,255,.10);
              background:rgba(255,255,255,.03);color:rgba(255,255,255,.92);cursor:pointer;
              padding:12px 12px;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;
            ">
              <div style="min-width:0;">
                <div style="font-weight:700;font-size:14px;line-height:1.2;">Team</div>
                <div style="margin-top:6px;font-size:12px;line-height:1.5;color:rgba(255,255,255,.70);">${escHtml(tr("planTeamDesc"))}</div>
              </div>
              <div style="text-align:right;flex:0 0 auto;">
                <div style="font-weight:700;font-size:14px;">${escHtml(PRICE.Team)}</div>
                <div style="font-size:11px;color:rgba(255,255,255,.65);">${escHtml(tr("perMonth"))}</div>
              </div>
            </button>

            <button type="button" class="aurea-plan-row" data-plan="Enterprise" style="
              width:100%;text-align:left;border-radius:14px;border:1px solid rgba(255,255,255,.10);
              background:rgba(255,255,255,.03);color:rgba(255,255,255,.92);cursor:pointer;
              padding:12px 12px;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;
            ">
              <div style="min-width:0;">
                <div style="font-weight:700;font-size:14px;line-height:1.2;">Enterprise</div>
                <div style="margin-top:6px;font-size:12px;line-height:1.5;color:rgba(255,255,255,.70);">${escHtml(tr("planEnterpriseDesc"))}</div>
              </div>
              <div style="text-align:right;flex:0 0 auto;">
                <div style="font-weight:700;font-size:14px;">${escHtml(PRICE.Enterprise)}</div>
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

    const btnChangeEmail =
      document.getElementById("btnChangeEmail")
      || document.querySelector(".panel-account .section[aria-label='サインイン'] button")
      || Array.from(document.querySelectorAll(".panel-account button")).find(b => {
        const t = String(b.textContent || "").trim();
        return t === "変更" || t === "Change";
      }) || null;

    btnChangeEmail?.addEventListener("click", async (e) => {

      e.preventDefault();
      const next = window.prompt(tr("promptNewEmail"), state.user.email || "");
      if (next === null) return;
      const v = next.trim();
      if (!v) return;
      state.user.email = v;
      saveUser();
    });

    const btnRevoke = document.getElementById("btnRevokeDevice");
    btnRevoke?.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!state.user.deviceTrusted) return;
      const ok1 = await confirmModal(tr("confirmRevokeDevice"));
      if (!ok1) return;
      state.user.deviceTrusted = false;
      saveUser();
    });

    /* ===== Trainer (AET) ===== */
    const TRAINER_CASES_KEY = "aurea_trainer_cases_v1";

    const loadTrainerCases = () => {
      try {
        const raw = localStorage.getItem(TRAINER_CASES_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      } catch { return []; }
    };

    const saveTrainerCases = (arr) => {
      try { localStorage.setItem(TRAINER_CASES_KEY, JSON.stringify(Array.isArray(arr) ? arr : [])); } catch {}
    };

const renderTrainerCases = () => {
      const mount = document.getElementById("trainerCases");
      if (!mount) return;
      mount.innerHTML = "";
    }

// ===== Trainer Case Dictionary (Apple辞書UI風) =====
let trainerDictWrap = null;
let trainerSelectedId = null;

const trainerDictCollator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

const trainerDictToHiragana = (s) => {
  // カタカナ → ひらがな
  return s.replace(/[\u30A1-\u30F6]/g, (ch) => {
    return String.fromCharCode(ch.charCodeAt(0) - 0x60);
  });
};

const trainerDictSortKey = (s) => {
  const t = String(s || "").trim().normalize("NFKC");
  // 英字は大文字化してA-Zで揃える
  const up = t.toUpperCase();
  // かなはひらがなへ揃える
  return trainerDictToHiragana(up);
};

const ensureTrainerDict = () => {
  if (trainerDictWrap) return trainerDictWrap;

  trainerDictWrap = document.createElement("div");
  trainerDictWrap.id = "trainerDict";
  trainerDictWrap.style.cssText = `
    position:fixed; inset:0;
    background:rgba(0,0,0,.45);
    display:none; align-items:center; justify-content:center;
    z-index:10080;
  `;

  const isEn = ((state.settings?.language || "ja") === "en");
  const L_Q = isEn ? "Question" : "質問";
  const L_A = isEn ? "Best answer" : "最適回答";

  trainerDictWrap.innerHTML = `
    <div style="
      width:760px; max-height:80vh;
      background:#1c1d1f;
      border-radius:16px;
      overflow:hidden;
      display:flex; flex-direction:column;
      box-shadow:0 20px 60px rgba(0,0,0,.5);
      font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Hiragino Sans','Noto Sans JP',sans-serif;
      font-size:13px;
      line-height:1.5;
      color:rgba(255,255,255,.92);
    ">
      <!-- header -->
      <div style="
        display:grid;
        grid-template-columns:1fr 1fr;
        padding:12px 16px;
        font-weight:600;
        border-bottom:1px solid rgba(255,255,255,.08);
      ">
        <div>${L_Q}</div>
        <div>${L_A}</div>
      </div>

      <div id="trainerDictList" style="
        flex:1; overflow:auto;
      "></div>

      <!-- footer -->
      <div style="
        display:flex; gap:8px; align-items:center;
        padding:10px 12px;
        border-top:1px solid rgba(255,255,255,.08);
      ">
        <button id="trainerDictAdd">＋</button>
        <button id="trainerDictDel">−</button>
      </div>
    </div>
  `;

  document.body.appendChild(trainerDictWrap);

  // close on outside
  trainerDictWrap.addEventListener("click", (e) => {
    if (e.target === trainerDictWrap) closeTrainerDict();
  });

  // add
  trainerDictWrap.querySelector("#trainerDictAdd").onclick = () => {
    openTrainerAddPopup();
  };

  // delete
  trainerDictWrap.querySelector("#trainerDictDel").onclick = async () => {
    if (!trainerSelectedId) return;

    const ok = await confirmModal("削除しますか？");
    if (!ok) return;

    const next = loadTrainerCases().filter((c) => c.id !== trainerSelectedId);
    saveTrainerCases(next);

    trainerSelectedId = null;
    renderTrainerDictList(true);
    renderTrainerCases();
  };

  return trainerDictWrap;
};

const getTrainerCasesSorted = () => {
  return loadTrainerCases()
    .slice()
    .sort((a, b) => trainerDictCollator.compare(trainerDictSortKey(a?.q), trainerDictSortKey(b?.q)));
};

const renderTrainerDictList = (autoPickFirst = false) => {
  const list = document.getElementById("trainerDictList");
  if (!list) return;

  const cases = getTrainerCasesSorted();

  if (autoPickFirst && cases.length) {
    trainerSelectedId = cases[0].id;
  }

  list.innerHTML = "";

  cases.forEach((c) => {
    const qRaw = String(c?.q || "");
    const aRaw = String(c?.a || "");

    const q1 = qRaw.split("\n")[0] || "";
    const a1 = aRaw.split("\n")[0] || "";

    const q2 = qRaw.replace(/\s+/g, " ").trim();
    const a2 = aRaw.replace(/\s+/g, " ").trim();

    const row = document.createElement("div");
    row.setAttribute("data-id", c.id);

    row.style.cssText = `
      display:grid;
      grid-template-columns:1fr 1fr;
      padding:9px 16px;
      cursor:pointer;
      background:${trainerSelectedId === c.id ? "rgba(255,255,255,.06)" : "transparent"};
      border-bottom:1px solid rgba(255,255,255,.05);
    `;

    row.title = `Q: ${q2}\nA: ${a2}`;

    row.innerHTML = `
      <div style="font-size:13px;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(q1)}</div>
      <div style="font-size:13px;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.92;">${escHtml(a1)}</div>
    `;

    row.onclick = () => {
      trainerSelectedId = c.id;
      renderTrainerDictList(false);

      const el = list.querySelector('[data-id="' + CSS.escape(String(c.id)) + '"]');
      if (el) {
        try { el.scrollIntoView({ block: "nearest" }); } catch {}
      }
    };

    list.appendChild(row);
  });

  if (trainerSelectedId) {
    const el = list.querySelector('[data-id="' + CSS.escape(String(trainerSelectedId)) + '"]');
    if (el) {
      try { el.scrollIntoView({ block: "nearest" }); } catch {}
    }
  }
};

const openTrainerDict = () => {
  ensureTrainerDict();
  bindTrainerDictHotkeysOnce();

  const cases = getTrainerCasesSorted();
  trainerSelectedId = cases.length ? cases[0].id : null;

  trainerDictWrap.style.display = "flex";
  renderTrainerDictList(false);

  if (trainerSelectedId) scrollTrainerDictRowIntoView(trainerSelectedId);
};

const closeTrainerDict = () => {
  trainerDictWrap.style.display = "none";
};
const isTrainerDictOpen = () => {
  return !!trainerDictWrap && trainerDictWrap.style.display !== "none";
};

const isTrainerAddOpen = () => {
  return !!trainerAddWrap && trainerAddWrap.style.display !== "none";
};

const isTypingTarget = (el) => {
  if (!(el instanceof Element)) return false;
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "textarea" || tag === "input") return true;
  return el.isContentEditable === true;
};

const scrollTrainerDictRowIntoView = (id) => {
  const list = document.getElementById("trainerDictList");
  if (!list) return;
  const row = list.querySelector(`[data-id="${CSS.escape(String(id || ""))}"]`);
  if (!row) return;
  try { row.scrollIntoView({ block: "nearest" }); } catch {}
};

const selectTrainerDictByDelta = (delta) => {
  const cases = getTrainerCasesSorted();
  if (!cases.length) return;

  const ids = cases.map(c => c.id);
  let idx = trainerSelectedId ? ids.indexOf(trainerSelectedId) : -1;

  if (idx < 0) idx = (delta >= 0) ? -1 : 0;
  idx = idx + delta;

  if (idx < 0) idx = 0;
  if (idx >= ids.length) idx = ids.length - 1;

  trainerSelectedId = ids[idx];
  renderTrainerDictList();
  scrollTrainerDictRowIntoView(trainerSelectedId);
};

let trainerHotkeysBound = false;

const bindTrainerDictHotkeysOnce = () => {
  if (trainerHotkeysBound) return;
  trainerHotkeysBound = true;

  document.addEventListener("keydown", async (e) => {
    if (!isTrainerDictOpen() && !isTrainerAddOpen()) return;

    // 追加ポップが開いている時：⌘+Enter で「追加」
    if (isTrainerAddOpen()) {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        const btn = trainerAddWrap?.querySelector("[data-action='add']");
        btn?.click();
        return;
      }
      // 追加ポップ中は一覧操作しない（カーソル/編集優先）
      return;
    }

    // 辞書ポップが開いている時
    if (!isTrainerDictOpen()) return;

    // 入力中は邪魔しない
    if (isTypingTarget(document.activeElement)) return;

    // ↑↓で選択移動
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      selectTrainerDictByDelta(+1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      selectTrainerDictByDelta(-1);
      return;
    }

    // Delete または ⌘+⌫ で削除（確認あり）
    const wantDelete =
      (e.key === "Delete")
      || (e.key === "Backspace" && (e.metaKey || e.ctrlKey));

    if (wantDelete) {
      if (!trainerSelectedId) return;

      e.preventDefault();
      e.stopPropagation();

      const ok = await confirmModal("削除しますか？");
      if (!ok) return;

      const next = loadTrainerCases().filter(c => c.id !== trainerSelectedId);
      saveTrainerCases(next);

      trainerSelectedId = null;
      renderTrainerDictList();
      renderTrainerCases();
      return;
    }
  }, true);
};

// ---- add popup (スクショ2：質問/最適回答 + キャンセル/追加) ----
let trainerAddWrap = null;

const ensureTrainerAddPopup = () => {
  if (trainerAddWrap) return trainerAddWrap;

  trainerAddWrap = document.createElement("div");
  trainerAddWrap.id = "trainerAddPopup";
  trainerAddWrap.setAttribute("aria-hidden", "true");
  trainerAddWrap.style.cssText = `
    position:fixed; inset:0;
    display:none; align-items:center; justify-content:center;
    background:rgba(0,0,0,.35);
    z-index:10090;
    padding:18px;
  `;

  trainerAddWrap.innerHTML = `
    <div style="
      width:min(860px, calc(100% - 24px));
      max-height:calc(100vh - 64px);
      background:rgba(20,21,22,.96);
      border:1px solid rgba(255,255,255,.10);
      border-radius:22px;
      box-shadow:0 10px 30px rgba(0,0,0,.45);
      overflow:hidden;
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      color:rgba(255,255,255,.92);
      font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Hiragino Sans','Noto Sans JP',sans-serif;
      display:flex;
      flex-direction:column;
      min-width:0;
      padding:18px 18px 14px;
      gap:14px;
    ">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div style="font-size:14px;font-weight:600;opacity:.92;">ケースを追加</div>
        <button type="button" data-action="close" style="
          width:36px;height:36px;border-radius:12px;
          border:1px solid rgba(255,255,255,.12);
          background:rgba(255,255,255,.06);
          color:rgba(255,255,255,.92);
          cursor:pointer;
          font-size:18px;
          line-height:34px;
        ">×</button>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;">
        <div style="font-size:13px;font-weight:600;opacity:.92;">質問</div>
        <textarea id="trainerAddQ" rows="3" style="
          width:100%;
          border-radius:18px;
          border:1px solid rgba(255,255,255,.10);
          background:rgba(255,255,255,.04);
          color:rgba(255,255,255,.92);
          outline:none;
          padding:12px 14px;
          font-size:13px;
          line-height:1.7;
          resize:vertical;
          min-height:84px;
        "></textarea>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;min-height:0;">
        <div style="font-size:13px;font-weight:600;opacity:.92;">最適回答</div>
        <textarea id="trainerAddA" rows="8" style="
          width:100%;
          border-radius:18px;
          border:1px solid rgba(255,255,255,.10);
          background:rgba(255,255,255,.04);
          color:rgba(255,255,255,.92);
          outline:none;
          padding:12px 14px;
          font-size:13px;
          line-height:1.7;
          resize:vertical;
          min-height:240px;
        "></textarea>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:12px;padding-top:4px;">
        <button type="button" data-action="cancel" style="
          height:44px;
          padding:0 18px;
          border-radius:14px;
          border:1px solid rgba(255,255,255,.12);
          background:rgba(255,255,255,.05);
          color:rgba(255,255,255,.90);
          cursor:pointer;
          font-size:13px;
        ">キャンセル</button>

        <button type="button" data-action="add" style="
          height:44px;
          padding:0 18px;
          border-radius:14px;
          border:1px solid rgba(255,255,255,.12);
          background:rgba(255,255,255,.10);
          color:rgba(255,255,255,.92);
          cursor:pointer;
          font-size:13px;
          font-weight:600;
        ">追加</button>
      </div>
    </div>
  `;

  document.body.appendChild(trainerAddWrap);

  trainerAddWrap.addEventListener("click", (e) => {
    if (e.target === trainerAddWrap) closeTrainerAddPopup();
  });

  trainerAddWrap.addEventListener("click", (e) => {
    const t = e.target;

    if (t.closest("[data-action='close']")) { e.preventDefault(); closeTrainerAddPopup(); return; }
    if (t.closest("[data-action='cancel']")) { e.preventDefault(); closeTrainerAddPopup(); return; }

    const addBtn = t.closest("[data-action='add']");
    if (!addBtn) return;

    e.preventDefault();

    const q = (document.getElementById("trainerAddQ")?.value || "").trim();
    const a = (document.getElementById("trainerAddA")?.value || "").trim();
    if (!q || !a) return;

    const arr = loadTrainerCases();
    arr.unshift({ id: uid(), q, a, createdAt: nowISO() });
    saveTrainerCases(arr);

    closeTrainerAddPopup();
    renderTrainerDictList();
    renderTrainerCases();
  });

  return trainerAddWrap;
};

const openTrainerAddPopup = () => {
  ensureTrainerAddPopup();

  const q = document.getElementById("trainerAddQ");
  const a = document.getElementById("trainerAddA");
  if (q) q.value = "";
  if (a) a.value = "";

  trainerAddWrap.style.display = "flex";
  trainerAddWrap.setAttribute("aria-hidden", "false");
  setTimeout(() => q?.focus(), 0);
};

const closeTrainerAddPopup = () => {
  if (!trainerAddWrap) return;
  trainerAddWrap.style.display = "none";
  trainerAddWrap.setAttribute("aria-hidden", "true");
};

// button bind
document.getElementById("btnAddTrainerCase")
  ?.addEventListener("click", e => {
    e.preventDefault();
    openTrainerDict();
  });

// 初期描画
renderTrainerCases();

    // Legal modal (3 items)
    const legalOverlay = document.getElementById("legalOverlay");
    const btnCloseLegalModal = document.getElementById("btnCloseLegalModal");
    const legalModalTitle = document.getElementById("legalModalTitle");
    const legalModalBody = document.getElementById("legalModalBody");

    const legalContent = {
      tokusho: {
        ja: `
          <div class="reg-text">
            事業者名：INVITATION.co<br>
            販売価格：各プランページに表示（税抜）<br>
            商品以外の料金：通信料等は利用者負担<br>
            支払方法：クレジットカード<br>
            支払時期：申込時に確定、以後は更新日に自動課金<br>
            提供時期：決済完了後、直ちに利用可能<br>
            返品・キャンセル：デジタルサービスの性質上、不可（法令に基づく場合を除く）<br>
            お問い合わせ：from.invitation@gmail.com、担当まで
          </div>
        `,
        en: `
          <div class="reg-text">
            Business name: INVITATION.co<br>
            Price: Displayed on each plan page (tax excluded)<br>
            Additional fees: Communication charges etc. are borne by the user<br>
            Payment method: Credit card<br>
            Payment timing: Confirmed at purchase; automatically charged on renewal date thereafter<br>
            Service availability: Available immediately after successful payment<br>
            Refunds/Cancellations: Generally not available due to the nature of digital services (except where required by law)<br>
            Contact: from.invitation@gmail.com (Attn.)
          </div>
        `
      },

      terms: {
        ja: `
          <div class="reg-text">
            本サービスは、AIを用いて情報の整理・要約・提案を提供します。<br>
            提供される内容は正確性を保証しません。<br>
            重要な判断は利用者が必ず追加確認を行ってください。<br>
            不正利用、第三者の権利侵害、法令違反行為は禁止します。<br>
            当社は、必要に応じてサービス内容の変更・停止を行う場合があります。
          </div>
        `,
        en: `
          <div class="reg-text">
            This service provides organization, summaries, and suggestions using AI.<br>
            We do not guarantee accuracy. Please verify important decisions independently.<br>
            Misuse, infringement of third-party rights, and illegal activities are prohibited.<br>
            We may change or suspend the service as necessary.
          </div>
        `
      },

      privacy: {
        ja: `
          <div class="reg-text">
            当社は、アカウント情報（メール、表示名等）および利用ログ等を、<br>
            サービス提供・改善・不正防止の目的で取り扱います。<br>
            法令に基づく場合を除き、本人の同意なく第三者へ提供しません。<br>
            収集・利用・保管の詳細は、本ポリシーおよび関連法令に従います。
          </div>
        `,
        en: `
          <div class="reg-text">
            We handle account information (email, display name, etc.) <br>
            and usage logs for service delivery, improvement, and fraud prevention.<br>
            We do not provide personal data to third parties without consent except as required by law.<br>
            Collection, use, and retention follow this policy and applicable laws.
          </div>
        `
      }
    };

    const openLegalModal = (key) => {
      if (!legalOverlay || !legalModalTitle || !legalModalBody) return;

      const k = (key === "terms" || key === "privacy" || key === "tokusho") ? key : "tokusho";
      legalModalTitle.textContent =
        (k === "tokusho") ? tr("tokusho")
        : (k === "terms") ? tr("terms")
        : tr("privacy");

      // reset (CSS handles padding; JS only controls scroll when needed)
      legalModalBody.style.maxHeight = "";
      legalModalBody.style.overflowY = "";
      legalModalBody.style.paddingRight = "";

      const lang = ((state.settings?.language || "ja") === "en") ? "en" : "ja";
      const html = (legalContent[k] && legalContent[k][lang]) ? legalContent[k][lang] : "";

      legalModalBody.innerHTML = html;
      legalOverlay.style.display = "flex";

      // 長文だけスクロールを付与
      requestAnimationFrame(() => {
        const maxPx = Math.min(Math.round(window.innerHeight * 0.6), 520);
        if (legalModalBody.scrollHeight > maxPx + 8) {
          legalModalBody.style.maxHeight = "min(60vh, 520px)";
          legalModalBody.style.overflowY = "auto";
          legalModalBody.style.paddingRight = "0px";
        }
        legalOverlay.classList.add("is-open");
      });
    };

    const closeLegalModal = () => {
      if (!legalOverlay) return;
      legalOverlay.classList.remove("is-open");
      setTimeout(() => {
        legalOverlay.style.display = "none";
      }, 180);
    };

    document.querySelectorAll(".settings-modal [data-legal]").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.preventDefault();
        openLegalModal(b.getAttribute("data-legal"));
      });
    });

    btnCloseLegalModal?.addEventListener("click", (e) => {
      e.preventDefault();
      closeLegalModal();
    });

    legalOverlay?.addEventListener("click", (e) => {
      if (e.target === legalOverlay) closeLegalModal();
    });
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

        try {
          // save() は選択中の保存先に書く
          save(state);

          // 念のため両方へも書く（cloud/localズレ対策）
          localStorage.setItem("aurea_main_v1_cloud", JSON.stringify(state));
          localStorage.setItem("aurea_main_v1_local", JSON.stringify(state));
        } catch {}

        try { syncAccountUi(); } catch {}
        try { syncSettingsUi(); } catch {}
      }

    } catch {}
  };

  // reflect immediately
  syncAccountUi();
  syncSettingsUi();
  applyI18n();
  bindSettings();

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

      // billing=success の直後は webhook 反映に遅延があるため追加で再取得
      try {
        const qs = new URLSearchParams(window.location.search);
        if (qs.get("billing") === "success") {
          for (let i = 0; i < 12; i++) {
            await new Promise((r) => setTimeout(r, 500));
            await refreshPlanFromServer();
            if (String(state.plan || "") === "Pro") break;
          }
        }
      } catch {}

      try {
        // save() は選択中の保存先に書く
        save(state);

        // 念のため両方へも書く（cloud/localズレ対策）
        localStorage.setItem("aurea_main_v1_cloud", JSON.stringify(state));
        localStorage.setItem("aurea_main_v1_local", JSON.stringify(state));
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
})();
