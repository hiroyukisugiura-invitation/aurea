// =========================================================
// AUREA UI Shell
// - Menus / Modals
// - Lang (ja/en) switch (UI text only)
// =========================================================

const $ = (q, el = document) => el.querySelector(q);
const $$ = (q, el = document) => Array.from(el.querySelectorAll(q));

/** --------------------------
 *  i18n dictionary
 *  -------------------------- */
const I18N = {
  en: {
    "nav.new_chat": "New chat",
    "nav.search": "Search",
    "nav.chats": "Chats",
    "plan.personal": "Personal",

    "menu.account": "Account",
    "menu.settings": "Settings",
    "menu.help": "Help",
    "menu.regulations": "Regulations",
    "menu.contact": "Contact",
    "menu.logout": "Log out",

    "top.share": "Share",
    "top.copy_link": "Copy link",
    "top.rename": "Rename",
    "top.delete": "Delete",

    "thread.new_chat": "New chat",

    "hero.title": "How can I help?",
    "hero.sub": "AUREA is your calm, reliable companion. Ask anything. We’ll keep it simple.",
    "hero.explain.title": "Explain",
    "hero.explain.sub": "Break down a topic step-by-step",
    "hero.plan.title": "Plan",
    "hero.plan.sub": "Turn ideas into a practical checklist",
    "hero.write.title": "Write",
    "hero.write.sub": "Emails, docs, clean wording",
    "hero.decide.title": "Decide",
    "hero.decide.sub": "Pros/cons with a recommendation",

    "composer.placeholder": "Message AUREA…",
    "disclaimer": "AUREA can make mistakes. Verify important information. Your chats may be used to improve the service.",

    "search.title": "Search chats",
    "search.placeholder": "Type to search…",
    "search.empty": "No results yet.",

    "settings.title": "Settings",
    "settings.tab.general": "General",
    "settings.tab.appearance": "Appearance",
    "settings.tab.data": "Data controls",
    "settings.tab.privacy": "Privacy",
    "settings.tab.about": "About",

    "settings.language.title": "Language",
    "settings.language.sub": "UI language",

    "settings.account.title": "Account",
    "settings.account.sub": "Profile & plan",
    "settings.account.manage": "Manage",

    "settings.theme.title": "Theme",
    "settings.theme.sub": "Dark / Light",
    "settings.theme.dark": "Dark",
    "settings.theme.light": "Light",

    "settings.chat_appearance.title": "Chat appearance",
    "settings.chat_appearance.sub": "Message spacing & font",

    "common.open": "Open",

    "settings.export.title": "Export data",
    "settings.export.sub": "Download your information",
    "settings.export.btn": "Export",

    "settings.clear.title": "Clear all data",
    "settings.clear.sub": "Remove local chat history",
    "settings.clear.btn": "Clear",

    "settings.training.title": "Training",
    "settings.training.sub": "Allow using chats to improve",

    "settings.version.title": "Version",
    "settings.version.sub": "AUREA v0 UI scaffold",

    "settings.links.title": "Links",
    "settings.links.sub": "Help / Regulations / Contact",

    "toast.link_copied": "Link copied",
    "toast.copy_failed": "Copy failed",
    "toast.logged_out": "Logged out (UI only)",
    "toast.cleared": "Cleared (placeholder)",
    "toast.navigate": "Navigate: {page} (placeholder)",
  },

  ja: {
    "nav.new_chat": "新しいチャット",
    "nav.search": "検索",
    "nav.chats": "チャット",
    "plan.personal": "個人",

    "menu.account": "アカウント",
    "menu.settings": "設定",
    "menu.help": "ヘルプ",
    "menu.regulations": "規約・規定",
    "menu.contact": "お問い合わせ",
    "menu.logout": "ログアウト",

    "top.share": "共有",
    "top.copy_link": "リンクをコピー",
    "top.rename": "名前を変更",
    "top.delete": "削除",

    "thread.new_chat": "新しいチャット",

    "hero.title": "何をお手伝いしましょう？",
    "hero.sub": "AUREAは、落ち着いて信頼できる伴走者です。気軽に聞いてください。シンプルに進めます。",
    "hero.explain.title": "わかりやすく説明",
    "hero.explain.sub": "テーマを順番に、かみ砕いて解説します",
    "hero.plan.title": "プランを作る",
    "hero.plan.sub": "目標を実行できるチェックリストにします",
    "hero.write.title": "文章を整える",
    "hero.write.sub": "メールや資料を、きれいな文章にします",
    "hero.decide.title": "決める",
    "hero.decide.sub": "比較して、提案までまとめます",

    "composer.placeholder": "AUREAにメッセージ…",
    "disclaimer": "AUREAは間違えることがあります。重要な情報は確認してください。チャットは品質改善に使用される場合があります。",

    "search.title": "チャット検索",
    "search.placeholder": "検索ワードを入力…",
    "search.empty": "まだ結果はありません。",

    "settings.title": "設定",
    "settings.tab.general": "一般",
    "settings.tab.appearance": "表示",
    "settings.tab.data": "データ管理",
    "settings.tab.privacy": "プライバシー",
    "settings.tab.about": "情報",

    "settings.language.title": "言語",
    "settings.language.sub": "UIの表示言語",

    "settings.account.title": "アカウント",
    "settings.account.sub": "プロフィールとプラン",
    "settings.account.manage": "管理",

    "settings.theme.title": "テーマ",
    "settings.theme.sub": "ダーク / ライト",
    "settings.theme.dark": "ダーク",
    "settings.theme.light": "ライト",

    "settings.chat_appearance.title": "チャット表示",
    "settings.chat_appearance.sub": "余白とフォント",

    "common.open": "開く",

    "settings.export.title": "データを書き出し",
    "settings.export.sub": "あなたの情報をダウンロード",
    "settings.export.btn": "書き出す",

    "settings.clear.title": "すべて削除",
    "settings.clear.sub": "ローカルのチャット履歴を削除",
    "settings.clear.btn": "削除",

    "settings.training.title": "学習",
    "settings.training.sub": "品質改善のためにチャットを使用する",

    "settings.version.title": "バージョン",
    "settings.version.sub": "AUREA v0 UI スケルトン",

    "settings.links.title": "リンク",
    "settings.links.sub": "ヘルプ / 規約・規定 / お問い合わせ",

    "toast.link_copied": "リンクをコピーしました",
    "toast.copy_failed": "コピーに失敗しました",
    "toast.logged_out": "ログアウトしました（UIのみ）",
    "toast.cleared": "削除しました（仮）",
    "toast.navigate": "移動: {page}（仮）",
  },
};

