const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "deposits.json");

// đảm bảo deposits.json tồn tại
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify([]));
}

/* ===== ROUTES CƠ BẢN ===== */

// root
app.get("/", (req, res) => {
  res.send("Solspace backend is running");
});

// health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// lấy danh sách nạp
app.get("/deposits", (req, res) => {
  const data = JSON.parse(fs.readFileSync(DATA_FILE));
  res.json(data);
});

// ghi log nạp (tạm thời)
app.post("/deposits", (req, res) => {
  const { wallet, amount, signature } = req.body;

  if (!wallet || !amount || !signature) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const data = JSON.parse(fs.readFileSync(DATA_FILE));
  data.push({
    wallet,
    amount,
    signature,
    time: Date.now()
  });

  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  res.json({ ok: true });
});

/* ===== START SERVER ===== */
app.listen(PORT, () => {
  console.log("Solspace backend running on port", PORT);
});
