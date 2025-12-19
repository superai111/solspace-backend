import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
app.use(express.json());

/* ===== CONFIG ===== */
const PORT = process.env.PORT || 3000;
const SYSTEM_WALLET = "H2yVMrEbexHFdsAMFQtBY3Lp3BBz6cu6VVJwyiommqxZ";

const MIN_SOL = 0.005;
const POINT_PER_SOL = 1000;

/* ===== STORAGE (tạm thời) ===== */
const DB_FILE = "./deposits.json";
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "{}");

function readDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}
function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

/* ===== HEALTH ===== */
app.get("/", (req, res) => {
  res.json({ ok: true, service: "solspace-backend", time: Date.now() });
});

/* ===== CHECK DEPOSIT =====
   frontend gửi: wallet_address
*/
app.post("/check-deposit", async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet) {
      return res.status(400).json({ error: "missing wallet" });
    }

    const db = readDB();
    if (!db[wallet]) db[wallet] = { lastAmount: 0, points: 0 };

    /* lấy giao dịch từ Solscan (public API) */
    const url =
      `https://public-api.solscan.io/account/transactions?account=${SYSTEM_WALLET}&limit=20`;

    const txs = await fetch(url).then(r => r.json());

    let addedPoint = 0;

    for (const tx of txs) {
      if (
        tx.src === wallet &&
        tx.dst === SYSTEM_WALLET &&
        tx.lamport > db[wallet].lastAmount
      ) {
        const sol = tx.lamport / 1_000_000_000;

        if (sol >= MIN_SOL) {
          const point = Math.floor(sol * POINT_PER_SOL);
          addedPoint += point;
          db[wallet].lastAmount = tx.lamport;
        }
      }
    }

    db[wallet].points += addedPoint;
    writeDB(db);

    res.json({
      ok: true,
      addedPoint,
      totalPoint: db[wallet].points
    });

  } catch (e) {
    res.status(500).json({ error: "backend error" });
  }
});

/* ===== START ===== */
app.listen(PORT, () => {
  console.log("Solspace backend running on port", PORT);
});
