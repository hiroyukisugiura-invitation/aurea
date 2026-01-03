/* public/assets/js/setting.js
  - Render settings.html in Shadow DOM (isolated styles)
  - Bind interactive behaviors here (because scripts in injected HTML don't run)
*/

(() => {
  const HOST_SEL = ".settings-modal";

  const getHost = () => document.querySelector(HOST_SEL);

  const ensureHost = () => {
    let host = getHost();
    if (host) return host;

    host = document.createElement("div");
    host.className = "settings-modal";
    host.setAttribute("aria-hidden", "true");

    Object.assign(host.style, {
      position: "fixed",
      inset: "0",
      zIndex: "9999",
      display: "none",

      // ★ open時に display:flex になるので、中央寄せの指定はここで持たせる
      alignItems: "center",
      justifyContent: "center"
    });

    document.body.appendChild(host);
    return host;
  };

  const initProfileAutosave = (root) => {
    const KEY_NAME = "aurea_profile_displayName";
    const KEY_USER = "aurea_profile_userName";

    const nameEl = root.querySelector("#displayName");
    const userEl = root.querySelector("#userName");
    if (!nameEl || !userEl) return;

    const savedName = localStorage.getItem(KEY_NAME);
    const savedUser = localStorage.getItem(KEY_USER);
    if (savedName !== null) nameEl.value = savedName;
    if (savedUser !== null) userEl.value = savedUser;

    let t = null;
    const save = () => {
      localStorage.setItem(KEY_NAME, nameEl.value);
      localStorage.setItem(KEY_USER, userEl.value);
    };
    const queueSave = () => {
      clearTimeout(t);
      t = setTimeout(save, 300);
    };

    nameEl.addEventListener("input", queueSave);
    userEl.addEventListener("input", queueSave);
    nameEl.addEventListener("change", save);
    userEl.addEventListener("change", save);
  };

  const initAiStackPopup = (root) => {
    const openBtn = root.querySelector("#btnOpenAiStackPopup");
    const closeBtn = root.querySelector("#btnCloseAiStackPopup");
    const overlay = root.querySelector("#aiStackOverlay");
    const body = root.querySelector("#aiStackPopupBody");
    if (!openBtn || !closeBtn || !overlay || !body) return;

    const AI_STACK = [
      { name: "GPT", ver: "" },
      { name: "Claude", ver: "" },
      { name: "Gemini", ver: "" },
      { name: "Perplexity", ver: "" },
      { name: "Mistral", ver: "" },
      { name: "Sora", ver: "" }
    ];

    const escapeHtml = (s) =>
      String(s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");

    const render = () => {
      body.innerHTML = "";
      for (const a of AI_STACK) {
        const row = document.createElement("div");
        row.className = "table__row";
        row.innerHTML = `
          <div class="table__cell">${escapeHtml(a.name)}</div>
          <div class="table__cell">${escapeHtml(a.ver)}</div>
        `;
        body.appendChild(row);
      }
    };

    render();

    openBtn.addEventListener("click", () => {
      overlay.style.display = "flex";
    });

    closeBtn.addEventListener("click", () => {
      overlay.style.display = "none";
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.style.display = "none";
    });
  };

  const initSaasToggle = (root) => {
    const btns = Array.from(root.querySelectorAll(".status-btn"));
    if (!btns.length) return;

    btns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const isOn = btn.classList.contains("on");
        btn.classList.toggle("on", !isOn);
        btn.classList.toggle("off", isOn);
        btn.textContent = isOn ? "未接続" : "接続";
      });
    });
  };

    const initGeneralSettings = (root) => {
    const KEY_THEME = "aurea_theme";
    const KEY_LANG = "aurea_lang";
    const KEY_SEND = "aurea_send_mode"; // "cmdEnter" | "enter"

    const selTheme = root.querySelector('select[aria-label="テーマ"]');
    const selLang  = root.querySelector('select[aria-label="言語"]');
    const selSend  = root.querySelector('select[aria-label="AUREAへの送信方法"]');

    // ---- load saved ----
    const savedTheme = localStorage.getItem(KEY_THEME);
    const savedLang  = localStorage.getItem(KEY_LANG);
    const savedSend  = localStorage.getItem(KEY_SEND);

    if (selTheme && savedTheme) {
      Array.from(selTheme.options).forEach(o => { if (o.textContent === savedTheme) o.selected = true; });
    }
    if (selLang && savedLang) {
      Array.from(selLang.options).forEach(o => { if (o.textContent === savedLang) o.selected = true; });
    }
    if (selSend && savedSend) {
      const want = (savedSend === "enter")
        ? "Enterで送信（Shift + Enterで改行）"
        : "⌘ + Enterで送信（Enterは改行）";
      Array.from(selSend.options).forEach(o => { if (o.textContent === want) o.selected = true; });
    }

    // ---- apply theme to main UI (最小：data-theme付与) ----
    const applyTheme = (val) => {
      // val: "システム" | "ライト" | "ダーク"
      document.documentElement.setAttribute("data-theme", val);
    };

    // 初期適用（保存があれば）
    if (savedTheme) applyTheme(savedTheme);

    // ---- bind ----
    selTheme?.addEventListener("change", () => {
      const v = selTheme.value;
      localStorage.setItem(KEY_THEME, v);
      applyTheme(v);
    });

    selLang?.addEventListener("change", () => {
      const v = selLang.value;
      localStorage.setItem(KEY_LANG, v);
      // v1：言語は保存のみ（本体UI翻訳は別実装フェーズ）
    });

    selSend?.addEventListener("change", () => {
      const v = selSend.value;
      const mode = v.includes("Enterで送信") ? "enter" : "cmdEnter";
      localStorage.setItem(KEY_SEND, mode);
      // layout.js 側がこの値を見て送信キーを変える
    });
  };

  const ensureShadow = async () => {
    const host = ensureHost();
    if (host.shadowRoot && host.shadowRoot.childNodes.length) return host;

    const res = await fetch("/settings.html", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load settings.html: ${res.status}`);
    const htmlText = await res.text();

    const doc = new DOMParser().parseFromString(htmlText, "text/html");

    let headStyles = Array.from(doc.querySelectorAll("style"))
      .map((s) => s.textContent || "")
      .join("\n");

    // ★ Shadow DOM内では settings.html の :root CSS変数が効かず崩れるので :host に寄せる
    headStyles = headStyles.replace(/:root\b/g, ":host");

    // ★ Shadow内の最低限ベース（変数が効く前提を崩さない）
    headStyles = `
      :host{ all: initial; }
      :host, :host *{ box-sizing: border-box; }
      :host{
        font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Hiragino Sans","Noto Sans JP",sans-serif;
        color:rgba(255,255,255,.92);
      }
    ` + headStyles;

    const links = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))
      .map((l) => l.getAttribute("href"))
      .filter(Boolean);

    // settings.html 内の body をそのまま入れる（scriptsは実行されないので、ここで再バインドする）
    const bodyHtml = doc.body ? doc.body.innerHTML : htmlText;

    const shadow = host.attachShadow({ mode: "open" });

    const linkTags = links.map((href) => `<link rel="stylesheet" href="${href}">`).join("\n");

    shadow.innerHTML = `
      ${linkTags}
      <style>${headStyles}</style>
      ${bodyHtml}
    `;

    // close button
    const closeBtn =
      shadow.querySelector("[data-settings-close]") ||
      shadow.querySelector(".close") ||
      shadow.querySelector('[aria-label="閉じる"]');

    closeBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      window.AureaSettingsPopup.close();
    });

    // overlay click (settings.html has .overlay)
    const overlay = shadow.querySelector(".overlay");
    overlay?.addEventListener("click", (e) => {
      if (e.target === overlay) window.AureaSettingsPopup.close();
    });

    // bind missing behaviors (because scripts inside injected HTML won't run)
    initProfileAutosave(shadow);
    initAiStackPopup(shadow);
    initSaasToggle(shadow);
    initGeneralSettings(shadow);

    return host;
  };

  const open = async () => {
    const host = await ensureShadow();
    host.style.display = "flex";
    host.setAttribute("aria-hidden", "false");
    document.body.classList.add("settings-open");
  };

  const close = () => {
    const host = getHost();
    if (!host) return;
    host.setAttribute("aria-hidden", "true");
    host.style.display = "none";
    document.body.classList.remove("settings-open");
  };

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const host = getHost();
    if (!host) return;
    if (host.getAttribute("aria-hidden") === "false") close();
  });

  window.AureaSettingsPopup = { open, close };
})();
