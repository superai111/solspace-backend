const express = require("express");
const fs = require("fs");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

/* ===== MIDDLEWARE ===== */
app.use(cors());
app.use(express.json());

/* ===== DB FILE ===== */
const DB_FILE = "./deposits.json";

/* ===== UTILS ===== */
function readDB() {
  if (!fs.existsSync(DB_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DB_FILE));
  } catch {
    return [];
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

/* ===== HEALTH CHECK ===== */
app.get("/", (req, res) => {
  res.send("Solspace backend is running");
});

app.get("/status", (req, res) => {
  res.json({ status: "ok", service: "solspace-backend" });
});

/* ===== DEPOSIT API =====
   Frontend gửi:
   {
     wallet: string,
     signature: string,
     sol: number
   }
*/
app.post("/deposit", (req, res) => {
  const { wallet, signature, sol } = req.body;

  if (!wallet || !signature || typeof sol !== "number") {
    return res.status(400).json({ error: "invalid payload" });
  }

  // không cộng nếu < 0.01 SOL
  if (sol < 0.01) {
    return res.status(400).json({ error: "min deposit is 0.01 SOL" });
  }

  const db = readDB();

  // chống gửi trùng tx
  if (db.find(d => d.signature === signature)) {
    return res.json({ status: "exists" });
  }

  const record = {
    wallet,
    signature,
    sol,
    points: Math.floor(sol * 1000),
    time: Date.now()
  };

  db.push(record);
  writeDB(db);

  res.json({
    status: "saved",
    record
  });
});

/* ===== GET DEPOSITS BY WALLET ===== */
app.get("/deposits/:wallet", (req, res) => {
  const wallet = req.params.wallet;
  const db = readDB();
  const list = db.filter(d => d.wallet === wallet);
  res.json(list);
});

/* ===== START SERVER ===== */
app.listen(PORT, () => {
  console.log("Solspace backend running on port", PORT);
});