function getLang() {
  const saved = localStorage.getItem("aurea_lang");
  return saved === "ja" ? "ja" : "en";
}

function setLang(lang) {
  localStorage.setItem("aurea_lang", lang);
  applyLang(lang);
}

function t(key, vars = {}) {
  const lang = getLang();
  const template = (I18N[lang] && I18N[lang][key]) || (I18N.en[key] || key);
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

function applyLang(lang) {
  // html lang attribute
  const html = document.documentElement;
  html.setAttribute("lang", lang === "ja" ? "ja" : "en");
  html.setAttribute("data-lang", lang);

  // text nodes
  $$("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    el.textContent = (I18N[lang] && I18N[lang][key]) || (I18N.en[key] || el.textContent);
  });

  // placeholders
  $$("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    el.setAttribute("placeholder", (I18N[lang] && I18N[lang][key]) || (I18N.en[key] || el.getAttribute("placeholder") || ""));
  });

  // select sync
  const sel = $("[data-lang-select]");
  if (sel) sel.value = lang;

  // expose translator for other files
  window.__AUREA_T = t;
  window.__AUREA_LANG = lang;
}

/** --------------------------
 *  UI shell (existing)
 *  -------------------------- */
const overlay = $("[data-overlay]");
const accountBtn = $("[data-account-btn]");
const accountMenu = $("[data-account-menu]");
const topMoreBtn = $("[data-top-more-btn]");
const topMenu = $("[data-top-menu]");
const plusBtn = $("[data-plus-btn]");
const plusMenu = $("[data-plus-menu]");
const openSearchBtn = $("[data-open-search]");
const searchModal = $("[data-search-modal]");
const settingsModal = $("[data-settings-modal]");
const openSettingsBtns = $$("[data-open-settings]");
const closeModalBtns = $$("[data-close-modal]");
const closeSettingsBtn = $("[data-close-settings]");
const sbToggleBtn = $("[data-sb-toggle]");
const sb = $("[data-sb]");

