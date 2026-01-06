const functions = require("firebase-functions");
const express = require("express");

const app = express();

app.get("/google/connect", (req, res) => {
  res.status(200).send("Google connect endpoint (AUREA)");
});

app.get("/gmail/connect", (req, res) => {
  res.status(200).send("Gmail connect endpoint (AUREA)");
});

app.get("/drive/connect", (req, res) => {
  res.status(200).send("Drive connect endpoint (AUREA)");
});

exports.api = functions.https.onRequest(app);
