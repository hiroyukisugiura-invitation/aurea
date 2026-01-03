/* public/assets/js/setting.js (AUREA v1)
  - Settings UI is injected as a popup (GPT-like: left nav + right content)
  - Keep existing layout.css, apply styles only when .settings--gpt is used
*/

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const SETTINGS_HTML = `
    <div class="settings-modal" aria-hidden="true">
      <div class="settings settings--gpt" role="dialog" aria-label="設定">
        <div class="hd">
          <div class="ttl">設定</div>
          <button type="button" aria-label="閉じる">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6L6 18"></path><path d="M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <div class="settings-shell">
          <aside class="settings-nav" aria-label="設定ナビ">
            <button class="snav-item is-active" type="button" data-page="general">
              <span class="snav-ic">⚙︎</span>
              <span class="snav-txt">一般</span>
            </button>
            <button class="snav-item" type="button" data-page="apps">
              <span class="snav-ic">◻︎</span>
              <span class="snav-txt">アプリ</span>
            </button>
            <button class="snav-item" type="button" data-page="data">
              <span class="snav-ic">⛁</span>
              <span class="snav-txt">データ</span>
            </button>
            <button class="snav-item" type="button" data-page="trainer">
              <span class="snav-ic">✦</span>
              <span class="snav-txt">AUREA Data Trainer</span>
            </button>
            <button class="snav-item" type="button" data-page="account">
              <span class="snav-ic">👤</span>
              <span class="snav-txt">アカウント・セキュリティ</span>
            </button>
          </aside>

          <main class="settings-main">
            <!-- GENERAL -->
            <section class="spage is-active" data-page="general">
              <div class="spage-h">
                <div class="spage-ttl">一般</div>
                <div class="spage-sub">端末の基本的な設定</div>
              </div>

              <div class="sform">
                <div class="srow">
                  <div class="srow-l">
                    <div class="srow-ttl">テーマ</div>
                  </div>
                  <div class="srow-r">
                    <select class="sselect" aria-label="テーマ">
                      <option value="dark" selected>ダーク</option>
                      <option value="light">ライト</option>
                    </select>
                  </div>
                </div>

                <div class="srow">
                  <div class="srow-l">
                    <div class="srow-ttl">言語</div>
                  </div>
                  <div class="srow-r">
                    <select class="sselect" aria-label="言語">
                      <option value="ja" selected>日本語</option>
                      <option value="en">English</option>
                    </select>
                  </div>
                </div>

                <div class="srow">
                  <div class="srow-l">
                    <div class="srow-ttl">AUREAへの送信方法</div>
                  </div>
                  <div class="srow-r">
                    <select class="sselect" aria-label="送信方法">
                      <option value="cmdenter" selected>⌘ + Enterで送信（Enterは改行）</option>
                      <option value="enter">Enterで送信</option>
                    </select>
                  </div>
                </div>
              </div>
            </section>

            <!-- APPS -->
            <section class="spage" data-page="apps">
              <div class="spage-h">
                <div class="spage-ttl">アプリ</div>
                <div class="spage-sub">接続アプリの管理</div>
              </div>
              <div class="splaceholder">（ここは後で実装）</div>
            </section>

            <!-- DATA -->
            <section class="spage" data-page="data">
              <div class="spage-h">
                <div class="spage-ttl">データ</div>
                <div class="spage-sub">データ管理</div>
              </div>
              <div class="splaceholder">（ここは後で実装）</div>
            </section>

            <!-- TRAINER -->
            <section class="spage" data-page="trainer">
              <div class="spage-h">
                <div class="spage-ttl">AUREA Data Trainer</div>
                <div class="spage-sub">学習・改善用</div>
              </div>
              <div class="splaceholder">（ここは後で実装）</div>
            </section>

            <!-- ACCOUNT -->
            <section class="spage" data-page="account">
              <div class="spage-h">
                <div class="spage-ttl">アカウント・セキュリティ</div>
                <div class="spage-sub">アカウント情報とセキュリティ</div>
              </div>

              <!-- AI Stack（既存の見た目と共存できるよう、table__row/grid を踏襲） -->
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
                  <div class="table__body" id="aiStackInlineBody"></div>
                </div>
              </div>
            </section>

          </main>
        </div>
      </div>
    </div>
  `;

  const bindNav = (modal) => {
    const navItems = $$(".snav-item", modal);
    const pages = $$(".spage", modal);

    const activate = (pageId) => {
      navItems.forEach((b) => b.classList.toggle("is-active", b.dataset.page === pageId));
      pages.forEach((p) => p.classList.toggle("is-active", p.dataset.page === pageId));
    };

    navItems.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        activate(btn.dataset.page);
      });
    });
  };

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

    bindNav(modal);
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