function showOverlay() {
  if (overlay) overlay.hidden = false;
}
function hideOverlay() {
  if (overlay) overlay.hidden = true;
}

function closeAllPopups() {
  [accountMenu, topMenu, plusMenu, searchModal, settingsModal].forEach((el) => el && (el.hidden = true));
  hideOverlay();
}

function toggleMenu(menuEl) {
  if (!menuEl) return;
  const isOpen = !menuEl.hidden;
  closeAllPopups();
  if (!isOpen) {
    menuEl.hidden = false;
    showOverlay();
  }
}

// overlay close
overlay?.addEventListener("click", closeAllPopups);

// sidebar collapse
sbToggleBtn?.addEventListener("click", () => {
  sb?.classList.toggle("is-collapsed");
});

// account menu
accountBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleMenu(accountMenu);
});

// top menu
topMoreBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleMenu(topMenu);
});

// plus menu
plusBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleMenu(plusMenu);
});

// search modal
openSearchBtn?.addEventListener("click", () => {
  closeAllPopups();
  if (searchModal) {
    searchModal.hidden = false;
    showOverlay();
    setTimeout(() => $("[data-search-input]")?.focus(), 50);
  }
});
closeModalBtns.forEach((b) => b.addEventListener("click", closeAllPopups));

// settings modal
openSettingsBtns.forEach((b) =>
  b.addEventListener("click", () => {
    closeAllPopups();
    if (settingsModal) {
      settingsModal.hidden = false;
      showOverlay();
    }
  })
);
closeSettingsBtn?.addEventListener("click", closeAllPopups);

// settings tabs
$$(".settings-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".settings-tab").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");

    const tab = btn.getAttribute("data-tab");
    $$(".settings-pane").forEach((p) => p.classList.remove("is-active"));
    $(`.settings-pane[data-pane="${tab}"]`)?.classList.add("is-active");
  });
});

// fake page navigation
$$("[data-open-page]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const page = btn.getAttribute("data-open-page");
    toast(t("toast.navigate", { page }));
    closeAllPopups();
  });
});

// actions
$("[data-copy-link]")?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    toast(t("toast.link_copied"));
  } catch {
    toast(t("toast.copy_failed"));
  } finally {
    closeAllPopups();
  }
});

$("[data-logout]")?.addEventListener("click", () => {
  toast(t("toast.logged_out"));
  closeAllPopups();
});

$("[data-clear-data]")?.addEventListener("click", () => {
  toast(t("toast.cleared"));
});

// prevent inside-click bubbling
[accountMenu, topMenu, plusMenu, searchModal, settingsModal].forEach((el) => {
  el?.addEventListener("click", (e) => e.stopPropagation());
});

// esc
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAllPopups();
});

// toast
function toast(msg) {
  const el = $("[data-toast]");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => (el.hidden = true), 1500);
}

// ✅ 初期ロード時は必ず閉じる（Settingsが勝手に開くのを完全封じ）
(function forceCloseOnLoad() {
  const close = () => {
    if (overlay) overlay.hidden = true;
    [searchModal, settingsModal, accountMenu, topMenu, plusMenu].forEach((el) => {
      if (el) el.hidden = true;
    });
  };
  close();
  window.addEventListener("pageshow", close);
})();

// Lang select handler
const langSelect = $("[data-lang-select]");
langSelect?.addEventListener("change", () => {
  const v = langSelect.value === "ja" ? "ja" : "en";
  setLang(v);
});

// init apply
applyLang(getLang());
