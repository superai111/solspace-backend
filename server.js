const express = require("express");
const fs = require("fs");
const cors = require("cors");
const bodyParser = require("body-parser");
const { Connection, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

/* ===== SOLANA CONFIG ===== */
const connection = new Connection(
  "https://api.mainnet-beta.solana.com",
  "confirmed"
);

const SYSTEM_WALLET = new PublicKey(
  "H2yVMrEbexHFdsAMFQtBY3Lp3BBz6cu6VVJwyiommqxZ"
);

const DEPOSIT_FILE = "./deposits.json";

/* ===== INIT STORAGE ===== */
if (!fs.existsSync(DEPOSIT_FILE)) {
  fs.writeFileSync(DEPOSIT_FILE, JSON.stringify([]));
}

/* ===== ROOT ===== */
app.get("/", (req, res) => {
  res.send("Solspace backend running");
});

/* ===== DEPOSIT VERIFY API ===== */
app.post("/api/deposit", async (req, res) => {
  try {
    const { wallet, tx } = req.body;

    if (!wallet || !tx) {
      return res.status(400).json({ error: "Missing wallet or tx" });
    }

    const signature = tx;

    // 1️⃣ Lấy transaction từ blockchain
    const txInfo = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });

    if (!txInfo || !txInfo.meta || txInfo.meta.err) {
      return res.status(400).json({ error: "Transaction failed or not found" });
    }

    // 2️⃣ Kiểm tra chuyển SOL vào SYSTEM_WALLET
    const instructions = txInfo.transaction.message.instructions;

    let receivedLamports = 0;

    for (const ix of instructions) {
      if (
        ix.parsed &&
        ix.parsed.type === "transfer" &&
        ix.parsed.info.destination === SYSTEM_WALLET.toString()
      ) {
        receivedLamports += Number(ix.parsed.info.lamports);
      }
    }

    const receivedSol = receivedLamports / LAMPORTS_PER_SOL;

    if (receivedSol < 0.01) {
      return res.status(400).json({ error: "Deposit less than 0.01 SOL" });
    }

    // 3️⃣ Chống nạp trùng
    const deposits = JSON.parse(fs.readFileSync(DEPOSIT_FILE));

    if (deposits.find((d) => d.tx === signature)) {
      return res.status(400).json({ error: "Transaction already processed" });
    }

    // 4️⃣ Quy đổi point
    const points = Math.floor(receivedSol * 1000);

    deposits.push({
      wallet,
      tx: signature,
      sol: receivedSol,
      points,
      time: Date.now(),
    });

    fs.writeFileSync(DEPOSIT_FILE, JSON.stringify(deposits, null, 2));

    return res.json({
      success: true,
      sol: receivedSol,
      points,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

/* ===== START SERVER ===== */
app.listen(PORT, () => {
  console.log("Solspace backend running on port " + PORT);
});
