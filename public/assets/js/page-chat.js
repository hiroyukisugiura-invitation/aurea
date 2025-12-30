// Chat page behavior (messages / send / streaming-ish typing)

const $ = (q, el = document) => el.querySelector(q);
const $$ = (q, el = document) => Array.from(el.querySelectorAll(q));

const msgs = $('[data-msgs]');
const input = $('[data-input]');
const sendBtn = $('[data-send-btn]');
const hero = $('[data-hero]');
const chatInner = $('[data-chat-inner]');
const scrollDownBtn = $('[data-scroll-down]');
const threadTitle = $('[data-thread-title]');
const threadList = $('[data-thread-list]');

const T = (key, vars) => (typeof window.__AUREA_T === 'function' ? window.__AUREA_T(key, vars) : key);
const getLang = () => (window.__AUREA_LANG === 'ja' ? 'ja' : 'en');

const demoThreads = [
  { id: 't1', name_en: 'New chat', name_ja: '新しいチャット' },
  { id: 't2', name_en: 'AUREA roadmap', name_ja: 'AUREA ロードマップ' },
  { id: 't3', name_en: 'Enterprise proposal draft', name_ja: '企業提案ドラフト' },
  { id: 't4', name_en: 'UI review notes', name_ja: 'UIレビュー' },
];

let activeThread = 't1';

function threadName(t) {
  return getLang() === 'ja' ? t.name_ja : t.name_en;
}

function renderThreads() {
  threadList.innerHTML = demoThreads
    .map((t) => {
      const active = t.id === activeThread ? 'is-active' : '';
      return `
        <div class="thread ${active}" data-thread="${t.id}">
          <div class="tname">${escapeHtml(threadName(t))}</div>
          <div class="tdot">⋯</div>
        </div>
      `;
    })
    .join('');

  const t = demoThreads.find((x) => x.id === activeThread);
  threadTitle.textContent = threadName(t || demoThreads[0]);
}

function setActiveThread(id) {
  activeThread = id;
  renderThreads();
  clearMessages();
  hero.style.display = id === 't1' ? '' : 'none';
  if (id !== 't1') {
    addMsg('ai', getLang() === 'ja'
      ? `これは「${threadName(demoThreads.find(t=>t.id===id))}」です。（UIスケルトン）`
      : `This is "${threadName(demoThreads.find(t=>t.id===id))}". (UI scaffold)`
    );
  }
  scrollToBottom(true);
}

threadList.addEventListener('click', (e) => {
  const el = e.target.closest('[data-thread]');
  if (!el) return;
  setActiveThread(el.getAttribute('data-thread'));
});

$('[data-new-chat]')?.addEventListener('click', () => setActiveThread('t1'));

function clearMessages() {
  msgs.innerHTML = '';
}

function addMsg(role, content, { isCode = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role === 'user' ? 'user' : 'ai'}`;

  const roleLabel =
    role === 'user'
      ? (getLang() === 'ja' ? 'あなた' : 'You')
      : 'AUREA';

  const copyLabel = getLang() === 'ja' ? 'コピー' : 'Copy';

  wrap.innerHTML = `
    <div class="msg-head">
      <div class="msg-role">${roleLabel}</div>
      <div class="msg-actions">
        <button class="mini-btn" data-copy type="button">${copyLabel}</button>
      </div>
    </div>
    <div class="msg-body">${isCode ? `<pre><code>${escapeHtml(content)}</code></pre>` : formatText(content)}</div>
  `;

  wrap.querySelector('[data-copy]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(content);
      toast(getLang() === 'ja' ? 'コピーしました' : 'Copied');
    } catch {
      toast(getLang() === 'ja' ? 'コピーに失敗しました' : 'Copy failed');
    }
  });

  msgs.appendChild(wrap);
  return wrap;
}

function toast(msg) {
  const t = document.querySelector('[data-toast]');
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => (t.hidden = true), 1200);
}

function formatText(s) {
  const safe = escapeHtml(s);
  return safe.replace(/\n/g, '<br>');
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function autoGrow() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 180) + 'px';
}

input.addEventListener('input', () => {
  autoGrow();
  sendBtn.disabled = input.value.trim().length === 0;
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

sendBtn.addEventListener('click', handleSend);

$$('[data-suggest]').forEach((b) => {
  b.addEventListener('click', () => {
    input.value = b.getAttribute('data-suggest') || '';
    autoGrow();
    sendBtn.disabled = input.value.trim().length === 0;
    input.focus();
  });
});

function handleSend() {
  const text = input.value.trim();
  if (!text) return;

  hero.style.display = 'none';

  addMsg('user', text);
  input.value = '';
  autoGrow();
  sendBtn.disabled = true;

  scrollToBottom(true);
  streamAureaReply(text);
}

function scrollToBottom(force = false) {
  const el = chatInner;
  if (!el) return;
  if (force) {
    el.scrollTop = el.scrollHeight;
    return;
  }
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  if (atBottom) el.scrollTop = el.scrollHeight;
}

function streamAureaReply(userText) {
  const responseEn =
    `Okay. I’ve got you.\n` +
    `Here’s a clear next step:\n` +
    `• Define the goal in one sentence\n` +
    `• Choose the smallest action that moves it forward\n` +
    `\nIf you want, paste constraints (time/budget), and I’ll tighten it.`;

  const responseJa =
    `大丈夫。受け取ったよ。\n` +
    `まずは次の一手を明確にしよう：\n` +
    `・目標を1文で定義する\n` +
    `・前に進むための最小アクションを選ぶ\n` +
    `\n時間や予算など条件があれば貼って。もっと絞り込む。`;

  const response = getLang() === 'ja' ? responseJa : responseEn;

  const msgEl = addMsg('ai', '');
  const body = msgEl.querySelector('.msg-body');
  let i = 0;

  const timer = setInterval(() => {
    i += Math.max(1, Math.floor(response.length / 120));
    const chunk = response.slice(0, i);
    body.innerHTML = chunk.replace(/\n/g, '<br>');
    scrollToBottom();
    if (i >= response.length) clearInterval(timer);
  }, 30);
}

chatInner.addEventListener('scroll', () => {
  const atBottom = chatInner.scrollHeight - chatInner.scrollTop - chatInner.clientHeight < 120;
  scrollDownBtn.hidden = atBottom;
});
scrollDownBtn.addEventListener('click', () => scrollToBottom(true));

renderThreads();
setActiveThread('t1');

// 反映：言語切替後にタイトル/スレッド名も更新されるよう監視
window.addEventListener('storage', (e) => {
  if (e.key === 'aurea_lang') {
    renderThreads();
  }
});
