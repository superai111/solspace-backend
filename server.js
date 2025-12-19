const express = require("express");
const app = express();

app.use(express.json());

// Test sống
app.get("/", (req, res) => {
  res.send("Solspace backend is running");
});

// Status cho frontend
app.get("/status", (req, res) => {
  res.json({ status: "ok", service: "solspace-backend" });
});

// Test endpoint để game gọi
app.post("/api/ping", (req, res) => {
  const { wallet } = req.body;
  res.json({
    ok: true,
    wallet: wallet || null,
    time: Date.now()
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Solspace backend running on port " + PORT);
});
