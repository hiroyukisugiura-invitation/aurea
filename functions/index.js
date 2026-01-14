const { onRequest } = require("firebase-functions/v2/https");
const express = require("express");
const admin = require("firebase-admin");
const Stripe = require("stripe");
const { defineSecret } = require("firebase-functions/params");

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_PRICE_PRO = defineSecret("STRIPE_PRICE_PRO");
const STRIPE_PRICE_TEAM = defineSecret("STRIPE_PRICE_TEAM");
const STRIPE_PRICE_ENTERPRISE = defineSecret("STRIPE_PRICE_ENTERPRISE");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");

// Secret が無い状態で Stripe を初期化しない（解析落ち防止）
const getStripe = () => {
  const key = String(STRIPE_SECRET_KEY.value() || "").trim();
  if (!key) return null;
  return new Stripe(key);
};

const app = express();

// ===== Stripe Webhook（raw専用ルーター）=====
const stripeWebhook = express.Router();

// raw を最優先で適用（これが超重要）
stripeWebhook.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const stripe = getStripe();
    if (!stripe) {
      res.status(500).send("stripe_key_missing");
      return;
    }

    const sig = req.headers["stripe-signature"];
    const endpointSecret = String(STRIPE_WEBHOOK_SECRET.value() || "").trim();

    let event;
    try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
  } catch (err) {
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

    try {
      // 監査ログ
      await db.collection("stripe_events").doc(event.id).set({
        type: event.type,
        created: event.created,
        livemode: event.livemode,
        data: event.data.object,
        receivedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // プラン反映
      if (event.type === "checkout.session.completed") {
        const session = event.data.object || {};
        const md = session.metadata || {};
        const plan = String(md.plan || "").trim();
        let uid = String(md.uid || "").trim();

        const email =
          String((session.customer_details || {}).email || "").trim() ||
          String(session.customer_email || "").trim();

        if ((!uid || uid === "<UID>") && email) {
          const u = await admin.auth().getUserByEmail(email);
          uid = u.uid;
        }

        if (uid && plan) {
          await db.collection("users").doc(uid).set(
            {
              plan,
              stripeCustomerId: String(session.customer || ""),
              stripeSubscriptionId: String(session.subscription || ""),
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            },
            { merge: true }
          );
        }
      }

      res.json({ received: true });
    } catch (e) {
      res.status(500).send("webhook_handler_failed");
    }
  }
);

// ★ これを必ず app に mount
app.use(stripeWebhook);

// ===== それ以外の API は JSON =====
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

try { admin.initializeApp(); } catch (e) { void e; }
const db = admin.firestore();

/* ================= Google OAuth (v1: redirect only) =================
  必要な環境変数:
  - GOOGLE_OAUTH_CLIENT_ID
  - GOOGLE_OAUTH_REDIRECT_URI   (例: https://aurea-2026.web.app/api/google/callback)
  ※ client_secret は callback で token 交換する次フェーズで使用
*/

const mustEnv = (key) => {
  const v = String(process.env[key] || "").trim();
  return v ? v : null;
};

const buildGoogleAuthUrl = ({ scope, state }) => {
  const clientId = mustEnv("GOOGLE_OAUTH_CLIENT_ID");
  const redirectUri = mustEnv("GOOGLE_OAUTH_REDIRECT_URI");

  if (!clientId || !redirectUri) return null;

  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", scope);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  if (state) u.searchParams.set("state", state);

  return u.toString();
};

const toB64Url = (s) => {
  try { return Buffer.from(String(s || ""), "utf8").toString("base64url"); } catch { return ""; }
};
const fromB64Url = (s) => {
  try { return Buffer.from(String(s || ""), "base64url").toString("utf8"); } catch { return ""; }
};

const connectGoogle = (service) => (req, res) => {
  const baseScopes = ["openid", "email", "profile"];

  const svcScopes =
    service === "gmail"
      ? ["https://www.googleapis.com/auth/gmail.readonly"]
      : service === "drive"
        ? ["https://www.googleapis.com/auth/drive.readonly"]
        : [];

  // UI から ?returnTo=<origin/> を受け取る（Codespaces / 本番両対応）
  const returnTo = String(req.query.returnTo || "").trim();
  const rt = returnTo ? toB64Url(returnTo) : "";

  const scope = [...baseScopes, ...svcScopes].join(" ");
  const url = buildGoogleAuthUrl({
    scope,
    state: `svc=${service}${rt ? `|rt=${rt}` : ""}`
  });

  if (!url) {
    res.status(200).send(`Google OAuth env missing. svc=${service}`);
    return;
  }

  res.redirect(302, url);
};

const oauthCallback = (req, res) => {
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  const err = String(req.query.error || "");

  // state から rt を取り出す
  let rt = "";
  try {
    const parts = state.split("|").map(s => s.trim()).filter(Boolean);
    for (const p of parts) {
      if (p.startsWith("rt=")) rt = p.slice(3);
    }
  } catch (e) {
    // ignore malformed state
    void e;
  }

  const origin = rt ? fromB64Url(rt) : "";
  const base = origin ? `${origin.replace(/\/+$/, "")}/` : "/";

  if (err) {
    res.redirect(302, `${base}?connect=error&error=${encodeURIComponent(err)}&state=${encodeURIComponent(state)}`);
    return;
  }

  res.redirect(302, `${base}?connect=ok&state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`);
};

/* ================= Company Invite Consume (AUREA) =================
  Firestore 想定:
  - company_invites/{token}
      { email, companyId, expiresAt, usedAt, usedByUid, usedByEmail }
  - companies/{companyId}
      { allowedDomains: ["invitation.co", ...] }  // 任意（無ければ invite email ドメインのみ許可）
*/
const getEmailDomain = (email) => {
  const s = String(email || "").trim().toLowerCase();
  const i = s.lastIndexOf("@");
  return (i >= 0) ? s.slice(i + 1) : "";
};

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const consumeInvite = async (req, res) => {
  const token = String(req.body?.token || "").trim();
  const email = normalizeEmail(req.body?.email || "");
  const uid = String(req.body?.uid || "").trim();

  if (!token || !email || !uid) {
    res.status(400).json({ ok: false, error: "missing_params" });
    return;
  }

  const ref = db.collection("company_invites").doc(token);

  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { ok: false, status: 400, reason: "invite_invalid" };

      const inv = snap.data() || {};
      const invitedEmail = normalizeEmail(inv.email || "");
      const companyId = String(inv.companyId || "").trim();

      // 招待メール一致（転送・なりすまし防止）
      if (!invitedEmail || invitedEmail !== email) {
        return { ok: false, status: 400, reason: "invite_invalid" };
      }

      // 期限チェック
      const now = admin.firestore.Timestamp.now();
      const expiresAt = inv.expiresAt;
      if (!expiresAt || expiresAt.toMillis == null) {
        return { ok: false, status: 400, reason: "invite_invalid" };
      }
      if (expiresAt.toMillis() < now.toMillis()) {
        return { ok: false, status: 410, reason: "invite_expired" };
      }

      // 使用済み
      if (inv.usedAt) {
        return { ok: false, status: 409, reason: "invite_used" };
      }

      // ドメイン制限（companies/{companyId}.allowedDomains があれば優先）
      const invitedDomain = getEmailDomain(email);
      if (!invitedDomain) {
        return { ok: false, status: 400, reason: "invite_invalid" };
      }

      if (companyId) {
        const cRef = db.collection("companies").doc(companyId);
        const cSnap = await tx.get(cRef);
        if (cSnap.exists) {
          const c = cSnap.data() || {};
          const allowed = Array.isArray(c.allowedDomains) ? c.allowedDomains.map(x => String(x || "").toLowerCase()) : null;
          if (allowed && allowed.length > 0) {
            if (!allowed.includes(invitedDomain)) {
              return { ok: false, status: 403, reason: "domain_not_allowed" };
            }
          } else {
            // allowedDomains 無いなら「招待メールのドメインのみ許可」
            const invitedEmailDomain = getEmailDomain(invitedEmail);
            if (invitedEmailDomain && invitedEmailDomain !== invitedDomain) {
              return { ok: false, status: 403, reason: "domain_not_allowed" };
            }
          }
        }
      }

      // 消費（原子的に used を立てる）
      tx.update(ref, {
        usedAt: now,
        usedByUid: uid,
        usedByEmail: email
      });

      return { ok: true, status: 200 };
    });

    if (!result.ok) {
      res.status(result.status).json({ ok: false, reason: result.reason });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, reason: "invite_invalid" });
    void e;
  }
};

