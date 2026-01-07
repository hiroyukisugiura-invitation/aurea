const { onRequest } = require("firebase-functions/v2/https");
const express = require("express");

const app = express();

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

const connectGoogle = (service) => (req, res) => {
  const baseScopes = [
    "openid",
    "email",
    "profile"
  ];

  const svcScopes =
    service === "gmail"
      ? ["https://www.googleapis.com/auth/gmail.readonly"]
      : service === "drive"
        ? ["https://www.googleapis.com/auth/drive.readonly"]
        : [];

  const scope = [...baseScopes, ...svcScopes].join(" ");
  const url = buildGoogleAuthUrl({
    scope,
    state: `svc=${service}`
  });

  // env 未設定なら、デバッグ用に 200 を返す（UIは壊さない）
  if (!url) {
    res.status(200).send(`Google OAuth env missing. svc=${service}`);
    return;
  }

  res.redirect(302, url);
};

const oauthCallback = (req, res) => {
  // v1: callback到達確認のみ（token交換/保存は次フェーズ）
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  const err = String(req.query.error || "");

  if (err) {
    res.status(400).send(`OAuth error: ${err}`);
    return;
  }

  res.status(200).send(`OAuth callback reached. code=${code ? "YES" : "NO"} state=${state}`);
};

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

exports.api = onRequest({ region: "us-central1" }, app);
