import express from "express";
import fs from "fs";
import { Connection, PublicKey } from "@solana/web3.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* ===== SOLSPACE CONFIG ===== */
const SOLSPACE_SYSTEM_WALLET = new PublicKey(
  "H2yVMrEbexHFdsAMFQtBY3Lp3BBz6cu6VVJwyiommqxZ"
);
const MIN_SOL = 0.01;
const POINT_RATE = 1000;

/* ===== SOLANA CONNECTION (FREE RPC) ===== */
const connection = new Connection(
  "https://api.mainnet-beta.solana.com",
  "confirmed"
);

/* ===== UTIL: LOAD / SAVE HANDLED TX ===== */
function loadHandled() {
  if (!fs.existsSync("deposits.json")) return [];
  return JSON.parse(fs.readFileSync("deposits.json", "utf8"));
}

function saveHandled(arr) {
  fs.writeFileSync("deposits.json", JSON.stringify(arr, null, 2));
}

/* ===== API: CHECK SOLSPACE DEPOSIT ===== */
app.post("/solspace/check-deposit", async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet) {
      return res.status(400).json({ error: "wallet required" });
    }

    const userWallet = new PublicKey(wallet);
    const handled = loadHandled();

    const sigs = await connection.getSignaturesForAddress(
      SOLSPACE_SYSTEM_WALLET,
      { limit: 25 }
    );

    let earnedPoint = 0;
    let newHandled = [];

    for (const s of sigs) {
      if (handled.includes(s.signature)) continue;

      const tx = await connection.getParsedTransaction(s.signature, {
        maxSupportedTransactionVersion: 0
      });
      if (!tx) continue;

      for (const ix of tx.transaction.message.instructions) {
        if (
          ix.program === "system" &&
          ix.parsed?.type === "transfer"
        ) {
          const info = ix.parsed.info;

          if (
            info.source === userWallet.toString() &&
            info.destination === SOLSPACE_SYSTEM_WALLET.toString()
          ) {
            const sol = info.lamports / 1e9;
            if (sol >= MIN_SOL) {
              earnedPoint += Math.floor(sol * POINT_RATE);
              newHandled.push(s.signature);
            }
          }
        }
      }
    }

    if (newHandled.length) {
      saveHandled([...handled, ...newHandled]);
    }

    res.json({ success: true, earnedPoint });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Solspace backend error" });
  }
});

/* ===== HEALTH CHECK ===== */
app.get("/", (_req, res) => {
  res.send("Solspace backend running");
});

app.listen(PORT, () => {
  console.log("Solspace backend running on port", PORT);
});
