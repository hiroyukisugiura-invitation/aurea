const { onRequest } = require("firebase-functions/v2/https");
const express = require("express");

const app = express();

const ok = (label) => (req, res) => {
  res.status(200).send(`${label} connect endpoint (AUREA)`);
};

app.get("/google/connect", ok("Google"));
app.get("/gmail/connect", ok("Gmail"));
app.get("/drive/connect", ok("Drive"));

// Hosting rewrite が /api/** をそのまま渡すケース用（保険）
app.get("/api/google/connect", ok("Google"));
app.get("/api/gmail/connect", ok("Gmail"));
app.get("/api/drive/connect", ok("Drive"));

exports.api = onRequest({ region: "us-central1" }, app);
