import express from "express";
import fs from "fs";
import cors from "cors";
import { Connection, PublicKey } from "@solana/web3.js";

const app = express();
app.use(cors());
app.use(express.json());

/* ===== CONFIG ===== */
const PORT = process.env.PORT || 3000;
const SYSTEM_WALLET = new PublicKey(
  "H2yVMrEbexHFdsAMFQtBY3Lp3BBz6cu6VVJwyiommqxZ"
);

const MIN_SOL = 0.005;
const POINT_PER_SOL = 1000;
const DATA_FILE = "./deposits.json";

const connection = new Connection(
  "https://api.mainnet-beta.solana.com",
  "confirmed"
);

/* ===== UTILS ===== */
function loadData() {
  if (!fs.existsSync(DATA_FILE)) return {};
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/* ===== HEALTH ===== */
app.get("/", (req, res) => {
  res.json({ ok: true, service: "solspace-backend" });
});

/* ===== VERIFY DEPOSIT ===== */
app.post("/verify-deposit", async (req, res) => {
  try {
    const { signature, wallet } = req.body;
    if (!signature || !wallet)
      return res.status(400).json({ error: "missing data" });

    const tx = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0
    });
    if (!tx) return res.status(400).json({ error: "tx not found" });

    const transfer = tx.transaction.message.instructions.find(
      (i) =>
        i.parsed &&
        i.parsed.type === "transfer" &&
        i.parsed.info.destination === SYSTEM_WALLET.toString()
    );

    if (!transfer)
      return res.status(400).json({ error: "invalid transfer" });

    const lamports = transfer.parsed.info.lamports;
    const sol = lamports / 1e9;

    if (sol < MIN_SOL)
      return res.status(400).json({ error: "below minimum" });

    const points = sol * POINT_PER_SOL;

    const data = loadData();
    if (data[signature])
      return res.status(400).json({ error: "already processed" });

    data[signature] = {
      wallet,
      sol,
      points,
      time: Date.now()
    };
    saveData(data);

    res.json({
      ok: true,
      sol,
      points
    });
  } catch (e) {
    res.status(500).json({ error: "server error" });
  }
});

app.listen(PORT, () =>
  console.log("Solspace backend running on port", PORT)
);
