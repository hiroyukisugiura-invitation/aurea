const functions = require("firebase-functions/v1");
const express = require("express");

const app = express();

app.get("/google/connect", (req, res) => {
  res.send("Google connect endpoint (AUREA)");
});

app.get("/gmail/connect", (req, res) => {
  res.send("Gmail connect endpoint (AUREA)");
});

app.get("/drive/connect", (req, res) => {
  res.send("Drive connect endpoint (AUREA)");
});

exports.api = functions
  .runWith({memory: "256MB"})
  .region("us-central1")
  .https.onRequest(app);

