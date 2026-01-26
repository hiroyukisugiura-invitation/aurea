const { onRequest } = require("firebase-functions/v2/https");
const express = require("express");
const crypto = require("crypto");
const admin = require("firebase-admin");
const { defineSecret } = require("firebase-functions/params");

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_SECRET_KEY_TEST = defineSecret("STRIPE_SECRET_KEY_TEST");

const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
const STRIPE_WEBHOOK_SECRET_TEST = defineSecret("STRIPE_WEBHOOK_SECRET_TEST");

const STRIPE_PRICE_PRO = defineSecret("STRIPE_PRICE_PRO");
const STRIPE_PRICE_TEAM = defineSecret("STRIPE_PRICE_TEAM");
const STRIPE_PRICE_ENTERPRISE = defineSecret("STRIPE_PRICE_ENTERPRISE");

const STRIPE_PRICE_PRO_TEST = defineSecret("STRIPE_PRICE_PRO_TEST");

const GOOGLE_OAUTH_CLIENT_ID = defineSecret("GOOGLE_OAUTH_CLIENT_ID");
const GOOGLE_OAUTH_REDIRECT_URI = defineSecret("GOOGLE_OAUTH_REDIRECT_URI");

/**
 * INTERNAL DOC (non-public)
 *
 * Supported attachments:
 * - image: jpg / png  -> input_image (data URL base64)
 * - pdf:  pdf         -> uploadOpenAIFile -> input_file
 * - text: txt / md    -> decode base64 -> injected as text
 * - csv:  csv         -> decode base64 -> summary (header/rows/sample table)
 *
 * Client -> Server routing fields:
 * - attachment.route: "image" | "pdf" | "text" | "file"
 * - attachment.fallback: reason when data missing/too_large/read_error
 *
 * Size guards:
 * - PDF: 8MB (client packs base64; server uploads)
 * - text/csv: 120k chars injected max; csv sample first 20 rows
 *
 * Order guarantee:
 * - attachments are processed in received order and pushed into userParts sequentially
 *
 * Logging:
 * - set AUREA_DEBUG=1 to enable server debug logs (dbg)
 */

const isTruthy = (v) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
};

const getStripeKey = (opts) => {
  const testMode = !!(opts && opts.testMode);
  const secret = testMode ? STRIPE_SECRET_KEY_TEST : STRIPE_SECRET_KEY;
  const k = String(secret.value() || "").trim();
  return k ? k : null;
};

const getStripePriceMap = (opts) => {
  const testMode = !!(opts && opts.testMode);

  if (testMode) {
    return {
      Pro: String(STRIPE_PRICE_PRO_TEST.value() || "").trim(),
      Team: "",
      Enterprise: ""
    };
  }

  return {
    Pro: String(STRIPE_PRICE_PRO.value() || "").trim(),
    Team: String(STRIPE_PRICE_TEAM.value() || "").trim(),
    Enterprise: String(STRIPE_PRICE_ENTERPRISE.value() || "").trim()
  };
};

const normalizePlanLabel = (p) => {
  const s = String(p || "").trim();
  if (!s) return "Free";
  if (s === "Pro" || s === "Team" || s === "Enterprise") return s;
  const low = s.toLowerCase();
  if (low === "pro") return "Pro";
  if (low === "team") return "Team";
  if (low === "enterprise") return "Enterprise";
  if (low === "free") return "Free";
  return s;
};

const getPlanFromPriceId = (priceId) => {
  const pid = String(priceId || "").trim();
  if (!pid) return "";
  const m = getStripePriceMap();
  const keys = Object.keys(m || {});
  for (const k of keys) {
    if (String(m[k] || "").trim() === pid) return k; // "Pro" | "Team" | "Enterprise"
  }
  return "";
};

const app = express();
const getStripeWebhookSecret = () => {
  const s = String(STRIPE_WEBHOOK_SECRET.value() || "").trim();
  return s ? s : null;
};

const getStripeWebhookSecretTest = () => {
  const s = String(STRIPE_WEBHOOK_SECRET_TEST.value() || "").trim();
  return s ? s : null;
};

const parseStripeSigHeader = (header) => {
  const h = String(header || "").trim();
  if (!h) return null;

  const parts = h.split(",").map(x => x.trim()).filter(Boolean);
  let t = "";
  const v1 = [];

  for (const p of parts) {
    const i = p.indexOf("=");
    if (i < 0) continue;
    const k = p.slice(0, i).trim();
    const v = p.slice(i + 1).trim();
    if (k === "t") t = v;
    if (k === "v1") v1.push(v);
  }

  if (!t || !v1.length) return null;
  return { t, v1 };
};

const timingSafeEq = (a, b) => {
  try {
    const ba = Buffer.from(String(a || ""), "utf8");
    const bb = Buffer.from(String(b || ""), "utf8");
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
};

const verifyStripeSignature = ({ rawBody, sigHeader, secret }) => {
  const parsed = parseStripeSigHeader(sigHeader);
  if (!parsed) return false;

  const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || "");
  const signed = `${parsed.t}.${payload.toString("utf8")}`;

  const expected = crypto
    .createHmac("sha256", String(secret || ""))
    .update(signed, "utf8")
    .digest("hex");

  for (const s of parsed.v1) {
    if (timingSafeEq(String(s || ""), expected)) return true;
  }
  return false;
};