/* ================= Billing (Stripe) ================= */
app.post("/api/billing/checkout", async (req, res) => {
  const stripe = getStripe();
  if (!stripe) {
    res.status(500).json({ ok: false, reason: "stripe_key_missing" });
    return;
  }

  try {
    const { plan, uid, email, successUrl, cancelUrl } = req.body || {};
    if (!plan || !uid || !email) {
      res.status(400).json({ ok: false, reason: "missing_params" });
      return;
    }

    const priceMap = {
      Pro: String(STRIPE_PRICE_PRO.value() || "").trim(),
      Team: String(STRIPE_PRICE_TEAM.value() || "").trim(),
      Enterprise: String(STRIPE_PRICE_ENTERPRISE.value() || "").trim()
    };

    const price = priceMap[plan];
    if (!price) {
      res.status(400).json({ ok: false, reason: "invalid_plan" });
      return;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price, quantity: 1 }],
      customer_email: email,
      success_url: successUrl || `${req.protocol}://${req.get("host")}/?billing=success`,
      cancel_url: cancelUrl || `${req.protocol}://${req.get("host")}/?billing=cancel`,
      metadata: { uid, plan }
    });

    res.json({ ok: true, url: session.url });
  } catch (e) {
    const msg = String(e && e.message ? e.message : e || "");
    const type = String(e && e.type ? e.type : "");
    const code = String(e && e.code ? e.code : "");
    const param = String(e && e.param ? e.param : "");
    res.status(400).json({ ok: false, reason: "checkout_failed", type, code, param, msg });
  }
});

