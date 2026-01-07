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
    // Theme
    const selTheme = document.querySelector(".settings-modal #settingsTheme");
    if (selTheme) {
      selTheme.value = (state.settings?.theme || "dark");
    }

    // Language
    const selLang = document.querySelector(".settings-modal #settingsLang");
    if (selLang) {
      selLang.value = (state.settings?.language || "ja");
    }

    // Send mode
    const selSend = document.querySelector(".settings-modal #settingsSendMode");
    if (selSend) {
      const mode = state.settings?.sendMode || (localStorage.getItem("aurea_send_mode") || "cmdEnter");
      selSend.value = (mode === "enter") ? "enter" : "cmdEnter";
    }

    // Data storage
    const selData = document.querySelector(".settings-modal select[aria-label='会話とデータの保存先']");
    if (selData && state.settings?.dataStorage) {
      const label = (state.settings.dataStorage === "local") ? "端末内" : "クラウド";
      Array.from(selData.options).forEach(o => { o.selected = (o.textContent === label); });
    }

    const dataNow = document.querySelector(".panel-data .section[aria-label='保存設定'] .row .l .v");
    if (dataNow) dataNow.textContent = `現在：${(state.settings?.dataStorage === "local") ? "端末内" : "クラウド"}`;

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

    // Sidebar search placeholder (mounted)
    const sbSearch = document.getElementById("aureaSearchInput");
    if (sbSearch) {
      sbSearch.placeholder = tr("search");
      sbSearch.setAttribute("aria-label", tr("search"));
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

    // data-i18n / data-i18n-aria 全反映（HTML属性ベース）
    applyI18nAttrs();
  };

let suppressSettingsBackdropOnce = false;