// Stripe Webhook (must be BEFORE express.json middleware)
app.post("/api/stripe/webhook", express.raw({ type: "application/json", limit: "2mb" }), async (req, res) => {
  try {
    const secretLive = getStripeWebhookSecret();
    const secretTest = getStripeWebhookSecretTest();

    if (!secretLive && !secretTest) {
      res.status(500).send("webhook_secret_missing");
      return;
    }

    const sig = String(req.headers["stripe-signature"] || "").trim();
    const rawBody = (req.rawBody != null) ? req.rawBody : req.body;

    // accept Buffer / string / object (some runtimes parse JSON before express.raw)
    const bodyBuf =
      Buffer.isBuffer(rawBody)
        ? rawBody
        : (typeof rawBody === "string"
            ? Buffer.from(rawBody, "utf8")
            : (rawBody && typeof rawBody === "object"
                ? Buffer.from(JSON.stringify(rawBody), "utf8")
                : null));

    if (!sig || !bodyBuf) {
      res.status(400).send("invalid_payload");
      return;
    }

    const okLive = secretLive ? verifyStripeSignature({ rawBody: bodyBuf, sigHeader: sig, secret: secretLive }) : false;
    const okTest = secretTest ? verifyStripeSignature({ rawBody: bodyBuf, sigHeader: sig, secret: secretTest }) : false;

    if (!okLive && !okTest) {
      res.status(400).send("invalid_signature");
      return;
    }

    let evt = null;
    try {
      evt = JSON.parse(rawBody.toString("utf8"));
    } catch {
      evt = null;
    }

    const type = String(evt?.type || "").trim();
    const supported =
      type === "checkout.session.completed" ||
      type === "customer.subscription.created" ||
      type === "customer.subscription.updated" ||
      type === "customer.subscription.deleted";

    if (!supported) {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    const now = admin.firestore.Timestamp.now();

    // ---------- helpers ----------
    const upsertUserPlan = async ({ uid, plan, email, customerId, subscriptionId, priceId, status, currentPeriodEnd }) => {
      const u = String(uid || "").trim();
      if (!u) return;

      const patch = {
        plan: normalizePlanLabel(plan || "Free"),
        updatedAt: now
      };

      if (email) patch.email = String(email || "").trim();
      if (customerId) patch.stripeCustomerId = String(customerId || "").trim();
      if (subscriptionId) patch.stripeSubscriptionId = String(subscriptionId || "").trim();
      if (priceId) patch.stripePriceId = String(priceId || "").trim();
      if (status) patch.stripeStatus = String(status || "").trim();
      if (currentPeriodEnd != null) patch.stripeCurrentPeriodEnd = Number(currentPeriodEnd || 0) || 0;

      await db.collection("users").doc(u).set(patch, { merge: true });
    };

    const setSubMap = async ({ subscriptionId, uid, plan, customerId }) => {
      const sid = String(subscriptionId || "").trim();
      if (!sid) return;
      const u = String(uid || "").trim();
      if (!u) return;

      await db.collection("stripe_subscriptions").doc(sid).set({
        uid: u,
        plan: normalizePlanLabel(plan || "Free"),
        customerId: String(customerId || "").trim(),
        updatedAt: now
      }, { merge: true });
    };

    const getUidBySub = async (subscriptionId) => {
      const sid = String(subscriptionId || "").trim();
      if (!sid) return "";
      const snap = await db.collection("stripe_subscriptions").doc(sid).get();
      const d = snap.exists ? (snap.data() || {}) : {};
      return String(d.uid || "").trim();
    };

    // ---------- event handlers ----------
    if (type === "checkout.session.completed") {
      const obj = evt?.data?.object || {};
      const mode = String(obj?.mode || "").trim();
      if (mode !== "subscription") {
        res.status(200).json({ ok: true, ignored: true });
        return;
      }

      const md = obj?.metadata || {};
      const uid = String(md?.uid || "").trim();
      const plan0 = normalizePlanLabel(md?.plan || "Free");
      const email = String(md?.email || obj?.customer_details?.email || obj?.customer_email || "").trim();

      const subscriptionId = String(obj?.subscription || "").trim();
      const customerId = String(obj?.customer || "").trim();

      // priceId は session から取れない場合があるため、まずは plan を優先
      await upsertUserPlan({
        uid,
        plan: plan0,
        email,
        customerId,
        subscriptionId,
        status: "checkout_completed"
      });

      if (subscriptionId) {
        await setSubMap({ subscriptionId, uid, plan: plan0, customerId });
      }

      res.status(200).json({ ok: true });
      return;
    }

    if (type === "customer.subscription.created" || type === "customer.subscription.updated" || type === "customer.subscription.deleted") {
      const obj = evt?.data?.object || {};
      const subscriptionId = String(obj?.id || "").trim();
      const status = String(obj?.status || "").trim();
      const customerId = String(obj?.customer || "").trim();

      const item0 = (obj?.items && Array.isArray(obj.items.data) && obj.items.data[0]) ? obj.items.data[0] : null;
      const priceId = String(item0?.price?.id || "").trim();
      const planByPrice = getPlanFromPriceId(priceId);
      const plan = planByPrice ? planByPrice : "";

      let currentPeriodEnd = 0;
      try {
        currentPeriodEnd = Number(obj?.current_period_end || 0) || 0; // unix seconds
      } catch {
        currentPeriodEnd = 0;
      }

      const uid = await getUidBySub(subscriptionId);

      // subscription.deleted は Free に戻す
      const finalPlan =
        (type === "customer.subscription.deleted")
          ? "Free"
          : (plan ? plan : "Pro");

      await upsertUserPlan({
        uid,
        plan: finalPlan,
        customerId,
        subscriptionId,
        priceId,
        status,
        currentPeriodEnd
      });

      // map は常に最新化（price 変更など）
      if (subscriptionId && uid) {
        await setSubMap({ subscriptionId, uid, plan: finalPlan, customerId });
      }

      res.status(200).json({ ok: true });
      return;
    }

    res.status(200).json({ ok: true });
    return;

  } catch (e) {
    const msg = String(e && e.message ? e.message : e || "");
    res.status(500).send(msg || "webhook_failed");
    return;
  }
});

// ===== API は JSON =====
// 添付（base64）を含むため上限を引き上げ
app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: false, limit: "8mb" }));

