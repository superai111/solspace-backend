import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";

const app = express();
app.use(cors());
app.use(express.json());

/* ===== CONFIG ===== */
const PORT = process.env.PORT || 3000;
const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const SYSTEM_WALLET = "H2yVMrEbexHFdsAMFQtBY3Lp3BBz6cu6VVJwyiommqxZ";

const MIN_SOL = 0.005;
const POINT_PER_SOL = 1000;

/* ===== MEMORY DB (TẠM) ===== */
// wallet => lastProcessedSignature
const userState = {};

/* ===== RPC HELPER ===== */
async function rpc(method, params) {
  const res = await fetch(SOLANA_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });
  return res.json();
}

/* ===== HEALTH CHECK ===== */
app.get("/", (req, res) => {
  res.json({ ok: true, service: "solspace-backend", status: "running" });
});

/* =========================================================
   1️⃣ VERIFY WALLET SIGNATURE (PHANTOM)
   ========================================================= */
app.post("/verify-sign", (req, res) => {
  try {
    const { wallet, message, signature } = req.body;
    if (!wallet || !message || !signature) {
      return res.json({ ok: false, error: "Missing data" });
    }

    const pubkeyBytes = new PublicKey(wallet).toBytes();
    const msgBytes = new TextEncoder().encode(message);
    const sigBytes = bs58.decode(signature);

    const verified = nacl.sign.detached.verify(
      msgBytes,
      sigBytes,
      pubkeyBytes
    );

    if (!verified) {
      return res.json({ ok: false, error: "Invalid signature" });
    }

    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

/* =========================================================
   2️⃣ CHECK DEPOSIT + CALCULATE POINT
   ========================================================= */
app.post("/check-deposit", async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet) {
      return res.json({ ok: false, addedPoint: 0 });
    }

    const sigRes = await rpc("getSignaturesForAddress", [
      SYSTEM_WALLET,
      { limit: 20 },
    ]);

    if (!sigRes.result) {
      return res.json({ ok: true, addedPoint: 0 });
    }

    let addedPoint = 0;
    const lastSig = userState[wallet] || null;

    for (const tx of sigRes.result) {
      if (tx.signature === lastSig) break;

      const txDetail = await rpc("getTransaction", [
        tx.signature,
        { encoding: "jsonParsed" },
      ]);

      if (!txDetail.result) continue;

      const instructions =
        txDetail.result.transaction.message.instructions;

      for (const ins of instructions) {
        if (
          ins.parsed &&
          ins.parsed.type === "transfer" &&
          ins.parsed.info.destination === SYSTEM_WALLET &&
          ins.parsed.info.source === wallet
        ) {
          const lamports = Number(ins.parsed.info.lamports);
          const sol = lamports / 1_000_000_000;

          if (sol >= MIN_SOL) {
            addedPoint += Math.floor(sol * POINT_PER_SOL);
          }
        }
      }
    }

    if (sigRes.result[0]) {
      userState[wallet] = sigRes.result[0].signature;
    }

    return res.json({
      ok: true,
      addedPoint,
    });
  } catch (e) {
    console.error(e);
    return res.json({ ok: false, addedPoint: 0 });
  }
});

/* ===== START SERVER ===== */
app.listen(PORT, () => {
  console.log("Solspace backend running on", PORT);
});
