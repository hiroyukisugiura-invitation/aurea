/* public/assets/js/layout.js (AUREA v1 - rebuilt)
  요구사항:
  - 左カラム最上部に「検索」ラベル＋検索窓
  - 検索は AUREA 内の全会話（global + 全project）を横断検索
  - [画像] は会話とは別の集約ボックス（全会話の作成画像を集約）
  - [プロジェクト][チャット] はプルダウン + 履歴保存（localStorage）
  - プロジェクトとチャットは別扱い（scope 分離）
  - ユーザーボタン→設定 はメイン画面内ポップアップ（settings-modal）
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
  const STORAGE_KEY = "aurea_main_v1";
  const load = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  };
  const save = (s) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
  };

  /* ================= state ================= */
  const defaultState = () => ({
    version: 1,

    // view: "chat" | "images" | "search"
    view: "chat",

    // project selection is independent from chat
    activeProjectId: null,

    // scope is kept for future, but chat list is always global in v1
    scope: { type: "global" },

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
    images: [], // [{id, createdAt, src, prompt, from:{scopeType, projectId, threadId}}]

    // plan
    plan: "Free"
  });

  const state = load() || defaultState();

  // IMPORTANT: reload should not start in images
  state.view = "chat";

  /* ================= elements ================= */
  const body = document.body;

  const sidebar = $(".sidebar");
  const sbTop = $(".sb-top", sidebar);

  const userDetails = $(".user-menu details");
  const plusDetails = $(".plus-menu details");

  const settingsModal = $(".settings-modal");
  const projectModal = $(".project-modal");

  const projectNameInput = $(".project-modal .pname");
  const projectCreateBtn = $(".project-modal .pcreate");

  const chatRoot = $(".chat");
  const board = $(".board");

  // ask
  const askInput = $(".ask .in");
  const sendBtn = $(".ask [data-action='send']");
  const micBtn = $(".ask [data-action='mic']");
  const voiceBtn = $(".ask [data-action='voice']");
  const stopBtn = $(".ask [data-action='stop']");

  // sidebar buttons
  const btnSearchLegacy = $(".sb-item[aria-label='チャット内を検索']");
  const btnNewChat = $(".sb-item[aria-label='新しいチャット']");
  const btnImages = $(".sb-item[aria-label='画像']");
  const btnShare = $(".topbar .icon-btn[aria-label='シェア']");

  const linkSettings = $(".user-pop a[aria-label='設定']");
  const linkLogout = $(".user-pop a[aria-label='ログアウト']");

  // groups
  const projectGroup = $$(".sb-group").find(d => d.querySelector("summary[aria-label='プロジェクト']"));
  const chatGroup = $$(".sb-group").find(d => d.querySelector("summary[aria-label='チャット']"));
  const projectList = projectGroup ? $(".group-body", projectGroup) : null;
  const chatList = chatGroup ? $(".group-body", chatGroup) : null;

  /* ================= search box mount ================= */
  let sbSearchInput = null;

  const mountSidebarSearch = () => {
    if (!sbTop) return;
    if ($(".sb-search", sbTop)) {
      sbSearchInput = $("#aureaSearchInput", sbTop);
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "sb-search";
    wrap.innerHTML = `
      <div class="lbl">検索</div>
      <input id="aureaSearchInput" type="search" placeholder="会話を検索" aria-label="検索" />
    `;
    sbTop.insertBefore(wrap, sbTop.firstChild);

    sbSearchInput = $("#aureaSearchInput", wrap);

    // input -> open Search View and render results
    sbSearchInput.addEventListener("input", () => {
      const q = (sbSearchInput.value || "").trim();
      if (!q) {
        // if already on search view, keep empty state
        if (state.view === "search") renderView();
        return;
      }
      state.view = "search";
      save(state);
      renderView();
    });

    sbSearchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        sbSearchInput.value = "";
        if (state.view === "search") {
          state.view = "chat";
          save(state);
          renderView();
        }
      }
    });
  };

  /* ================= scope helpers ================= */
  // scope: global / project を分離（リンクしない）
  const getThreadsForScope = () => {
    if (state.scope.type === "global") return state.threads.global;
    const pid = state.scope.projectId;
    if (!state.threads.projects[pid]) state.threads.projects[pid] = [];
    return state.threads.projects[pid];
  };

  const getActiveThreadId = () => {
    if (state.scope.type === "global") return state.activeThreadIdByScope.global;
    return state.activeThreadIdByScope.projects[state.scope.projectId] || null;
  };

  const setActiveThreadId = (tid) => {
    if (state.scope.type === "global") state.activeThreadIdByScope.global = tid;
    else state.activeThreadIdByScope.projects[state.scope.projectId] = tid;
    save(state);
  };

  const getThreadByIdInScope = (tid) => {
    const threads = getThreadsForScope();
    return threads.find(t => t.id === tid) || null;
  };

  const ensureActiveThread = () => {
    const threads = getThreadsForScope();
    const tid = getActiveThreadId();
    if (!tid || !threads.some(t => t.id === tid)) {
      // do not auto-select old thread on load; only when user selects.
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

  /* ================= settings modal ================= */
  const openSettingsModal = () => {
    body.classList.add("settings-open");
    settingsModal?.setAttribute("aria-hidden", "false");
  };
  const closeSettingsModal = () => {
    body.classList.remove("settings-open");
    settingsModal?.setAttribute("aria-hidden", "true");
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
        <div style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08);font-size:14px;font-weight:600;">確認</div>
        <div id="aureaConfirmText" style="padding:14px 16px;font-size:13px;line-height:1.6;color:rgba(255,255,255,.82);"></div>
        <div style="padding:14px 16px;border-top:1px solid rgba(255,255,255,.08);display:flex;justify-content:flex-end;gap:10px;">
          <button id="aureaConfirmCancel" type="button" style="
            height:34px;padding:0 12px;border-radius:10px;border:1px solid rgba(255,255,255,.12);
            background:transparent;color:rgba(255,255,255,.80);cursor:pointer;font-size:13px;
          ">キャンセル</button>
          <button id="aureaConfirmOk" type="button" style="
            height:34px;padding:0 12px;border-radius:10px;border:1px solid rgba(255,255,255,.12);
            background:rgba(255,255,255,.08);color:rgba(255,255,255,.92);cursor:pointer;font-size:13px;
          ">OK</button>
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

    if (text) text.textContent = message || "よろしいですか？";

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

    const ok1 = await confirmModal("プロジェクトを作成しますか？");
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
    const threads = getThreadsForScope();
    const t = { id: uid(), title: "新しいチャット", updatedAt: nowISO(), messages: [] };
    threads.unshift(t);
    setActiveThreadId(t.id);
    save(state);

    state.view = "chat";
    save(state);

    renderSidebar();
    renderView();

    // new chat => centered
    setHasChat(false);
    askInput?.focus();
  };

  const renameThread = (threadId) => {
    const threads = getThreadsForScope();
    const t = threads.find(x => x.id === threadId);
    if (!t) return;
    const next = window.prompt("新しい名前", t.title || "新しいチャット");
    if (next === null) return;
    const v = next.trim();
    if (!v) return;
    t.title = v;
    t.updatedAt = nowISO();
    save(state);
    renderSidebar();
  };

  const deleteThread = async (threadId) => {
    const ok1 = await confirmModal("削除しますか？");
    if (!ok1) return;

    const threads = getThreadsForScope();
    const idx = threads.findIndex(x => x.id === threadId);
    if (idx < 0) return;

    threads.splice(idx, 1);

    if (getActiveThreadId() === threadId) {
      setActiveThreadId(null);
    }

    save(state);
    renderSidebar();
    renderView();
  };

  const appendMessage = (role, content) => {
    const threads = getThreadsForScope();
    let t = getThreadByIdInScope(getActiveThreadId());

    if (!t) {
      createThread();
      t = getThreadByIdInScope(getActiveThreadId());
      if (!t) return null;
    }

    const m = { id: uid(), role, content: content || "", createdAt: nowISO() };
    t.messages.push(m);
    t.updatedAt = nowISO();

    if (role === "user" && (t.title === "新しいチャット" || !t.title)) {
      const s = content.trim();
      t.title = s.length > 28 ? s.slice(0, 28) : s;
    }

    save(state);
    renderSidebar();
    renderView();
    return m;
  };

  const updateMessage = (mid, content) => {
    const t = getThreadByIdInScope(getActiveThreadId());
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
    const ok1 = await confirmModal("画像を削除しますか？");
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
          threadTitle: t.title || "新しいチャット",
          snippet: "（タイトル一致）"
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
          threadTitle: t.title || "新しいチャット",
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
      state.scope = { type: "global" };
      setActiveThreadId(hit.threadId);
    } else {
      state.scope = { type: "project", projectId: hit.projectId };
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

    const t = getThreadByIdInScope(getActiveThreadId());
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
          <div class="images-title">画像</div>
          <div class="images-sub">会話内で作成された画像がここに保存されます</div>
        </div>
      </div>

      <div id="aureaImagesBody"></div>
    `;

    board?.appendChild(wrap);

    const bodyEl = $("#aureaImagesBody", wrap);
    if (!bodyEl) return;

    if (!state.images || state.images.length === 0) {
      bodyEl.innerHTML = `<div class="images-empty">まだ保存された画像がありません。</div>`;
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
            <button class="img-btn" type="button" data-action="open" title="開く">↗</button>
            <button class="img-btn" type="button" data-action="delete" title="削除">×</button>
          </div>
        </div>
      `;

      grid.appendChild(card);
    }

    bodyEl.appendChild(grid);
  };

  const renderSearchView = () => {
    clearBoardViewNodes();

    const q = (sbSearchInput?.value || "").trim();
    const hits = searchAll(q);

    const wrap = document.createElement("div");
    wrap.id = "aureaView";
    wrap.className = "view view-search";

    wrap.innerHTML = `
      <div class="search-head">
        <div>
          <div class="search-title">検索結果</div>
          <div class="search-sub">${q ? `「${escHtml(q)}」の検索結果（${hits.length}件）` : "検索語を入力してください"}</div>
        </div>
      </div>

      <div class="search-results" id="aureaSearchResults"></div>
    `;

    board?.appendChild(wrap);

    const list = $("#aureaSearchResults", wrap);
    if (!list) return;

    if (!q) return;

    if (hits.length === 0) {
      list.innerHTML = `<div class="images-empty">一致する会話が見つかりませんでした。</div>`;
      return;
    }

    for (const h of hits) {
      const projName = h.scopeType === "project"
        ? (state.projects.find(p => p.id === h.projectId)?.name || "プロジェクト")
        : "チャット";

      const meta = h.scopeType === "project" ? `プロジェクト: ${projName}` : "グローバル";

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
      renderSearchView();
      setHasChat(false);
      return;
    }

    // chat view
    clearBoardViewNodes();
    if (chatRoot) chatRoot.style.display = "";
    renderChat();
  };

  /* ================= sidebar render ================= */
  const clearNode = (el) => { if (el) el.innerHTML = ""; };

  const fmtDate = (iso) => {
    try{
      const d = new Date(iso);
      const mm = String(d.getMonth()+1).padStart(2,"0");
      const dd = String(d.getDate()).padStart(2,"0");
      return `${mm}/${dd}`;
    }catch{
      return "";
    }
  };

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

        const isActive = (state.activeProjectId === p.id);
        if (isActive) link.setAttribute("data-active","1");

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
        rename.textContent = "名前を変更する";
        rename.dataset.action = "rename-project";

        const del = document.createElement("button");
        del.type = "button";
        del.className = "sb-act danger";
        del.textContent = "削除する";
        del.dataset.action = "delete-project";

        pop.appendChild(rename);
        pop.appendChild(del);

        more.appendChild(sum);
        more.appendChild(pop);

        row.appendChild(link);
        row.appendChild(more);
        projectList.appendChild(row);

        // Active PJ の時だけ、PJ内のUI（+ 新しいチャット / 履歴）を出す
        if (isActive) {
          const inner = document.createElement("div");
          inner.className = "pj-inner";
          inner.dataset.projectId = p.id;

          // + PJ名：新しいチャット
          const newChat = document.createElement("a");
          newChat.href = "#";
          newChat.className = "pj-newchat";
          newChat.dataset.action = "pj-newchat";
          newChat.dataset.projectId = p.id;
          newChat.innerHTML = `
            <span style="opacity:.9">＋</span>
            <span style="min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(p.name)}：新しいチャット</span>
          `;
          inner.appendChild(newChat);

          // subhead
          const sub = document.createElement("div");
          sub.className = "pj-subhead";
          sub.textContent = "PJ内で会話した履歴";
          inner.appendChild(sub);

          // PJ threads
          const list = (state.threads.projects[p.id] || []).slice()
            .sort((a,b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

          list.forEach((t) => {
            const a = document.createElement("a");
            a.href = "#";
            a.className = "pj-thread";
            a.dataset.action = "pj-open-thread";
            a.dataset.projectId = p.id;
            a.dataset.threadId = t.id;

            a.innerHTML = `
              <div class="t">${escHtml(t.title || "新しいチャット")}</div>
              <div class="d">${escHtml(fmtDate(t.updatedAt || t.createdAt || ""))}</div>
            `;
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

    const threads = getThreadsForScope().slice();
    threads.sort((a,b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

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
      link.setAttribute("aria-label", t.title || "新しいチャット");
      link.textContent = t.title || "新しいチャット";

      if (getActiveThreadId() === t.id) {
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
      rename.textContent = "名前を変更する";
      rename.dataset.action = "rename-thread";

      const del = document.createElement("button");
      del.type = "button";
      del.className = "sb-act danger";
      del.textContent = "削除する";
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
  };

  /* ================= selection ================= */
  const selectProjectScope = (projectId) => {
    state.activeProjectId = projectId;

    // PJを選択したら scope を project に切り替える（PJ内チャットはPJ内）
    state.scope = { type: "project", projectId };

    ensureActiveThread(); // 自動で選ばない（既存の方針維持）
    state.view = "chat";

    save(state);
    renderSidebar();
    renderView();
    askInput?.focus();
  };

  const selectGlobalScope = () => {
    state.scope = { type: "global" };
    ensureActiveThread();
    state.view = "chat";
    save(state);

    renderSidebar();
    renderView();
    askInput?.focus();
  };

  const selectThread = (threadId) => {
    setActiveThreadId(threadId);
    state.view = "chat";
    save(state);

    renderSidebar();
    renderView();
    askInput?.focus();
  };

  /* ================= rename/delete project ================= */
  const renameProject = (projectId) => {
    const p = state.projects.find(x => x.id === projectId);
    if (!p) return;
    const next = window.prompt("新しい名前", p.name);
    if (next === null) return;
    const v = next.trim();
    if (!v) return;
    p.name = v;
    p.updatedAt = nowISO();
    save(state);
    renderSidebar();
  };

  const deleteProject = async (projectId) => {
    const ok1 = await confirmModal("プロジェクトを削除しますか？");
    if (!ok1) return;

    state.projects = state.projects.filter(x => x.id !== projectId);

    if (state.activeProjectId === projectId) {
      state.activeProjectId = null;
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
    const t = getThreadByIdInScope(getActiveThreadId());
    const from = {
      scopeType: state.scope.type,
      projectId: state.scope.type === "project" ? state.scope.projectId : null,
      threadId: t?.id || null
    };

    const isImageContext = false; // v1: images are collected via explicit "画像を作成する" action below (placeholder)
    const reply = isImageContext
      ? `（画像生成）\n${userText}\n\n※ここは後で画像生成APIに接続します。`
      : `（AUREA）\n${userText}\n\n※ここは後で /api/chat に接続します。`;

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

        // If future: detect image replies. In v1 we only store when user uses "画像を作成する" action.
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
    // store immediately as placeholder (API will replace later)
    const t = getThreadByIdInScope(getActiveThreadId());
    const from = {
      scopeType: state.scope.type,
      projectId: state.scope.type === "project" ? state.scope.projectId : null,
      threadId: t?.id || null
    };

    addImageToLibrary({
      prompt,
      src: makePlaceholderImageDataUrl(prompt),
      from
    });

    // also write a short assistant message in current chat (optional)
    appendMessage("assistant", `（画像を保存しました）\n「画像」→保存ボックスに追加済み。\n\nPrompt:\n${prompt}`);
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
  // sidebar legacy search item -> focus input + open search
  btnSearchLegacy?.addEventListener("click", (e) => {
    e.preventDefault();
    sbSearchInput?.focus();
    if ((sbSearchInput?.value || "").trim()) {
      state.view = "search";
      save(state);
      renderView();
    }
  });

  btnNewChat?.addEventListener("click", (e) => {
    e.preventDefault();
    createThread();
  });

  btnImages?.addEventListener("click", (e) => {
    e.preventDefault();
    // open images view (aggregated)
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

  linkSettings?.addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = "/settings.html";
  });

  linkLogout?.addEventListener("click", async (e) => {
    e.preventDefault();
    const ok1 = await confirmModal("ログアウトしますか？");
    if (!ok1) return;
    window.location.href = "/login.html";
  });

  // settings modal close button
  const settingsClose = $(".settings-modal .hd button[aria-label='閉じる']");
  settingsClose?.addEventListener("click", (e) => {
    e.preventDefault();
    closeSettingsModal();
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

  // plus menu items
  $$(".plus-pop a[role='menuitem']").forEach((a) => {
    const label = a.getAttribute("aria-label") || "";
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      closeDetails(plusDetails);

      if (label === "写真とファイルを追加") {
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

      if (label === "画像を作成する") {
        // v1: create placeholder image and store to library
        const prompt = (askInput?.value || "").trim() || "（未入力）";
        // ensure thread exists
        if (!getActiveThreadId()) createThread();
        await createImageFromPrompt(prompt);
        // open images view after creation
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
      // Enter = send, Shift+Enter = newline
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
  }

  sendBtn?.addEventListener("click", (e) => { e.preventDefault(); send(); });
  stopBtn?.addEventListener("click", (e) => { e.preventDefault(); stopStreaming(); });

  // mic/voice placeholders
  micBtn?.addEventListener("click", (e) => { e.preventDefault(); });
  voiceBtn?.addEventListener("click", (e) => { e.preventDefault(); });

  /* ================= global close rules ================= */
  document.addEventListener("pointerdown", (e) => {
    const t = e.target;

    if (userDetails?.hasAttribute("open") && !isInside(userDetails, t)) closeDetails(userDetails);
    if (plusDetails?.hasAttribute("open") && !isInside(plusDetails, t)) closeDetails(plusDetails);
    $$(".sb-more[open]").forEach(d => { if (!isInside(d, t)) closeDetails(d); });

    // settings backdrop close
    if (body.classList.contains("settings-open") && settingsModal) {
      const card = $(".settings-modal .settings");
      if (isInside(settingsModal, t) && !isInside(card, t)) closeSettingsModal();
    }

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

    if (body.classList.contains("project-open")) { closeProjectModal(); return; }
    if (body.classList.contains("settings-open")) { closeSettingsModal(); return; }
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

    // PJ内: + PJ名：新しいチャット
    const pjNew = t.closest(".pj-newchat[data-action='pj-newchat']");
    if (pjNew) {
      e.preventDefault();
      const pid = pjNew.dataset.projectId;
      if (!pid) return;

      state.activeProjectId = pid;
      state.scope = { type: "project", projectId: pid };

      createThread(); // scope が project の状態で作る => PJ内スレッドに入る
      return;
    }

    // PJ内: 履歴クリック
    const pjOpen = t.closest(".pj-thread[data-action='pj-open-thread']");
    if (pjOpen) {
      e.preventDefault();
      const pid = pjOpen.dataset.projectId;
      const tid = pjOpen.dataset.threadId;
      if (!pid || !tid) return;

      state.activeProjectId = pid;
      state.scope = { type: "project", projectId: pid };
      save(state);

      selectThread(tid);
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

      // ignore dots click
      if (t.closest(".sb-more") || t.classList.contains("sb-dots")) return;

      e.preventDefault();
      selectProjectScope(id);
      return;
    }

    // thread row click / menu（チャットグループ側は global 用として使う想定）
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

      // chatグループは global 扱いに戻す（PJとはリンクしない）
      e.preventDefault();
      state.scope = { type: "global" };
      save(state);
      selectThread(id);
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
  // normalize plan
  if (!state.plan) state.plan = "Free";

  // normalize scope
  if (!state.scope || (state.scope.type !== "global" && state.scope.type !== "project")) {
    state.scope = { type: "global" };
  }

  // ensure threads containers
  if (!state.threads) state.threads = { global: [], projects: {} };
  if (!state.threads.global) state.threads.global = [];
  if (!state.threads.projects) state.threads.projects = {};
  if (!state.projects) state.projects = [];
  if (!state.images) state.images = [];

  ensureActiveThread();

  // mount search input (top)
  mountSidebarSearch();

  // render
  renderSidebar();
  renderView();

  // centered ask (no thread selected / no messages)
  setHasChat(false);

  // ask init
  autosizeTextarea();
  updateSendButtonVisibility();

  // (optional) if user clicks brand rail etc, do nothing
})();
