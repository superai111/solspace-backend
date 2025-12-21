import express from "express";
import cors from "cors";
import { Connection, PublicKey } from "@solana/web3.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* ================= CONFIG ================= */
const POINT_PER_SOL = 1000; // 1 SOL = 1000 points (có thể điều chỉnh)
const SYSTEM_WALLET = new PublicKey("H2yVMrEbexHFdsAMFQtBY3Lp3BBz6cu6VVJwyiommqxZ");
const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const connection = new Connection(SOLANA_RPC, "confirmed");

/* ================= MEMORY DB ================= */
// gameLogs cho leaderboard
const gameLogs = [];

// userPoints: lưu điểm của từng wallet (thay thế localStorage frontend)
const userPoints = new Map(); // wallet string → points number

// processed deposit tx signatures (A1)
const processedDepositTx = new Set();

// ===== anti-bot + season memory =====
const userLastPlay = new Map();
const userPlayCount = new Map();

/* ================= HELPER ================= */
function getRangeMs(range) {
  if (range === "7d") return 7 * 24 * 60 * 60 * 1000;
  return 48 * 60 * 60 * 1000; // default 48h
}

function getCurrentSeasonId() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const week = Math.floor(
    (Date.UTC(year, now.getUTCMonth(), now.getUTCDate()) -
      Date.UTC(year, 0, 1)) /
      (7 * 24 * 60 * 60 * 1000)
  );
  return `${year}-W${week}`;
}

// Cleanup old logs định kỳ (chạy mỗi giờ)
setInterval(() => {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; // giữ 30 ngày
  while (gameLogs.length > 0 && gameLogs[0].time < cutoff) {
    gameLogs.shift();
  }
}, 60 * 60 * 1000);

/* ================= STATUS ================= */
app.get("/", (req, res) => {
  res.json({ ok: true, service: "solspace-backend", players: userPoints.size });
});

/* ================= GAME RESULT ================= */
app.post("/game/result", (req, res) => {
  const { wallet, profit, volume } = req.body;

  if (!wallet || typeof profit !== "number" || typeof volume !== "number") {
    return res.status(400).json({ ok: false, error: "Invalid data" });
  }

  // anti-bot nâng cao
  const now = Date.now();

  const last = userLastPlay.get(wallet) || 0;
  if (now - last < 800) {
    return res.status(429).json({ ok: false, error: "Too fast" });
  }
  userLastPlay.set(wallet, now);

  const window = userPlayCount.get(wallet) || { count: 0, windowStart: now };
  if (now - window.windowStart > 60 * 1000) {
    window.count = 0;
    window.windowStart = now;
  }
  window.count += 1;
  userPlayCount.set(wallet, window);

  if (window.count > 120) {
    return res.status(429).json({ ok: false, error: "Rate limit" });
  }

  if (volume === 0 && profit > 0) {
    return res.status(400).json({ ok: false, error: "Invalid round" });
  }

  // A2 – basic anti-cheat
  const MAX_MULTIPLIER = 100;
  if (profit < 0 || volume < 0) {
    return res.status(400).json({ ok: false, error: "Invalid values" });
  }
  if (profit > volume * MAX_MULTIPLIER) {
    return res.status(400).json({ ok: false, error: "Cheat detected" });
  }

  // Cập nhật points người chơi
  const current = userPoints.get(wallet) || 0;
  userPoints.set(wallet, current + profit);

  gameLogs.push({
    wallet,
    profit,
    volume,
    rounds: 1,
    time: Date.now(),
    season: getCurrentSeasonId()
  });

  res.json({ ok: true });
});

