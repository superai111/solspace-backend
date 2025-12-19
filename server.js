const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Solspace backend is running");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "solspace-backend" });
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