// ===== Health check (routing verification) =====
app.get("/api/ping", (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});
app.get("/ping", (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Hosting rewrites が /ai/** を使う環境向け（疎通判定用）
app.get("/ai/ping", (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

try { admin.initializeApp(); } catch (e) { void e; }
const db = admin.firestore();

/* ================= Google OAuth (v1: redirect only) =================
  Secrets (firebase-functions/params):
  - GOOGLE_OAUTH_CLIENT_ID
  - GOOGLE_OAUTH_REDIRECT_URI   (例: https://aurea-2026.web.app/api/google/callback)
  ※ client_secret は callback で token 交換する次フェーズで使用
*/

const mustGoogle = (secret) => {
  try {
    const v = String(secret.value() || "").trim();
    return v ? v : null;
  } catch {
    return null;
  }
};

const buildGoogleAuthUrl = ({ scope, state }) => {
  const clientId = mustGoogle(GOOGLE_OAUTH_CLIENT_ID);
  const redirectUri = mustGoogle(GOOGLE_OAUTH_REDIRECT_URI);

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

const DEBUG = String(process.env.AUREA_DEBUG || "").trim() === "1";
const dbg = (...args) => { try { if (DEBUG) console.log(...args); } catch {} };

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

/* ================= Billing (Paddle) ================= */
app.post("/api/billing/checkout", async (req, res) => {
  const testMode = isTruthy(req.body?.testMode);

  const key = getStripeKey({ testMode });
  if (!key) {
    res.status(500).json({ ok: false, reason: "stripe_key_missing" });
    return;
  }

  try {
    const { plan, uid, email, successUrl, cancelUrl } = req.body || {};
    const p = String(plan || "").trim();
    const u = String(uid || "").trim();
    const em = String(email || "").trim();
    const su = String(successUrl || "").trim();
    const cu = String(cancelUrl || "").trim();

    if (!p || !u || !em) {
      res.status(400).json({ ok: false, reason: "missing_params" });
      return;
    }

    const priceMap = getStripePriceMap({ testMode });

    const priceId = String(priceMap[p] || "").trim();
    if (!priceId) {
      res.status(400).json({ ok: false, reason: "invalid_plan" });
      return;
    }

    const success = su || `${req.protocol}://${req.get("host")}/?billing=success`;
    const cancel  = cu || `${req.protocol}://${req.get("host")}/?billing=cancel`;

    // Stripe Checkout Sessions API (no SDK; fetch with form encoding)
    const form = new URLSearchParams();
    form.set("mode", "subscription");
    form.set("success_url", success);
    form.set("cancel_url", cancel);
    form.set("customer_email", em);

    form.set("line_items[0][price]", priceId);
    form.set("line_items[0][quantity]", "1");

    // metadata（後でwebhook/Firestore反映に使う）
    form.set("metadata[uid]", u);
    form.set("metadata[plan]", p);
    form.set("metadata[email]", em);

    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: form.toString()
    });

    const j = await r.json().catch(() => null);

    const url = String(j?.url || "").trim();

    if (!r.ok || !url) {
      const msg =
        (j && j.error && (j.error.message || j.error.type))
          ? String(j.error.message || j.error.type)
          : `http_${r.status}`;
      res.status(400).json({ ok: false, reason: "checkout_failed", msg });
      return;
    }

    res.status(200).json({ ok: true, url });
    return;

  } catch (e) {
    const msg = String(e && e.message ? e.message : e || "");
    res.status(500).json({ ok: false, reason: "checkout_exception", msg });
    return;
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

/* ================= User profile (UI) ================= */
app.get("/api/user/profile", async (req, res) => {
  try {
    const uid = String(req.query?.uid || "").trim();
    if (!uid) {
      res.status(400).json({ ok: false, reason: "missing_uid" });
      return;
    }

    const snap = await db.collection("users").doc(uid).get();
    const d = snap.exists ? (snap.data() || {}) : {};

    const profile = {
      displayName: String(d.displayName || "").trim(),
      userName: String(d.userName || "").trim(),
      email: String(d.email || "").trim()
    };

    res.json({ ok: true, profile });
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

// 6大API（将来用：未設定でも落ちない / フラグで有効化）
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const CLAUDE_API_KEY = defineSecret("CLAUDE_API_KEY");
const PERPLEXITY_API_KEY = defineSecret("PERPLEXITY_API_KEY");
const MISTRAL_API_KEY = defineSecret("MISTRAL_API_KEY");

// Sora（画像生成専用。OpenAIのimagesを使う場合はOPENAI_API_KEYで足りる）
const SORA_API_KEY = defineSecret("SORA_API_KEY");

const MULTI_AI_ENABLED = String(process.env.AUREA_MULTI_AI || "").trim() === "1";

const getOpenAIKey = () => {
  const k = String(OPENAI_API_KEY.value() || "").trim();
  return k ? k : null;
};

const getGeminiKey = () => {
  try {
    const k = String(GEMINI_API_KEY.value() || "").trim();
    return k ? k : null;
  } catch { return null; }
};

const getClaudeKey = () => {
  try {
    const k = String(CLAUDE_API_KEY.value() || "").trim();
    return k ? k : null;
  } catch { return null; }
};

const getPerplexityKey = () => {
  try {
    const k = String(PERPLEXITY_API_KEY.value() || "").trim();
    return k ? k : null;
  } catch { return null; }
};

const getMistralKey = () => {
  try {
    const k = String(MISTRAL_API_KEY.value() || "").trim();
    return k ? k : null;
  } catch { return null; }
};

const getSoraKey = () => {
  try {
    const k = String(SORA_API_KEY.value() || "").trim();
    return k ? k : null;
  } catch { return null; }
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

// ===== Multi-AI runners (TOP LEVEL) =====
// NOTE: MULTI_AI_ENABLED !== true の間は一切呼ばれない

const runGemini = async ({ prompt, parts }) => {
  if (!MULTI_AI_ENABLED) return null;
  const key = getGeminiKey();
  if (!key) return null;

  const toText = (ps) => {
    const arr = Array.isArray(ps) ? ps : [];
    const out = [];

    for (const p of arr) {
      if (!p) continue;

      if (p.type === "input_text") {
        const t = String(p.text || "").trim();
        if (t) out.push(t);
        continue;
      }

      if (p.type === "input_image") {
        out.push("[image attached]");
        continue;
      }

      if (p.type === "input_file") {
        out.push("[file attached]");
        continue;
      }
    }

    const head = String(prompt || "").trim();
    const body = out.join("\n\n").trim();
    return body ? `${head}\n\n${body}`.trim() : head;
  };

  let text = toText(parts);
  if (!text) return null;

  // short prompt guard: Gemini can return empty on ultra-short inputs
  if (text.trim().length < 24) {
    text = `${text}\n\nReturn 2 bullet points and 1 next action.`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    try { controller.abort(); } catch {}
  }, 25000);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(key)}`;

    const payload = {
      contents: [
        {
          role: "user",
          parts: [{ text }]
        }
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 600
      }
    };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const j = await r.json().catch(() => null);

    if (!r.ok || !j) {
      const msg =
        (j && j.error && (j.error.message || j.error.status))
          ? String(j.error.message || j.error.status)
          : `http_${r.status}`;
      dbg("Gemini API failed:", msg, j);
      return null;
    }

    const cand = j.candidates && j.candidates[0];

    // primary: candidates[0].content.parts[].text
    let out = "";
    try {
      const parts0 = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts : [];
      out = parts0.map(x => String(x && x.text ? x.text : "")).join("\n").trim();
    } catch {}

    // fallback: candidates[0].content.parts[].(any string fields)
    if (!out) {
      try {
        const parts0 = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts : [];
        const xs = [];
        for (const p of parts0) {
          if (!p || typeof p !== "object") continue;
          for (const k of Object.keys(p)) {
            const v = p[k];
            if (typeof v === "string" && v.trim()) xs.push(v.trim());
          }
        }
        out = xs.join("\n").trim();
      } catch {}
    }

    // fallback: empty output should still be observable as a non-empty string
    return out || "Gemini: (no output)";

  } catch (e) {
    dbg("Gemini API exception:", e);
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const runClaude = async ({ prompt, parts }) => {
  if (!MULTI_AI_ENABLED) return null;
  const key = getClaudeKey();
  if (!key) return null;

  const toText = (ps) => {
    const arr = Array.isArray(ps) ? ps : [];
    const out = [];

    for (const p of arr) {
      if (!p) continue;

      if (p.type === "input_text") {
        const t = String(p.text || "").trim();
        if (t) out.push(t);
        continue;
      }

      if (p.type === "input_image") {
        out.push("[image attached]");
        continue;
      }

      if (p.type === "input_file") {
        out.push("[file attached]");
        continue;
      }
    }

    const head = String(prompt || "").trim();
    const body = out.join("\n\n").trim();
    return body ? `${head}\n\n${body}`.trim() : head;
  };

  const text = toText(parts);
  if (!text) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    try { controller.abort(); } catch {}
  }, 25000);

  try {
    const payload = {
      model: "claude-sonnet-4-5",
      max_tokens: 700,
      temperature: 0.3,
      messages: [
        { role: "user", content: text }
      ]
    };

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const j = await r.json().catch(() => null);

    if (!r.ok || !j) {
      const msg =
        (j && j.error && (j.error.message || j.error.type))
          ? String(j.error.message || j.error.type)
          : `http_${r.status}`;
      dbg("Claude API failed:", msg, j);
      return null;
    }

    const content = Array.isArray(j.content) ? j.content : [];
    const out = content
      .filter(x => x && x.type === "text")
      .map(x => String(x.text || ""))
      .join("\n")
      .trim();

    return out || null;

  } catch (e) {
    dbg("Claude API exception:", e);
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const runPerplexity = async ({ prompt, parts }) => {
  if (!MULTI_AI_ENABLED) return null;
  const key = getPerplexityKey();
  if (!key) return null;

  const toText = (ps) => {
    const arr = Array.isArray(ps) ? ps : [];
    const out = [];

    for (const p of arr) {
      if (!p) continue;

      if (p.type === "input_text") {
        const t = String(p.text || "").trim();
        if (t) out.push(t);
        continue;
      }

      if (p.type === "input_image") {
        out.push("[image attached]");
        continue;
      }

      if (p.type === "input_file") {
        out.push("[file attached]");
        continue;
      }
    }

    const head = String(prompt || "").trim();
    const body = out.join("\n\n").trim();
    return body ? `${head}\n\n${body}`.trim() : head;
  };

  const text0 = toText(parts);
  if (!text0) return null;

  // citations を返しやすくするための最小追記
  const text = `${text0}\n\nIf you use external information, include citations.`;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    try { controller.abort(); } catch {}
  }, 25000);

  try {
    const payload = {
      model: "sonar-pro",
      messages: [
        { role: "user", content: text }
      ],
      temperature: 0.2,
      max_tokens: 900
    };

    const r = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const j = await r.json().catch(() => null);

    if (!r.ok || !j) {
      const msg =
        (j && j.error && (j.error.message || j.error.type))
          ? String(j.error.message || j.error.type)
          : `http_${r.status}`;
      dbg("Perplexity API failed:", msg, j);
      return null;
    }

    const out =
      j.choices && j.choices[0] && j.choices[0].message && typeof j.choices[0].message.content === "string"
        ? String(j.choices[0].message.content).trim()
        : "";

    const cites = Array.isArray(j.citations) ? j.citations.filter(Boolean) : [];

    if (!out) return null;

    if (!cites.length) return out;

    const src = cites.slice(0, 8).map((u) => `- ${String(u)}`).join("\n");
    return `${out}\n\nSources:\n${src}`.trim();

  } catch (e) {
    dbg("Perplexity API exception:", e);
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const runMistral = async ({ prompt, parts }) => {
  if (!MULTI_AI_ENABLED) return null;
  const key = getMistralKey();
  if (!key) return null;

  const toText = (ps) => {
    const arr = Array.isArray(ps) ? ps : [];
    const out = [];

    for (const p of arr) {
      if (!p) continue;

      if (p.type === "input_text") {
        const t = String(p.text || "").trim();
        if (t) out.push(t);
        continue;
      }

      if (p.type === "input_image") {
        out.push("[image attached]");
        continue;
      }

      if (p.type === "input_file") {
        out.push("[file attached]");
        continue;
      }
    }

    const head = String(prompt || "").trim();
    const body = out.join("\n\n").trim();
    return body ? `${head}\n\n${body}`.trim() : head;
  };

  const text = toText(parts);
  if (!text) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    try { controller.abort(); } catch {}
  }, 25000);

  try {
    const payload = {
      model: "mistral-large-latest",
      messages: [
        { role: "system", content: "Reply in the same language as the user prompt. If unclear, reply in Japanese." },
        { role: "user", content: text }
      ],
      temperature: 0.2,
      max_tokens: 700
    };

    const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const j = await r.json().catch(() => null);

    if (!r.ok || !j) {
      const msg =
        (j && j.error && (j.error.message || j.error.type))
          ? String(j.error.message || j.error.type)
          : `http_${r.status}`;
      dbg("Mistral API failed:", msg, j);
      return null;
    }

    const out =
      j.choices && j.choices[0] && j.choices[0].message && typeof j.choices[0].message.content === "string"
        ? String(j.choices[0].message.content).trim()
        : "";

    return out || null;

  } catch (e) {
    dbg("Mistral API exception:", e);
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const runSoraImage = async ({ prompt }) => {
  if (!MULTI_AI_ENABLED) return null;

  const key = getSoraKey() || getOpenAIKey();
  if (!key) return null;

  const p0 = String(prompt || "").trim();
  if (!p0) return null;

  const enhancedPrompt = [
    p0,
    "",
    "Constraints:",
    "- No watermark, no logos, no text unless explicitly requested.",
    "- High quality, clean composition.",
  ].join("\n");

  try {
    const r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: enhancedPrompt,
        n: 1,
        size: "1024x1024"
      })
    });

    const j = await r.json().catch(() => null);

    const b64 =
      (j && Array.isArray(j.data) && j.data[0] && j.data[0].b64_json)
        ? String(j.data[0].b64_json)
        : "";

    if (!r.ok || !b64) return null;

    // 既存の /api/chat と同じ形式（dataURL）で返す
    return {
      url: `data:image/png;base64,${b64}`,
      prompt: p0
    };
  } catch (e) {
    dbg("runSoraImage failed", e);
    return null;
  }
};

const callOpenAIText = async ({ system, user, userParts, model }) => {
  const key = getOpenAIKey();
  if (!key) return null;

  const m = String(model || "gpt-4o").trim() || "gpt-4o";

  const sysText = String(system || "").trim();
  const userText = String(user || "").trim();

  const parts =
    Array.isArray(userParts) && userParts.length
      ? userParts
      : [{ type: "input_text", text: userText }];

  const payload = {
    model: m,

    // force text output (workaround for empty output_text cases)
    text: { format: { type: "text" } },

    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: sysText }]
      },
      {
        role: "user",
        content: parts
      }
    ]
};

  const controller = new AbortController();
  const t = setTimeout(() => {
    try { controller.abort(); } catch {}
  }, 25000);

  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const j = await r.json().catch(() => null);

    if (!r.ok || !j) {
      const errMsg =
        (j && j.error && (j.error.message || j.error.code))
          ? String(j.error.message || j.error.code)
          : `http_${r.status}`;
      dbg("OpenAI Responses API failed:", errMsg, j);

      return DEBUG ? `OpenAIError: ${errMsg}` : null;
    }

    let out = String(j.output_text || "").trim();

    // fallback: parse output[] items when output_text is empty
    if (!out) {
      try {
        const items = Array.isArray(j.output) ? j.output : [];
        const texts = [];

        for (const it of items) {
          if (!it) continue;

          // message item
          if (String(it.type || "") === "message") {
            const cc = Array.isArray(it.content) ? it.content : [];
            for (const c of cc) {
              if (!c) continue;
              const t = String(c.type || "");
              if (t === "output_text" || t === "summary_text") {
                const s = String(c.text || "").trim();
                if (s) texts.push(s);
              }
              // some variants may return { type:"text", text:"..." } inside message content
              if (t === "text") {
                const s = String(c.text || "").trim();
                if (s) texts.push(s);
              }
            }
          }
        }

        out = texts.join("\n").trim();
      } catch (e) {
        dbg("OpenAI Responses API parse output[] failed:", e);
      }
    }

    if (!out) {
      dbg("OpenAI Responses API empty output:", j);
      return DEBUG ? "OpenAIError: empty_output" : null;
    }

    return out;

  } catch (e) {
    dbg("callOpenAIText failed", e);
    return null;
  } finally {
    clearTimeout(t);
  }
};

const callOpenAIEmbedding = async ({ input, model }) => {
  const key = getOpenAIKey();
  if (!key) return null;

  const text = String(input || "").trim();
  if (!text) return null;

  const m = String(model || "text-embedding-3-small").trim() || "text-embedding-3-small";

  const controller = new AbortController();
  const t = setTimeout(() => {
    try { controller.abort(); } catch {}
  }, 25000);

  try {
    const r = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: m,
        input: text
      }),
      signal: controller.signal
    });

    const j = await r.json().catch(() => null);
    if (!r.ok || !j) {
      const errMsg =
        (j && j.error && (j.error.message || j.error.code))
          ? String(j.error.message || j.error.code)
          : `http_${r.status}`;
      dbg("OpenAI Embeddings API failed:", errMsg, j);
      return null;
    }

    const emb =
      (j && Array.isArray(j.data) && j.data[0] && Array.isArray(j.data[0].embedding))
        ? j.data[0].embedding
        : null;

    return emb || null;

  } catch (e) {
    dbg("callOpenAIEmbedding failed", e);
    return null;
  } finally {
    clearTimeout(t);
  }
};

const cosineSim = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i] || 0);
    const y = Number(b[i] || 0);
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const den = Math.sqrt(na) * Math.sqrt(nb);
  if (!den) return 0;
  return dot / den;
};

const normalizeTrainerText = (s) => {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
};

const loadTrainerCases = async (companyId, inlineCases) => {
  void companyId;

  // client から渡された trainerCases を最優先
  if (Array.isArray(inlineCases) && inlineCases.length) {
    return inlineCases
      .map(x => ({
        q: String(x?.q || "").trim(),
        a: String(x?.a || "").trim()
      }))
      .filter(x => x.q && x.a)
      .slice(0, 200);
  }

  // fallback: Firestore
  const snap = await db.collection("trainer_cases").get();
  return snap.docs.map(d => d.data()).filter(x => x && x.q && x.a);
};

const findTrainerHitByEmbedding = async ({ userText, companyId, inlineCases }) => {
  const u0 = normalizeTrainerText(userText);
  if (!u0) return null;

  const cases = await loadTrainerCases(companyId, inlineCases);
  if (!cases.length) return null;

  // 0) Embedding が使えない時（キー無し等）は文字一致で拾う（確実に反映させる）
  const uKey = u0;
  const scoredText = [];

  // 上限（暴走防止）：まずは最大200件まで
  const MAX_CASES = 200;
  const pool0 = cases.slice(0, MAX_CASES);

  for (const c of pool0) {
    const qRaw = String(c.q || "").trim();
    const a = String(c.a || "").trim();
    const qNorm = normalizeTrainerText(qRaw);
    if (!qNorm || !qRaw || !a) continue;

    // 完全一致/包含を強く
    let s = 0;
    if (uKey === qNorm) s = 1.0;
    else if (uKey.includes(qNorm) || qNorm.includes(uKey)) s = 0.86;
    else {
      // 部分一致（日本語はスペースが無いことが多いので n-gram を併用）
      const w = qNorm.split(" ").filter(Boolean);

      const ngrams = (str, n) => {
        const s0 = String(str || "");
        const out = [];
        if (!s0) return out;
        if (s0.length <= n) return [s0];
        for (let i = 0; i <= s0.length - n; i++) out.push(s0.slice(i, i + n));
        return out;
      };

      // 1) スペース区切りが効く場合（英語など）
      if (w.length >= 2) {
        const hit = w.filter(t => uKey.includes(t)).length;
        s = hit ? Math.min(0.84, hit / Math.max(3, w.length)) : 0;
      } else {
        // 2) 日本語/短文：2-gram overlap
        const a2 = new Set(ngrams(uKey, 2));
        const b2 = new Set(ngrams(qNorm, 2));
        if (a2.size && b2.size) {
          let inter = 0;
          for (const t of b2) if (a2.has(t)) inter += 1;
          const denom = Math.max(a2.size, b2.size);
          const ratio = denom ? (inter / denom) : 0;

          // ratio を 0〜0.84 に寄せる（曖昧検索でも拾いやすく）
          s = ratio ? Math.min(0.84, ratio * 1.25) : 0;
        }
      }
    }

    if (s > 0) scoredText.push({ q: qRaw, a, score: s });
  }

  // 文字一致で確定ヒット
  if (scoredText.length) {
    scoredText.sort((x, y) => (y.score - x.score));
    const bestT = scoredText[0];

    if (bestT && bestT.score >= 0.86) {
      return { mode: "hit", hit: bestT, candidates: scoredText.slice(0, 3) };
    }
    if (bestT && bestT.score >= 0.70) {
      return { mode: "candidates", hit: null, candidates: scoredText.slice(0, 3) };
    }
  }

  // 1) user embedding
  const uEmb = await callOpenAIEmbedding({ input: u0, model: "text-embedding-3-small" });
  if (!uEmb) return null;

  // 2) score all cases (runtime embedding; cacheは次工程)
  const scored = [];
  const pool = cases.slice(0, MAX_CASES);

  for (const c of pool) {
    const qNorm = normalizeTrainerText(c.q);
    const qRaw = String(c.q || "").trim();
    const a = String(c.a || "").trim();
    if (!qNorm || !qRaw || !a) continue;

    const qEmb = await callOpenAIEmbedding({ input: qNorm, model: "text-embedding-3-small" });
    if (!qEmb) continue;

    const s = cosineSim(uEmb, qEmb);
    scored.push({ q: qRaw, a, score: s });
  }

  if (!scored.length) return null;

  scored.sort((x, y) => (y.score - x.score));

  const best = scored[0];

  // 閾値：
  // - 0.82以上：確定ヒット（そのまま回答）
  // - 0.70〜0.82：候補提示（確認質問）
  if (best && best.score >= 0.82) {
    return { mode: "hit", hit: best, candidates: scored.slice(0, 3) };
  }

  if (best && best.score >= 0.70) {
    return { mode: "candidates", hit: null, candidates: scored.slice(0, 3) };
  }

  return null;
};

const buildSystemPrompt = (aiName) => {
  const n = String(aiName || "").trim();

  if (n === "Gemini") {
    return [
      "You are Gemini.",
      "Role: Divergent thinking + idea generation.",
      "Return: concise bullet points.",
      "Do not over-verify; propose options and angles."
    ].join("\n");
  }
  if (n === "Claude") {
    return [
      "You are Claude.",
      "Role: Structure + deep reasoning.",
      "Return: a clear outline, risks, and assumptions."
    ].join("\n");
  }
  if (n === "Perplexity") {
    return [
      "You are Perplexity.",
      "Role: Verification + sources.",
      "Return: checks + sources when applicable."
    ].join("\n");
  }
  if (n === "Mistral") {
    return [
      "You are Mistral.",
      "Role: Fast concise answer + next actions.",
      "Return: short actionable steps."
    ].join("\n");
  }
  if (n === "Sora") {
    return "You are Sora. If the user requests an image, return an image prompt and style notes.";
  }

  // GPT（最終回答 / 添付解析テンプレ）
  return [
    "You are GPT. Provide the final integrated answer.",
    "",
    "Integration priority:",
    "- Use Claude for structure, Perplexity for verification/sources, Gemini for options/angles, Mistral for concise next steps.",
    "",
    "Attachment handling rules:",
    "- If a file is attached and the user prompt is empty/implicit, proactively analyze the attachment.",
    "- Be concise, structured, and actionable.",
    "",
    "When the attachment is a CSV:",
    "- Identify columns and likely data types.",
    "- Summarize key patterns, anomalies, and useful derived metrics.",
    "- If appropriate, propose next analyses and questions to confirm intent.",
    "",
    "When the attachment is a PDF:",
    "- Provide a short outline (sections) and key takeaways.",
    "- Extract critical entities/dates/numbers if present.",
    "- Flag uncertainty where the file content is ambiguous.",
    "",
    "When the attachment is an image:",
    "- Describe what is visible and extract any readable text if relevant.",
    "",
    "When the attachment is text/markdown:",
    "- Summarize, then list action items and open questions.",
    "",
    "Output format:",
    "- Start with the most useful conclusion.",
    "- Then bullet points or short sections.",
    "- Avoid filler."
  ].join("\n");
};

const isImageGenerationRequest = (text) => {
  const s0 = String(text || "");
  const s = s0.toLowerCase();

  // English triggers
  const en =
    /\b(generate|create|make|render|draw|illustrate)\b/i.test(s) ||
    /\b(image|illustration|photo)\b/i.test(s) ||
    /\b(png|jpg|jpeg|webp)\b/i.test(s);

  // Japanese triggers (include "イメージ画像" / future iPhone phrase)
  const ja =
    /画像|イメージ画像|イメージ|イラスト|写真|生成|描いて|作って|レンダ/.test(s0) ||
    /未来のiphone|未来のiPhone|iphoneのイメージ画像|iPhoneのイメージ画像/.test(s0);

  return !!(en || ja);
};

const shouldUseSora = (text) => {
  // unify with isImageGenerationRequest()
  return isImageGenerationRequest(text);
};

// server-side placeholder image (SVG data URL)
const makePlaceholderImageDataUrl = (prompt) => {
  const safe = String(prompt || "").slice(0, 60)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#2b2c2d"/>
          <stop offset="1" stop-color="#101112"/>
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" fill="url(#g)"/>
      <circle cx="820" cy="210" r="180" fill="rgba(255,255,255,0.06)"/>
      <circle cx="320" cy="820" r="260" fill="rgba(255,255,255,0.04)"/>
      <text x="80" y="160" fill="rgba(255,255,255,0.88)" font-size="52" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Roboto">
        AUREA Image
      </text>
      <text x="80" y="245" fill="rgba(255,255,255,0.70)" font-size="32" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Roboto">
        ${safe}
      </text>
    </svg>
  `.trim();

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

app.post("/api/chat", async (req, res) => {
  try {
    // /api/chat は /chat に統一
    req.url = "/chat";
    app.handle(req, res);
    return;
  } catch (e) {
    const msg = String(e && e.message ? e.message : e || "");
    res.status(500).json({ ok: false, reason: "chat_failed", msg });
    return;
  }
});

app.post("/chat", async (req, res) => {
      /* ================= AUREA Data Trainer (Embedding Match) ================= */

    // 重要：特定ワードの同義語表ではなく、全ケースを「意味」で当てる
    // findTrainerHitByEmbedding / loadTrainerCases / callOpenAIEmbedding はファイル上部で定義済み
    const findTrainerHit = async (userText, companyId) => {
      return await findTrainerHitByEmbedding({ userText, companyId });
    };

  try {
    // ===== Unified Request Schema =====
    const prompt = String(req.body?.prompt || "").trim();
    const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
    const context = req.body?.context || {};

    // prompt が空でも、画像/ファイル添付があれば解析として通す
    if (!prompt && attachments.length === 0) {
      res.status(400).json({ ok: false, reason: "empty_input" });
      return;
    }

    // ===== Sora image generation (v1) =====
    // 重要：画像添付がある場合は「解析」扱い（生成ルートに入らない）
    const hasImageAttachment = attachments.some((a) => {
      const type = String(a?.type || "").trim();
      const route = String(a?.route || "").trim();
      const mime = String(a?.mime || "").trim();
      const name = String(a?.name || "").trim().toLowerCase();

      if (type === "image") return true;
      if (route === "image") return true;
      if (mime && mime.startsWith("image/")) return true;
      if (/\.(png|jpg|jpeg|webp|gif|bmp|svg)$/i.test(name)) return true;
      return false;
    });

    // 画像生成要求は、画像添付が無い時だけ image を返す
    // 画像生成：テキストで明示的に要求された場合のみ
    if (!hasImageAttachment && isImageGenerationRequest(prompt)) {
      const img = await runSoraImage({ prompt });

      if (!img || !img.url) {
        res.json({
          ok: true,
          image: {
            url: makePlaceholderImageDataUrl(prompt),
            prompt
          }
        });
        return;
      }

      res.json({
        ok: true,
        image: {
          url: img.url,
          prompt: img.prompt || prompt
        }
      });
      return;
    }

    // v1: 添付はまだAIに渡さず、存在だけ認識（後工程で実装）
    const key = getOpenAIKey();
    if (!key) {
      res.status(500).json({ ok: false, reason: "openai_key_missing" });
      return;
    }

    const names = MULTI_AI_ENABLED
      ? ["Gemini", "Claude", "Perplexity", "Mistral", "Sora"]
      : [];

    // build user parts (multimodal)
    const isImplicitAttachmentOnly = (!prompt && attachments.length > 0);

    // GPT同等：添付だけ投げられた時は、AIに「添付あり・テキスト無し」を明示して起動させる
    const promptForModel = isImplicitAttachmentOnly
      ? (
          hasImageAttachment
            ? "この画像（スクショ）を分析して。まず画像内の文字をすべて抽出し、その後に状況/要点/次の手順を整理して。もしイラストや写真でUI文脈が無い場合は、被写体/スタイル/特徴を説明し、ユーザーが何をしたいかを1つだけ質問して。"
            : "添付ファイルが送られました。内容を最小限で把握し、目的確認の質問を1つだけしてください。"
        )
      : prompt;

    const userParts = [{ type: "input_text", text: promptForModel }];

    const parseCsvLine = (line) => {
      const s = String(line || "");
      const out = [];
      let cur = "";
      let inQ = false;

      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '"') {
          if (inQ && s[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQ = !inQ;
          }
          continue;
        }
        if (ch === "," && !inQ) {
          out.push(cur);
          cur = "";
          continue;
        }
        cur += ch;
      }
      out.push(cur);
      return out;
    };

    for (const a of attachments) {
      const type = String(a?.type || "").trim();
      const route = String(a?.route || "").trim();
      const fallback = String(a?.fallback || "").trim();
      const mime = String(a?.mime || "").trim();
      const data = String(a?.data || "").trim();
      const name = String(a?.name || "file").trim();
      const size = Number(a?.size || 0) || 0;

      const lower = name.toLowerCase();
      const isPdf = (route === "pdf") || (mime === "application/pdf") || lower.endsWith(".pdf");
      const isCsv = (mime === "text/csv") || lower.endsWith(".csv");
      const isTextLike =
        route === "text" ||
        mime.startsWith("text/") ||
        mime === "text/csv" ||
        mime === "text/html" ||
        lower.endsWith(".txt") ||
        lower.endsWith(".md") ||
        lower.endsWith(".csv") ||
        lower.endsWith(".html") ||
        lower.endsWith(".htm");

      // PDF: upload -> file_id -> input_file
      // client側が type:"pdf" を送るため、file/pdf 両方を許可
      if ((type === "file" || type === "pdf") && isPdf && data) {
        const fid = await uploadOpenAIFile({
          base64: data,
          filename: name || "file.pdf",
          mime: mime || "application/pdf"
        });
        if (fid) {
          userParts.push({ type: "input_file", file_id: fid });
        } else {
          userParts.push({
            type: "input_text",
            text: `Attached PDF: ${name}${mime ? ` (${mime})` : ""}${size ? ` ${size} bytes` : ""}\nNote: upload failed.`
          });
        }
        continue;
      }

      // text files (txt/md/csv): decode base64 -> inject as text
      if (type === "file" && isTextLike && data) {
        let decoded = "";
        try {
          decoded = Buffer.from(String(data), "base64").toString("utf8");
        } catch {
          decoded = "";
        }

        if (decoded) {
          const MAX_CHARS = 120000;
          let truncated = false;
          if (decoded.length > MAX_CHARS) {
            decoded = decoded.slice(0, MAX_CHARS);
            truncated = true;
          }

          if (isCsv) {
            const raw = decoded.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
            const lines = raw.split("\n").filter(l => l.trim().length > 0);

            const headerLine = lines[0] || "";
            const header = parseCsvLine(headerLine).map(x => String(x || "").trim());
            const totalRows = Math.max(0, lines.length - 1);

            const sampleMax = 20;
            const sampleLines = lines.slice(1, 1 + sampleMax);
            const sampleRows = sampleLines.map(parseCsvLine);

            const safe = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();

            const cols = header.length ? header : ["(no header)"];
            const colCount = cols.length;

            const md = [];
            md.push(`| ${cols.map(safe).join(" | ")} |`);
            md.push(`| ${cols.map(() => "---").join(" | ")} |`);

            for (const r of sampleRows) {
              const row = [];
              for (let i = 0; i < colCount; i++) row.push(safe(r[i] ?? ""));
              md.push(`| ${row.join(" | ")} |`);
            }

            userParts.push({
              type: "input_text",
              text:
                `Attached CSV file: ${name}${mime ? ` (${mime})` : ""}\n` +
                `Columns: ${colCount}${header.length ? ` (${cols.slice(0, 20).join(", ")}${cols.length > 20 ? ", ..." : ""})` : ""}\n` +
                `Rows: ${totalRows}\n` +
                `${truncated ? `Note: content was truncated.\n` : ""}\n` +
                `Sample (first ${Math.min(sampleMax, totalRows)} rows):\n` +
                `${md.join("\n")}`
            });
          } else {
            userParts.push({
              type: "input_text",
              text: `Attached text file: ${name}${mime ? ` (${mime})` : ""}\n\n${decoded}${truncated ? `\n\n[truncated]` : ""}`
            });
          }
        } else {
          userParts.push({
            type: "input_text",
            text: `Attached text file: ${name}${mime ? ` (${mime})` : ""}${size ? ` ${size} bytes` : ""}\nNote: decode failed.`
          });
        }
        continue;
      }

      // image
      if ((type === "image" || route === "image") && mime.startsWith("image/") && data) {
        const url = `data:${mime};base64,${data}`;
        userParts.push({ type: "input_image", image_url: { url } });
        continue;
      }

      // other / fallback (metadata + reason)
      if (type === "file" || type === "image" || type === "pdf") {
        const reason = fallback ? `\nReason: ${fallback}` : (!data ? `\nReason: no_data` : "");
        userParts.push({
          type: "input_text",
          text: `Attached file: ${name}${mime ? ` (${mime})` : ""}${size ? ` ${size} bytes` : ""}${reason}`
        });
      }
    }

    const useSora =
      shouldUseSora(prompt) ||
      attachments.some(a => String(a?.type || "") === "image");

    const tasks = names.map(async (name) => {

      if (name === "Gemini") {
        const out = await runGemini({ prompt, parts: userParts });
        return { name, out: out || null };
      }

      if (name === "Claude") {
        const out = await runClaude({ prompt, parts: userParts });
        return { name, out: out || null };
      }

      if (name === "Perplexity") {
        const out = await runPerplexity({ prompt, parts: userParts });
        return { name, out: out || null };
      }

      if (name === "Mistral") {
        const out = await runMistral({ prompt, parts: userParts });
        return { name, out: out || null };
      }

      if (name === "Sora") {
        // 非画像リクエストでは結果に含めない（画像は上の image 分岐で返す）
        if (!useSora) return { name, out: null };
        return { name, out: null };
      }

      return { name, out: null };
    });

    const settled = await Promise.allSettled(tasks);

    const map = {};
    for (const s of settled) {
      if (!s) continue;

      // fulfilled
      if (s.status === "fulfilled") {
        const v = s.value || {};
        const name = String(v.name || "").trim();
        if (!name) continue;

        const out = (v.out == null) ? "" : String(v.out);

        // 本番：中身があるものだけ返す
        if (!DEBUG) {
          if (out.trim()) map[name] = out;
          continue;
        }

        // DEBUG：空も見えるように返す
        map[name] = out.trim() ? out : "[empty]";
        continue;
      }

      // rejected（DEBUG時のみ可視化）
      if (DEBUG && s.status === "rejected") {
        const reason = s.reason;
        const msg = String(reason && reason.message ? reason.message : reason || "").trim() || "rejected";
        map["__rejected__"] = map["__rejected__"] ? (map["__rejected__"] + `\n${msg}`) : msg;
      }
    }

    const buildReportsBlock = (reports) => {
      const keys = Object.keys(reports || {}).filter(k => k && k !== "GPT");
      if (!keys.length) return "";
      const lines = [];
      lines.push("Reports:");
      for (const k of keys) {
        lines.push(`--- ${k} ---`);
        lines.push(String(reports[k] || "").trim());
      }
      return lines.join("\n");
    };

    const reportsBlock = buildReportsBlock(map);

    // ===== Trainer (embedding) =====
    // ここを単一ソースに統合（当たる：最適回答固定 / 微妙：候補提示 / 外す：通常）
    let trainerMode = "";
    let trainerCandidates = [];
    let trainerSystemBlock = "";

    try {
      const companyId = context?.companyId || null;
      const inlineCases = Array.isArray(context?.trainerCases) ? context.trainerCases : [];

      // prompt が空でも promptForModel を使う（添付のみ送信でも判定できる）
      const tPrompt = String(promptForModel || prompt || "").trim();

      const r = tPrompt
        ? await findTrainerHitByEmbedding({ userText: tPrompt, companyId, inlineCases })
        : null;

      if (r && r.mode === "hit" && r.hit) {
        trainerMode = "hit";
        trainerCandidates = Array.isArray(r.candidates) ? r.candidates : [];

        trainerSystemBlock = [
          "Company Knowledge (Highest Priority):",
          "The following answer is authoritative and must be used as-is.",
          "Do NOT ask follow-up questions.",
          "Do NOT provide general explanations or alternatives.",
          "",
          `Answer: ${r.hit.a}`
        ].join("\n");
      } else if (r && r.mode === "candidates" && Array.isArray(r.candidates) && r.candidates.length) {
        trainerMode = "candidates";
        trainerCandidates = r.candidates.slice(0, 3);
      }
    } catch {}

    // ===== Intent Discovery (single source of truth) =====
    // 添付だけ（prompt空）の時は必ず「観察 + 選択式ヒアリング」を返す
    const intentDiscoverySystem = isImplicitAttachmentOnly
      ? [
          "Intent Discovery (Highest Priority when attachments exist and user text is empty):",
          "- The user uploaded file(s) without any instruction.",
          "- Do NOT say 'no file attached' or ask the user to upload again.",
          "- First, do a quick minimal analysis of what the file contains (1-6 bullets).",
          "- Then ask ONE concise question to clarify the goal, with selectable options.",
          "",
          "Reply format (must follow):",
          "1) What I can see (bullets)",
          "2) What would you like to do? (choose one)",
          "   A. Summary / explanation",
          "   B. Find issues / improvements",
          "   C. Extract text / key info",
          "   D. Answer a specific question about it"
        ].join("\n")
      : "";

    // Trainer候補提示モード（当たらない時の振る舞い確定）
    const trainerCandidateSystem = (trainerMode === "candidates")
      ? [
          "Trainer Candidate Check (Highest Priority):",
          "You must ask the user to choose ONE of the candidates below.",
          "Do not answer with general knowledge.",
          "",
          "Candidates:",
          ...trainerCandidates.map((c, i) => `${String(i + 1)}. ${String(c.q || "").trim()}`)
        ].join("\n")
      : "";

    const visionSystem = userParts.some(p => p && p.type === "input_image")
      ? [
          "Vision analysis (Highest Priority when an image/screenshot is attached):",
          "",
          "Process (must follow):",
          "1) OCR: Read and transcribe ALL visible text exactly (labels, numbers, dates, warnings). If none, say: '抽出できる文字はありません'.",
          "2) Context: Identify the app/site/page and current state (view, modal, error, success, loading). If unknown, say: '特定できません'.",
          "3) Structure: List key UI regions and elements (navigation, panels, cards, buttons, inputs).",
          "4) Facts: Extract actionable facts only from what is visible (names, amounts, statuses, errors).",
          "5) Diagnosis (only if the user intent is troubleshooting): Rank likely causes with evidence from the image.",
          "6) Actions: Provide concrete next steps (short, ordered).",
          "",
          "Special handling (important):",
          "- If the image is an illustration/photo and there is no UI context: describe subject + style + notable details, then ask ONE intent question (e.g., '何をしたい？ ①説明 ②改善案 ③用途提案').",
          "- If the user prompt is empty and an image is attached: do minimal analysis + ask ONE concise intent question with options.",
          "",
          "Rules:",
          "- Do NOT guess hidden information.",
          "- Cite evidence by quoting visible labels/values when present.",
          "- Match the user's language.",
          "",
          "Output format:",
          "- Summary (1–2 lines)",
          "- Extracted text (bullets) ※なければ 'なし'",
          "- Observations (bullets)",
          "- Issues / Risks (bullets, if any)",
          "- Next steps (numbered)",
          "- Question (choose one option) ※必要な場合のみ"
        ].join("\n")
      : "";

    const gptSystem = [
      intentDiscoverySystem,
      trainerCandidateSystem,
      trainerSystemBlock,
      visionSystem,
      buildSystemPrompt("GPT"),
      "",
      "Integration rule:",
      "- If Reports are provided, integrate them into one final answer.",
      "- Do not mention internal model orchestration unless explicitly asked."
    ].filter(Boolean).join("\n\n");

    const gptParts = userParts.slice();

    // 重要：prompt が空でも promptForModel を保持して上書きしない
    const basePrompt = promptForModel || prompt || "";

    const mergedText = reportsBlock ? `${basePrompt}\n\n${reportsBlock}` : basePrompt;

    if (gptParts.length && gptParts[0] && gptParts[0].type === "input_text") {
      gptParts[0] = { type: "input_text", text: mergedText };
    } else {
      gptParts.unshift({ type: "input_text", text: mergedText });
    }

    const gptOut = await callOpenAIText({
      system: gptSystem,
      user: prompt,
      userParts: gptParts,
      model: "gpt-4o"
    });

    if (gptOut) map.GPT = gptOut;

    res.json({
      ok: true,

      // ===== GPT UI compatibility =====
      // page-chat.js が拾えるように text を直下に出す
      text: map.GPT || "",

      result: map,
      debug: DEBUG
        ? {
            multiAiEnabled: MULTI_AI_ENABLED,
            returnedKeys: Object.keys(map || {})
          }
        : undefined
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
      STRIPE_SECRET_KEY_TEST,

      STRIPE_WEBHOOK_SECRET,
      STRIPE_WEBHOOK_SECRET_TEST,

      STRIPE_PRICE_PRO,
      STRIPE_PRICE_TEAM,
      STRIPE_PRICE_ENTERPRISE,

      STRIPE_PRICE_PRO_TEST,

      OPENAI_API_KEY,

      GEMINI_API_KEY,
      CLAUDE_API_KEY,
      PERPLEXITY_API_KEY,
      MISTRAL_API_KEY,
      SORA_API_KEY,

      GOOGLE_OAUTH_CLIENT_ID,
      GOOGLE_OAUTH_REDIRECT_URI,
    ]
  },
  app
);