/* ================= DEPOSIT VERIFY (ON-CHAIN) ================= */
app.post("/check-deposit", async (req, res) => {
  const { wallet } = req.body;

  if (!wallet) {
    return res.status(400).json({ ok: false, error: "Missing wallet" });
  }

  try {
    const pubkey = new PublicKey(wallet);

    const signatures = await connection.getConfirmedSignaturesForAddress2(
      pubkey,
      { limit: 20 }
    );

    let addedPoint = 0;

    for (const sigInfo of signatures) {
      if (processedDepositTx.has(sigInfo.signature)) continue;

      const tx = await connection.getConfirmedTransaction(sigInfo.signature);
      if (!tx || !tx.meta || tx.meta.err) continue;

      const instructions = tx.transaction.message.instructions;

      for (const ix of instructions) {
        if (ix.programId.toString() !== "11111111111111111111111111111111") continue;

        const amountLamports = ix.parsed?.info?.lamports;
        if (!amountLamports) continue;

        const source = ix.parsed?.info?.source;
        const destination = ix.parsed?.info?.destination;

        if (
          source === wallet &&
          destination === SYSTEM_WALLET.toString() &&
          amountLamports >= 0.005 * 1e9
        ) {
          const solAmount = amountLamports / 1e9;
          const pointsToAdd = Math.floor(solAmount * POINT_PER_SOL);

          const current = userPoints.get(wallet) || 0;
          userPoints.set(wallet, current + pointsToAdd);
          addedPoint += pointsToAdd;

          processedDepositTx.add(sigInfo.signature);
        }
      }
    }

    res.json({ ok: true, addedPoint });

  } catch (e) {
    console.error("Deposit check error:", e);
    res.json({ ok: false, addedPoint: 0 });
  }
});

/* ================= LEADERBOARD ================= */
app.get("/leaderboard", (req, res) => {
  const range = req.query.range || "48h";
  const now = Date.now();
  const fromTime = now - getRangeMs(range);
  const currentSeason = getCurrentSeasonId();

  const filtered = gameLogs.filter(
    g => g.time >= fromTime && g.season === currentSeason
  );

  const map = {};
  for (const g of filtered) {
    if (!map[g.wallet]) {
      map[g.wallet] = {
        wallet: g.wallet,
        profit: 0,
        volume: 0,
        rounds: 0,
        points: userPoints.get(g.wallet) || 0
      };
    }
    map[g.wallet].profit += g.profit;
    map[g.wallet].volume += g.volume;
    map[g.wallet].rounds += g.rounds;
  }

  const users = Object.values(map);
  if (users.length === 0) return res.json([]);

  const maxProfit = Math.max(...users.map(u => Math.max(u.profit, 0)));
  const maxVolume = Math.max(...users.map(u => u.volume));
  const maxRounds = Math.max(...users.map(u => u.rounds));

  for (const u of users) {
    const profitScore = maxProfit ? Math.max(u.profit, 0) / maxProfit : 0;
    const volumeScore = maxVolume ? u.volume / maxVolume : 0;
    const roundsScore = maxRounds ? u.rounds / maxRounds : 0;

    u.score = profitScore * 0.5 + volumeScore * 0.3 + roundsScore * 0.2;
  }

  users.sort((a, b) => b.score - a.score);
  users.forEach((u, i) => (u.rank = i + 1));

  res.json(users.slice(0, 50));
});

/* ================= ADD: FINAL LEADERBOARD (C + D) ================= */
app.get("/leaderboard/final", (req, res) => {
  const map = {};
  const currentSeason = getCurrentSeasonId();

  for (const g of gameLogs) {
    if (g.season !== currentSeason) continue;

    if (!map[g.wallet]) {
      map[g.wallet] = {
        wallet: g.wallet,
        profit: 0,
        volume: 0,
        rounds: 0,
        points: userPoints.get(g.wallet) || 0
      };
    }
    map[g.wallet].profit += g.profit;
    map[g.wallet].volume += g.volume;
    map[g.wallet].rounds += g.rounds;
  }

  const users = Object.values(map);
  if (users.length === 0) return res.json([]);

  const maxProfit = Math.max(...users.map(u => Math.max(u.profit, 0)));
  const maxVolume = Math.max(...users.map(u => u.volume));
  const maxRounds = Math.max(...users.map(u => u.rounds));

  for (const u of users) {
    const profitScore = maxProfit ? Math.max(u.profit, 0) / maxProfit : 0;
    const volumeScore = maxVolume ? u.volume / maxVolume : 0;
    const roundsScore = maxRounds ? u.rounds / maxRounds : 0;

    u.finalScore = profitScore * 0.5 + volumeScore * 0.3 + roundsScore * 0.2;
  }

  users.sort((a, b) => b.finalScore - a.finalScore);
  users.forEach((u, i) => (u.rank = i + 1));

  res.json(users.slice(0, 100));
});

/* ================= START ================= */
app.listen(PORT, () => {
  console.log(`Solspace backend running on port ${PORT}`);
  console.log("Ready for deposits, game results & leaderboard");
});
