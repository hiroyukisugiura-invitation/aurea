const functions = require("firebase-functions");
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

exports.api = functions.runWith({region:"us-central1"}).https.onRequest(app);