const openSettings = () => {
  const tabGeneral = document.getElementById("tab-general");
  if (tabGeneral) tabGeneral.checked = true;

  suppressSettingsBackdropOnce = true;

  settingsModal?.removeAttribute("hidden");
  settingsModal?.classList.add("is-open");
  body.style.overflow = "hidden";

  ensureAppsGrid();

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
    { name: "GPT",        ver: "GPT-5.2",            condition: "総合監修・最終判断/回答提案" },
    { name: "Gemini",     ver: "Gemini 3",          condition: "大規模範囲の情報収集・マルチモーダル対応" },
    { name: "Claude",     ver: "Claude 4",          condition: "長文分析・構造/論点の洗い出し" },
    { name: "Perplexity", ver: "最新版",         condition: "検証・裏取り・ハルシネーション対応" },
    { name: "Mistral",    ver: "Mistral Lange3,",   condition: "高速処理・軽量質疑対応" },
    { name: "Sora",       ver: "Sora 2",            condition: "画像生成時に稼働" }
  ];

  const syncAiStackHeader = () => {
    if (!aiStackOverlay) return;
    const headRow = aiStackOverlay.querySelector(".table__row--head");
    if (!headRow) return;

    headRow.innerHTML = `
      <div class="table__cell">AI</div>
      <div class="table__cell">Ver,</div>
      <div class="table__cell">稼働条件</div>
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
      const condText = (localCond[a.name] != null) ? String(localCond[a.name]) : String(a.condition || "");

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

  /* ================= search box mount ================= */
  let sbSearchInput = null;

  const mountSidebarSearch = () => {
    if (!sidebar) return;

    const sbTop = sidebar.querySelector(".sb-top");
    if (!sbTop) return;

    // 既に存在する場合は何もしない（再生成しない）
    if (sbTop.querySelector("#aureaSearchInput")) return;

    const wrap = document.createElement("div");
    wrap.className = "sb-search";

    const input = document.createElement("input");
    input.id = "aureaSearchInput";

    // ★ legacy search / ESC操作でも参照できるように保持
    sbSearchInput = input;

    input.type = "search";
    input.placeholder = (state.settings?.language === "en") ? "Search" : "検索";
    input.setAttribute("aria-label", (state.settings?.language === "en") ? "Search" : "検索");

    wrap.appendChild(input);
    sbTop.insertBefore(wrap, sbTop.firstChild);

    // GPT準拠：横断検索（global + project）
    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      renderSearchView(q);
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
    sendBtn.style.display = hasText ? "" : "none";
    if (micBtn) micBtn.style.display = hasText ? "none" : "";
    if (voiceBtn) voiceBtn.style.display = hasText ? "none" : "";
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
      bubble.innerHTML = escHtml(m.content);

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

    // scroll bottom
    if (board) board.scrollTo({ top: board.scrollHeight, behavior: "smooth" });
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

  const applyBodyViewClass = () => {
    body.classList.toggle("view-chat", state.view === "chat");
    body.classList.toggle("view-images", state.view === "images");
    body.classList.toggle("view-search", state.view === "search");
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
      if (chatRoot) chatRoot.style.display = "none";
      renderSearchView(sbSearchInput?.value || "");
      setHasChat(false);
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

        // isActive: いま表示している会話コンテキスト（実体）
        const isActive = (state.context?.type === "project" && state.context?.projectId === p.id);

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

          // PJ内：新しいチャット（作成）
          const newA = document.createElement("a");
          newA.href = "#";
          newA.className = "pj-thread pj-new-thread";
          newA.dataset.action = "pj-new-thread";
          newA.dataset.projectId = p.id;
          newA.innerHTML = `<div class="t">${escHtml(tr("threadNew"))}</div>`;
          inner.appendChild(newA);

          // PJ threads（PJ内チャットのみ表示）
          const list = (state.threads.projects[p.id] || []).slice()
            .sort((a,b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

          list.forEach((t) => {
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
            inner.appendChild(a);
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

  /* ================= selection ================= */
  const selectProjectScope = (projectId) => {
    // PJは「入れ物」：選択＝展開のみ（会話コンテキストは切り替えない）
    state.activeProjectId = projectId;

    save(state);
    renderSidebar();
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

  const setStreaming = (on) => {
    if (stopBtn) stopBtn.style.display = on ? "" : "none";
    if (sendBtn) sendBtn.style.display = on ? "none" : (askInput?.value.trim() ? "" : "none");
    if (micBtn) micBtn.style.display = on ? "none" : (askInput?.value.trim() ? "none" : "");
    if (voiceBtn) voiceBtn.style.display = on ? "none" : (askInput?.value.trim() ? "none" : "");
  };

  const stopStreaming = () => {
    streamAbort = true;
    if (streamTimer) { clearInterval(streamTimer); streamTimer = null; }
    setStreaming(false);
  };

  const fakeReply = async (userText) => {
    const reply = `${tr("aureaPrefix")}\n${userText}\n\n${tr("replyPlaceholder")}`;

    const m = appendMessage("assistant", "");
    if (!m) return;

    streamAbort = false;
    setStreaming(true);

    let i = 0;
    streamTimer = setInterval(() => {
      if (streamAbort) { stopStreaming(); return; }
      i += 2;
      updateMessage(m.id, reply.slice(0, i));
      renderChat();
      if (i >= reply.length) {
        clearInterval(streamTimer);
        streamTimer = null;
        setStreaming(false);
        renderSidebar();
      }
    }, 18);
  };

  const send = async () => {
    if (!askInput) return;
    const text = askInput.value.trim();
    if (!text) return;

    state.view = "chat";
    save(state);

    appendMessage("user", text);
    askInput.value = "";
    autosizeTextarea();
    updateSendButtonVisibility();

    await fakeReply(text);
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
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        input.accept = "*/*";
        input.style.display = "none";
        document.body.appendChild(input);
        input.addEventListener("change", () => document.body.removeChild(input));
        input.click();
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

  micBtn?.addEventListener("click", (e) => { e.preventDefault(); });
  voiceBtn?.addEventListener("click", (e) => { e.preventDefault(); });

/* ================= global close rules ================= */
  document.addEventListener("pointerdown", (e) => {
    const t = e.target;

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
    if (aiStackOverlay && aiStackOverlay.style.display === "flex") { closeAiStackPopup(); return; }

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

    // PJ内スレッド（pj-thread）クリック：ここでのみ project context に切替
    const pjThread = t.closest(".pj-thread[data-action='pj-open-thread']");
    if (pjThread) {
      e.preventDefault();

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

      // PJ選択＝展開のみ（会話は切り替えない）
      e.preventDefault();
      state.activeProjectId = id;
      save(state);
      renderSidebar();
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
      state.context = { type: "global" };
      setActiveThreadId(id);
      state.view = "chat";
      save(state);

      renderSidebar();
      renderView();
      askInput?.focus();
      return;
    }

    // search card click
    const sCard = t.closest(".search-card");
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
      const mid = copyBtn.dataset.mid;
      const th = getThreadByIdInScope(getActiveThreadId());
      const msg = th?.messages?.find(m => m.id === mid);
      if (msg) await copyText(msg.content || "");
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
        const ok = await confirmModal(`${name} を解除しますか？`);
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
    const selData  = document.querySelector(".settings-modal #settingsDataStorage");

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

        saveSettings();
        applyI18n();
        renderSidebar();

        // 強制再描画（混在防止）
        clearBoardViewNodes();
        renderView();
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

  if (selData) {
    selData.addEventListener("change", () => {
      const tval = (selData.value || selData.options[selData.selectedIndex]?.textContent || "").trim();
      const nextMode = (tval === "端末内" || tval === "Local") ? "local" : "cloud";

      const prevKey = getStorageKey();

      try { localStorage.setItem(STORAGE_PREF_KEY, nextMode); } catch {}

      // state側も更新
      state.settings.dataStorage = nextMode;

      // 移行：新キーへ保存（旧キーは保持）
      try { localStorage.setItem(getStorageKey(), JSON.stringify(state)); } catch {}

      // UI反映
      saveSettings();

      // 旧キーに残っているデータがある場合もあるため、必要なら参照できるよう保持
      // prevKey は未使用でも削除しない
      void prevKey;
    });
  }

/* ===== Apps ===== */
    const btnAddSaas = document.querySelector(".panel-apps .apps-header .btn");
    btnAddSaas?.addEventListener("click", (e) => {
      e.preventDefault();
      openSaasAddPopup();
    });

    bindAppsConnectorsOnce();

    /* ===== Data ===== */
    const btnDeleteAll = document.querySelector(".panel-data .section[aria-label='削除'] .btn.danger");
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

    const btnBilling = document.getElementById("btnBilling");
    btnBilling?.addEventListener("click", async (e) => {
      e.preventDefault();
      await confirmModal("請求情報を開きますか？");
    });

    const btnChangeEmail = document.getElementById("btnChangeEmail");
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
      const ok1 = await confirmModal("この端末を解除しますか？");
      if (!ok1) return;
      state.user.deviceTrusted = false;
      saveUser();
    });

    // Regulations tabs
    const tabs = Array.from(document.querySelectorAll(".settings-modal .reg-tab"));
    const panels = Array.from(document.querySelectorAll(".settings-modal .reg-panel"));

    const openReg = (key) => {
      tabs.forEach(b => b.setAttribute("aria-selected", (b.dataset.regTab === key) ? "true" : "false"));
      panels.forEach(p => {
        const on = (p.dataset.regPanel === key);
        if (on) p.removeAttribute("hidden");
        else p.setAttribute("hidden", "");
      });
    };

    tabs.forEach((b) => {
      b.addEventListener("click", (e) => {
        e.preventDefault();
        openReg(b.dataset.regTab || "tokusho");
      });
    });

    openReg("tokusho");
  };

  ensureActiveThread();

  // render
  renderSidebar();
  renderView();

  // sidebar search（render 後に必ず mount）
  mountSidebarSearch();

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
        alert("Google アカウントの連携が完了しました");
      }, 0);

      return;
    }

    if (connect === "error") {
      const err = params.get("error") || "unknown";
      history.replaceState({}, document.title, "/");
      setTimeout(() => {
        alert(`Google 連携に失敗しました: ${err}`);
      }, 0);
    }
  })();

  // reflect immediately
  syncAccountUi();
  syncSettingsUi();
  applyI18n();
  bindSettings();

  // centered ask (no thread selected / no messages)
  setHasChat(false);

  // ask init（DOM確定後）
  if (askInput) {
    autosizeTextarea();
    updateSendButtonVisibility();
  }
})();
