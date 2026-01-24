(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  const chatRoot = $(".view-chat .chat");
  const input = $(".ask textarea.in");
  const sendBtn = $('.ask [data-action="send"]');
  const stopBtn = $('.ask [data-action="stop"]');
  const addFileBtn = $('.plus-pop [data-action="add-file"]');
  const imagesGrid = $("#imagesGrid");

  if (!input || !sendBtn) {
    console.log("[page-chat] init aborted", {
      input: !!input,
      sendBtn: !!sendBtn
    });
    return;
  }

  console.log("[page-chat] init ok");

  let pendingAttachments = [];
  let busy = false;
  let aborter = null;

  const setBusy = (v) => {
    busy = !!v;
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

    if (autoFromDrop && !text) input.value = "";

    setBusy(true);
    aborter = new AbortController();

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

      await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: aborter.signal
      });
    } catch (e) {
      void e;
    } finally {
      setBusy(false);
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

})();