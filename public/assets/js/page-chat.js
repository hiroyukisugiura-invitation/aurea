(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  const chatRoot = $(".view-chat .chat");
  const input = $(".ask textarea.in");
  const sendBtn = $('.ask [data-action="send"]');
  const stopBtn = $('.ask [data-action="stop"]');
  const addFileBtn = $('.plus-pop [data-action="add-file"]');
  const imagesGrid = $("#imagesGrid");

  if (!chatRoot || !input || !sendBtn) {
    console.log("[page-chat] init aborted", {
      chatRoot: !!chatRoot,
      input: !!input,
      sendBtn: !!sendBtn
    });
    return;
  }

  console.log("[page-chat] init ok");

  let pendingAttachments = [];
  let busy = false;
  let aborter = null;

  const LS_IMAGES = "aurea_saved_images_v1";

  const loadSavedImages = () => {
    try {
      const a = JSON.parse(localStorage.getItem(LS_IMAGES) || "[]");
      return Array.isArray(a) ? a : [];
    } catch { return []; }
  };

  const saveImageToLibrary = (img) => {
    if (!img || !img.url) return;
    const list = loadSavedImages();
    list.unshift({
      url: String(img.url),
      prompt: String(img.prompt || ""),
      ts: Date.now()
    });
    const out = list.slice(0, 200);
    try { localStorage.setItem(LS_IMAGES, JSON.stringify(out)); } catch {}
  };

  const renderLibrary = () => {
    if (!imagesGrid) return;
    const list = loadSavedImages();
    imagesGrid.innerHTML = "";

    for (const it of list) {
      const card = document.createElement("div");
      card.className = "img-card";
      card.style.cssText =
        "border:1px solid rgba(255,255,255,.10);border-radius:16px;overflow:hidden;background:rgba(255,255,255,.02)";

      const img = document.createElement("img");
      img.src = it.url;
      img.alt = it.prompt || "AUREA image";
      img.style.cssText = "display:block;width:100%;height:auto";

      const meta = document.createElement("div");
      meta.style.cssText = "padding:10px 12px;color:rgba(255,255,255,.72);font-size:12px;line-height:1.5";
      meta.textContent = it.prompt || "";

      card.appendChild(img);
      card.appendChild(meta);
      imagesGrid.appendChild(card);
    }
  };

  const escapeHtml = (s) => String(s || "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

  const ensureMsgs = () => {
    if (!chatRoot.querySelector(".msgs")) {
      const msgs = document.createElement("div");
      msgs.className = "msgs";
      chatRoot.innerHTML = "";
      chatRoot.appendChild(msgs);
    }
    return chatRoot.querySelector(".msgs");
  };

  const appendMsg = ({ role, title, html }) => {
    const msgs = ensureMsgs();

    const wrap = document.createElement("div");
    wrap.className = "msg" + (role === "user" ? " user" : "");

    const head = document.createElement("div");
    head.className = "msg-head";

    const rr = document.createElement("div");
    rr.className = "msg-role";
    rr.textContent = title || (role === "user" ? "You" : "AUREA");

    const actions = document.createElement("div");
    actions.className = "msg-actions";

    head.appendChild(rr);
    head.appendChild(actions);

    const body = document.createElement("div");
    body.className = "msg-body";
    body.innerHTML = html || "";

    wrap.appendChild(head);
    wrap.appendChild(body);

    msgs.appendChild(wrap);
    chatRoot.scrollTop = chatRoot.scrollHeight;
    return wrap;
  };

  const setBusy = (v) => {
    busy = !!v;
    try { sendBtn.disabled = busy; } catch {}
    if (stopBtn) stopBtn.style.display = busy ? "" : "none";
  };

  const fileToB64 = (file) => new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => {
      const res = String(r.result || "");
      const idx = res.indexOf("base64,");
      resolve(idx >= 0 ? res.slice(idx + 7) : "");
    };
    r.onerror = () => resolve("");
    r.readAsDataURL(file);
  });

  const detectRoute = (file) => {
    const name = String(file?.name || "").toLowerCase();
    const mime = String(file?.type || "").toLowerCase();

    if (mime.startsWith("image/")) return "image";
    if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
    if (mime === "text/csv" || name.endsWith(".csv")) return "text";
    if (mime.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".html") || name.endsWith(".htm")) return "text";
    return "file";
  };

  const pushFiles = async (files) => {
    const arr = Array.from(files || []);
    for (const f0 of arr) {
      // Safari/Clipboard で name/type が空のケースを正規化
      const name = String(f0 && f0.name ? f0.name : "").trim() || `screenshot_${Date.now()}.png`;
      const mime = String(f0 && f0.type ? f0.type : "").trim() || "image/png";
      const size = Number(f0 && f0.size ? f0.size : 0) || 0;

      const f = (f0 && (f0.name || f0.type))
        ? f0
        : new File([f0], name, { type: mime });

      const b64 = await fileToB64(f);
      if (!b64) {
        console.log("[page-chat] skip empty b64", { name, mime, size });
        continue;
      }

      const route = detectRoute({ name, type: mime });
      const type = (route === "image") ? "image" : "file";

      pendingAttachments.push({
        type,
        route,
        name,
        mime,
        size,
        data: b64
      });
    }
  };

  const stop = () => {
    try { if (aborter) aborter.abort(); } catch {}
    aborter = null;
    setBusy(false);
  };

  const send = async ({ autoFromDrop = false } = {}) => {
    if (busy) return;

    const text = String(input.value || "").trim();
    const hasAttach = pendingAttachments.length > 0;

    if (!text && !hasAttach) return;

    // ドロップのみ送信：Askに残さない
    if (autoFromDrop && !text) input.value = "";

    appendMsg({
      role: "user",
      title: "You",
      html:
        `<div>${escapeHtml(text || "")}</div>` +
        (hasAttach ? `<div style="margin-top:8px;opacity:.7;font-size:12px">(${pendingAttachments.length} attachments)</div>` : "")
    });

    setBusy(true);
    aborter = new AbortController();

    const a = appendMsg({
      role: "assistant",
      title: "AUREA",
      html: `<div style="opacity:.75">...</div>`
    });

    try {
      const payload = {
        prompt: text,
        attachments: pendingAttachments.slice(),
        context: {}
      };

      console.log("[page-chat] send payload", {
        promptLen: String(payload.prompt || "").length,
        attachments: Array.isArray(payload.attachments) ? payload.attachments.length : 0,
        attachmentTypes: Array.isArray(payload.attachments)
          ? payload.attachments.map(a => ({ type: a.type, route: a.route, mime: a.mime, name: a.name }))
          : []
      });

      pendingAttachments = [];

      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: aborter.signal
      });

      const j = await r.json().catch(() => null);

      if (!r.ok || !j || !j.ok) {
        a.querySelector(".msg-body").innerHTML = `<div>${escapeHtml((j && (j.reason || j.msg)) ? (j.reason || j.msg) : "failed")}</div>`;
        setBusy(false);
        return;
      }

      if (j.image && j.image.url) {
        const url = String(j.image.url);
        const pr = String((j.image.prompt || text) || "");

        a.querySelector(".msg-body").innerHTML =
          `<div style="font-weight:700;margin-bottom:8px">AUREA Image</div>` +
          `<div style="opacity:.75;margin-bottom:10px">${escapeHtml(pr)}</div>` +
          `<img src="${escapeHtml(url)}" alt="AUREA Image" style="max-width:100%;border-radius:14px;border:1px solid rgba(255,255,255,.10)" />`;

        saveImageToLibrary({ url, prompt: pr });
        renderLibrary();

        setBusy(false);
        return;
      }

      const result = j.result || {};
      const gpt = (result && typeof result.GPT === "string") ? result.GPT : "";
      a.querySelector(".msg-body").innerHTML = `<div>${escapeHtml(gpt).replaceAll("\n", "<br>")}</div>`;
      setBusy(false);

    } catch (e) {
      a.querySelector(".msg-body").innerHTML = `<div>${escapeHtml("aborted_or_failed")}</div>`;
      setBusy(false);
      void e;
    }
  };

  // send btn
  sendBtn.addEventListener("click", () => send());
  if (stopBtn) stopBtn.addEventListener("click", () => stop());

  // cmd/ctrl+enter send（既存sendModeは触らない）
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  });

  // add file menu
  if (addFileBtn) {
    addFileBtn.addEventListener("click", async (e) => {
      e.preventDefault();

      const inp = document.createElement("input");
      inp.type = "file";
      inp.multiple = true;
      inp.accept = ".png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.csv,.html,.htm";

      inp.addEventListener("change", async () => {
        await pushFiles(inp.files);
        const t = String(input.value || "").trim();
        if (!t) await send({ autoFromDrop: true });
      });

      inp.click();
    });
  }

  // ===== 重要：ドロップ範囲を「画面全体」にする（Ask以外に落としても反応） =====
  const onDropFiles = async (e) => {
    try {
      const dt = e.dataTransfer;
      if (!dt) return;

      const fileList = [];
      const f0 = dt.files ? Array.from(dt.files) : [];
      for (const f of f0) fileList.push(f);

      // Safari / 一部環境で dt.files が空でも items に入るケース対応
      const items = dt.items ? Array.from(dt.items) : [];
      if (fileList.length === 0 && items.length) {
        for (const it of items) {
          try {
            if (!it) continue;
            if (it.kind === "file") {
              const f = it.getAsFile ? it.getAsFile() : null;
              if (f) fileList.push(f);
            }
          } catch {}
        }
      }

      console.log("[page-chat] drop dt", {
        types: dt.types ? Array.from(dt.types) : [],
        files: f0.length,
        items: items.length,
        picked: fileList.length
      });

      if (!fileList.length) return;

      await pushFiles(fileList);

      const t = String(input.value || "").trim();
      if (!t) await send({ autoFromDrop: true });
    } catch (err) {
      console.log("[page-chat] drop error", err);
    }
  };

  document.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
  }, { passive: false, capture: true });

  document.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log("[page-chat] drop fired");
    await onDropFiles(e);
  }, { passive: false, capture: true });

  // 初期：ライブラリ描画
  renderLibrary();
})();