app.post("/api/billing/downgrade", async (req, res) => {
  const stripe = getStripe();
  if (!stripe) {
    res.status(500).json({ ok: false, reason: "stripe_key_missing" });
    return;
  }

  let stripeSkipped = false;
  let stripeError = "";

  try {
    const uid = String(req.body?.uid || "").trim();
    if (!uid) {
      res.status(400).json({ ok: false, reason: "missing_uid" });
      return;
    }

    const snap = await db.collection("users").doc(uid).get();
    const d = snap.exists ? (snap.data() || {}) : {};

    const subId = String(d.stripeSubscriptionId || "").trim();
    const customerId = String(d.stripeCustomerId || "").trim();

    // Stripe は「できたら解約」扱い：失敗しても throw しない（Free確定を最優先）
    try {
      // 1) subscriptionId があればそれをキャンセル
      if (subId) {
        try {
          await stripe.subscriptions.del(subId);
        } catch (e) {
          const code = String(e && e.code ? e.code : "");
          const msg = String(e && e.message ? e.message : e || "");
          const isMissing = (code === "resource_missing") || msg.includes("No such subscription");
          if (!isMissing) {
            stripeSkipped = true;
            stripeError = msg || code || "stripe_cancel_failed";
          }
        }
      }

      // 2) subscriptionId が無い場合は customerId から active/trialing を探してキャンセル
      if (!subId && customerId) {
        try {
          const list = await stripe.subscriptions.list({
            customer: customerId,
            status: "all",
            limit: 10
          });

          const cand = (list.data || []).find(s =>
            s && (s.status === "active" || s.status === "trialing" || s.status === "past_due")
          );

          if (cand && cand.id) {
            try {
              await stripe.subscriptions.del(String(cand.id));
            } catch (e) {
              const msg = String(e && e.message ? e.message : e || "");
              stripeSkipped = true;
              stripeError = msg || "stripe_cancel_failed";
            }
          }
        } catch (e) {
          const msg = String(e && e.message ? e.message : e || "");
          stripeSkipped = true;
          stripeError = msg || "stripe_list_failed";
        }
      }
    } catch (e) {
      const msg = String(e && e.message ? e.message : e || "");
      stripeSkipped = true;
      stripeError = msg || "stripe_failed";
    }

    // Firestore を Free に確定（ここは必ず通す）
    await db.collection("users").doc(uid).set(
      {
        plan: "Free",
        stripeSubscriptionId: "",
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    res.json({ ok: true, stripeSkipped, stripeError });
  } catch (e) {
    const msg = String(e && e.message ? e.message : e || "");
    const type = String(e && e.type ? e.type : "");
    const code = String(e && e.code ? e.code : "");
    const param = String(e && e.param ? e.param : "");
    res.status(400).json({ ok: false, reason: "downgrade_failed", type, code, param, msg });
  }
});

/* ================= TEMP: Force plan (remove later) ================= */
app.post("/api/stripe/test-complete", async (req, res) => {
  const stripe = getStripe();
  if (!stripe) {
    res.status(500).json({ ok: false, reason: "stripe_key_missing" });
    return;
  }

  try {
    let uid = String(req.body?.uid || "").trim();
    if (!uid) {
      const email = String(req.body?.email || "").trim();
      if (email) {
        try {
          const u = await admin.auth().getUserByEmail(email);
          uid = String(u.uid || "").trim();
        } catch (e) {
          void e;
        }
      }
    }
    if (!uid) {
      res.status(400).json({ ok: false, reason: "missing_uid" });
      return;
    }

    const snap = await db.collection("users").doc(uid).get();
    const d = snap.exists ? (snap.data() || {}) : {};
    const subId = String(d.stripeSubscriptionId || "").trim();

    if (subId) {
      await stripe.subscriptions.del(subId);
    }

    await db.collection("users").doc(uid).set(
      {
        plan: "Free",
        stripeSubscriptionId: "",
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    res.json({ ok: true });
  } catch (e) {
    const msg = String(e && e.message ? e.message : e || "");
    const type = String(e && e.type ? e.type : "");
    const code = String(e && e.code ? e.code : "");
    const param = String(e && e.param ? e.param : "");
    res.status(400).json({ ok: false, reason: "downgrade_failed", type, code, param, msg });
  }
});

/* ================= TEMP: Force plan (remove later) ================= */
app.post("/api/stripe/test-complete", async (req, res) => {
  try {
    const uid = String(req.body?.uid || "").trim();
    const plan = String(req.body?.plan || "").trim();
    if (!uid || !plan) {
      res.status(400).json({ ok: false, reason: "missing_params" });
      return;
    }

    await db.collection("users").doc(uid).set(
      {
        plan,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    res.json({ ok: true });
  } catch {
    res.status(400).json({ ok: false, reason: "failed" });
  }
});

/* ================= User plan (UI) ================= */
app.get("/api/user/plan", async (req, res) => {
  try {
    const uid = String(req.query?.uid || "").trim();
    if (!uid) {
      res.status(400).json({ ok: false, reason: "missing_uid" });
      return;
    }

    const snap = await db.collection("users").doc(uid).get();
    const d = snap.exists ? (snap.data() || {}) : {};
    const plan = String(d.plan || "Free").trim() || "Free";

    res.json({ ok: true, plan });
  } catch {
    res.status(400).json({ ok: false, reason: "failed" });
  }
});

app.get("/google/connect", connectGoogle("google"));
app.get("/gmail/connect", connectGoogle("gmail"));
app.get("/drive/connect", connectGoogle("drive"));

// Hosting rewrite が /api/** をそのまま渡すケース用（保険）
app.get("/api/google/connect", connectGoogle("google"));
app.get("/api/gmail/connect", connectGoogle("gmail"));
app.get("/api/drive/connect", connectGoogle("drive"));

// callback（保険で両方）
app.get("/google/callback", oauthCallback);
app.get("/api/google/callback", oauthCallback);
app.post("/company/invite/consume", consumeInvite);
app.post("/api/company/invite/consume", consumeInvite);

/* ================= AI Chat (v1) =================
  - 6大AIを /api/chat で一括実行して返す
  - 各AIの個別APIキーが無い場合は OpenAI で代替（ある場合は後で差し替え可能）
  - OpenAI: Responses API を使用（/v1/responses）
*/

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
// （将来用：各社キー。未設定でも落ちない）

const getOpenAIKey = () => {
  const k = String(OPENAI_API_KEY.value() || "").trim();
  return k ? k : null;
};

const uploadOpenAIFile = async ({ base64, filename, mime }) => {
  const key = getOpenAIKey();
  if (!key) return null;

  const buf = Buffer.from(String(base64 || ""), "base64");
  if (!buf || !buf.length) return null;

  const fd = new FormData();
  fd.append("purpose", "assistants"); // Files API requires purpose; used broadly for file tools/inputs
  fd.append("file", new Blob([buf], { type: String(mime || "application/pdf") }), String(filename || "file.pdf"));

  const r = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: fd
  });

  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j.id) return null;
  return String(j.id);
};

const callOpenAIText = async ({ system, user, userParts, model }) => {
  const key = getOpenAIKey();
  if (!key) return null;

  const m = String(model || "gpt-5.2").trim() || "gpt-5.2";

  const sysText = String(system || "").trim();
  const userText = String(user || "").trim();

  const parts =
    Array.isArray(userParts) && userParts.length
      ? userParts
      : [{ type: "text", text: userText }];

  const payload = {
    model: m,
    input: [
      {
        role: "system",
        content: [{ type: "text", text: sysText }]
      },
      {
        role: "user",
        content: parts
      }
    ]
  };

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify(payload)
  });

  const j = await r.json().catch(() => null);
  if (!r.ok || !j) return null;

  const out = String(j.output_text || "").trim();
  return out || null;
};

const buildSystemPrompt = (aiName) => {
  const n = String(aiName || "").trim();

  if (n === "Gemini") {
    return "You are Gemini. Do broad research-style exploration. Return concise bullet points.";
  }
  if (n === "Claude") {
    return "You are Claude. Do long-form analysis and structure. Return a clear outline and risks.";
  }
  if (n === "Perplexity") {
    return "You are Perplexity. Verify claims and list what should be checked. Return a verification checklist.";
  }
  if (n === "Mistral") {
    return "You are Mistral. Produce a fast concise answer and next actions.";
  }
  if (n === "Sora") {
    return "You are Sora. If the user requests an image, return an image prompt and style notes.";
  }
  return "You are GPT. Provide the final integrated answer and recommendations.";
};

const shouldUseSora = (text) => {
  const s = String(text || "");
  return /\b(image|render|illustration|photo|png|jpg|webp)\b/i.test(s) || /画像|イラスト|写真|生成|レンダ/.test(s);
};

app.post("/api/chat", async (req, res) => {
  try {
    // ===== Unified Request Schema =====
    const prompt = String(req.body?.prompt || "").trim();
    const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
    const context = req.body?.context || {};

    if (!prompt && attachments.length === 0) {
      res.status(400).json({ ok: false, reason: "empty_input" });
      return;
    }

    // v1: 添付はまだAIに渡さず、存在だけ認識（後工程で実装）
    const useSora =
      shouldUseSora(prompt) ||
      attachments.some(a => String(a.type || "") === "image");

    const names = ["GPT", "Gemini", "Claude", "Perplexity", "Mistral", "Sora"];

    // build user parts (multimodal)
    const userParts = [{ type: "text", text: prompt }];

    for (const a of attachments) {
      const type = String(a?.type || "").trim();
      const mime = String(a?.mime || "").trim();
      const data = String(a?.data || "").trim();
      const name = String(a?.name || "file").trim();

      // PDF: upload -> file_id -> input_file
      if (type === "file" && (mime === "application/pdf" || name.toLowerCase().endsWith(".pdf")) && data) {
        const fid = await uploadOpenAIFile({
          base64: data,
          filename: name || "file.pdf",
          mime: mime || "application/pdf"
        });
        if (fid) {
          userParts.push({ type: "input_file", file_id: fid });
        }
        continue;
      }

      // image
      if (type === "image" && mime.startsWith("image/") && data) {
        const url = `data:${mime};base64,${data}`;
        userParts.push({ type: "input_image", image_url: { url } });
        continue;
      }

      // other file (metadata only)
      if (type === "file") {
        const size = Number(a?.size || 0) || 0;
        userParts.push({
          type: "text",
          text: `Attached file: ${name}${mime ? ` (${mime})` : ""}${size ? ` ${size} bytes` : ""}`
        });
      }
    }

    const tasks = names.map(async (name) => {
      if (name === "Sora" && !useSora) return { name, out: null };

      const system = buildSystemPrompt(name);

      const out = await callOpenAIText({
        system,
        user: prompt,
        userParts,
        model: "gpt-5.2"
      });

      if (!out) return { name, out: null };

      return { name, out };
    });

    const results = await Promise.all(tasks);

    const map = {};
    for (const r of results) {
      if (r.out) map[r.name] = r.out;
    }

    res.json({
      ok: true,
      result: map
    });
  } catch (e) {
    const msg = String(e && e.message ? e.message : e || "");
    res.status(500).json({ ok: false, reason: "chat_failed", msg });
  }
});

exports.api = onRequest(
  {
    region: "us-central1",
    secrets: [
      STRIPE_SECRET_KEY,
      STRIPE_PRICE_PRO,
      STRIPE_PRICE_TEAM,
      STRIPE_PRICE_ENTERPRISE,
      STRIPE_WEBHOOK_SECRET,
      OPENAI_API_KEY,
    ]
  },
  app
);

