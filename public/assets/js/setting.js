/* public/assets/js/setting.js (AUREA v1)
  - Settings UI is injected as a popup (no static HTML in index.html)
  - Markup must match existing layout.css styles
*/

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  const SETTINGS_HTML = `
    <div class="settings-modal" aria-hidden="true">
      <div class="settings" role="dialog" aria-label="設定">
        <div class="hd">
          <div class="ttl">一般</div>
          <button type="button" aria-label="閉じる">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6L6 18"></path><path d="M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <div class="tabs" aria-label="設定大項目（縮小時はアイコンのみ）">
          <div class="tab" title="一般" aria-label="一般">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7z"></path>
            </svg>
          </div>

          <div class="tab" title="規約・規定" aria-label="規約・規定">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M7 3h10a2 2 0 0 1 2 2v16l-7-3-7 3V5a2 2 0 0 1 2-2z"></path>
            </svg>
          </div>

          <div class="tab" title="アカウント" aria-label="アカウント">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21a8 8 0 0 0-16 0"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
          </div>

          <div class="tab" title="プライバシー" aria-label="プライバシー">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22s8-4 8-10V6l-8-4-8 4v6c0 6 8 10 8 10z"></path>
            </svg>
          </div>
        </div>

        <div class="panels">
          <div class="panel is-active">
            <div class="section">
              <div class="section__title">規約・規定</div>

              <div class="setting-row">
                <div class="setting-row__left">
                  <div class="setting-row__title">規約・規定</div>
                  <div class="setting-row__desc">利用規約・ポリシーに関する情報</div>
                </div>
              </div>

              <!-- AI Stack（layout.css準拠：header + table__row/grid） -->
              <div class="ai-stack-inline">
                <div class="ai-stack-inline__header">
                  <div class="title">AI Stack</div>
                  <div class="desc">現在使用中の6大AI（自動追従）</div>
                </div>

                <div class="table" id="aiStackInlineTable">
                  <div class="table__head">
                    <div class="table__row table__row--head">
                      <div class="table__cell">AI</div>
                      <div class="table__cell">Model</div>
                      <div class="table__cell">Version</div>
                    </div>
                  </div>
                  <div class="table__body" id="aiStackInlineBody">
                    <!-- rows injected by JS (later) -->
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>

      </div>
    </div>
  `;

  const ensure = () => {
    let modal = $(".settings-modal");
    if (modal) return modal;

    const wrap = document.createElement("div");
    wrap.innerHTML = SETTINGS_HTML.trim();
    modal = wrap.firstElementChild;
    document.body.appendChild(modal);

    // close button
    const closeBtn = $(".hd button[aria-label='閉じる']", modal);
    closeBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      close();
    });

    // click outside
    modal.addEventListener("mousedown", (e) => {
      const panel = $(".settings", modal);
      if (!panel) return;
      if (!panel.contains(e.target)) close();
    });

    // esc
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (modal.getAttribute("aria-hidden") === "false") close();
      }
    });

    return modal;
  };

  const open = () => {
    const modal = ensure();
    document.body.classList.add("settings-open");
    modal.setAttribute("aria-hidden", "false");
  };

  const close = () => {
    const modal = $(".settings-modal");
    if (!modal) return;
    document.body.classList.remove("settings-open");
    modal.setAttribute("aria-hidden", "true");
  };

  window.AureaSettingsPopup = { ensure, open, close };
})();
