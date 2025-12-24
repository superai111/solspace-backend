import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import { Connection, PublicKey } from "@solana/web3.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* ================= CONFIG ================= */
const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const connection = new Connection(SOLANA_RPC, "confirmed");

const SYSTEM_WALLET = new PublicKey(
  "H2yVMrEbexHFdsAMFQtBY3Lp3BBz6cu6VVJwyiommqxZ"
);

const POINT_PER_SOL = 1000;
const MIN_DEPOSIT_SOL = 0.005;
const MAX_MULTIPLIER = 100;

/* ================= DATABASE ================= */
const db = new Database("./solspace.db");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  wallet TEXT PRIMARY KEY,
  points INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS game_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT,
  profit INTEGER,
  volume INTEGER,
  time INTEGER,
  season TEXT
);

CREATE TABLE IF NOT EXISTS deposits (
  signature TEXT PRIMARY KEY,
  wallet TEXT,
  points INTEGER,
  time INTEGER
);
`);

/* ================= HELPERS ================= */
function now() {
  return Date.now();
}

// season = tuần, reset thứ 2 00:00 UTC
function seasonId() {
  const d = new Date();
  const utcMidnight = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate()
  );
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const monday = utcMidnight - day * 86400000;
  return `W-${monday}`;
}

// timer leaderboard
function leaderboardTimers() {
  const nowMs = Date.now();

  // 48h
  const H48 = 48 * 60 * 60 * 1000;
  const h48_end = Math.ceil(nowMs / H48) * H48;

  // tuần (thứ 2 00:00 UTC)
  const d = new Date();
  const utcMidnight = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate()
  );
  const day = (d.getUTCDay() + 6) % 7;
  const week_end = utcMidnight - day * 86400000 + 7 * 86400000;

  return { h48_end, week_end };
    }

function ensureUser(wallet) {
  db.prepare(
    `INSERT OR IGNORE INTO users (wallet, points) VALUES (?, 0)`
  ).run(wallet);
}

/* ================= HEALTH ================= */
app.get("/", (_, res) => {
  const count = db
    .prepare(`SELECT COUNT(*) as c FROM users`)
    .get().c;

  res.json({
    ok: true,
    service: "solspace-mainnet-db",
    players: count
  });
});

/* ================= GAME RESULT ================= */
app.post("/game/result", (req, res) => {
  const { wallet, profit, volume } = req.body;

  if (!wallet || typeof profit !== "number" || typeof volume !== "number") {
    return res.status(400).json({ ok: false });
  }

  if (profit < 0 || volume < 0) {
    return res.status(400).json({ ok: false });
  }

  if (profit > volume * MAX_MULTIPLIER) {
    return res.status(400).json({ ok: false });
  }

  ensureUser(wallet);

  db.prepare(`
    UPDATE users SET points = points + ? WHERE wallet = ?
  `).run(profit, wallet);

  db.prepare(`
    INSERT INTO game_logs (wallet, profit, volume, time, season)
    VALUES (?, ?, ?, ?, ?)
  `).run(wallet, profit, volume, now(), seasonId());

  res.json({ ok: true });
});

/* ================= DEPOSIT VERIFY ================= */
app.post("/check-deposit", async (req, res) => {
  const { wallet } = req.body;
  if (!wallet) return res.json({ ok: false, addedPoint: 0 });

  ensureUser(wallet);

  let addedPoint = 0;

  try {
    const pubkey = new PublicKey(wallet);

    const sigs = await connection.getSignaturesForAddress(pubkey, { limit: 20 });

    for (const s of sigs) {
      const used = db
        .prepare(`SELECT 1 FROM deposits WHERE signature = ?`)
        .get(s.signature);

      if (used) continue;

      const tx = await connection.getParsedTransaction(
        s.signature,
        { maxSupportedTransactionVersion: 0 }
      );

      if (!tx || tx.meta?.err) continue;

      for (const ix of tx.transaction.message.instructions) {
        if (ix.program !== "system" || ix.parsed?.type !== "transfer") continue;

        const { source, destination, lamports } = ix.parsed.info;

        if (
          source === wallet &&
          destination === SYSTEM_WALLET.toString() &&
          lamports >= MIN_DEPOSIT_SOL * 1e9
        ) {
          const sol = lamports / 1e9;
          const points = Math.floor(sol * POINT_PER_SOL);

          db.prepare(`
            UPDATE users SET points = points + ? WHERE wallet = ?
          `).run(points, wallet);

          db.prepare(`
            INSERT INTO deposits (signature, wallet, points, time)
            VALUES (?, ?, ?, ?)
          `).run(s.signature, wallet, points, now());

          addedPoint += points;
        }
      }
    }

    res.json({ ok: true, addedPoint });

  } catch (e) {
    console.error(e);
    res.json({ ok: false, addedPoint: 0 });
  }
});

/* ================= LEADERBOARD ================= */
app.get("/leaderboard", (req, res) => {
  const range = req.query.range || "48h";
  const ms = range === "7d" ? 7 * 86400000 : 48 * 3600000;
  const cutoff = now() - ms;
  const season = seasonId();

  const rows = db.prepare(`
    SELECT
      g.wallet,
      SUM(g.profit) AS profit,
      SUM(g.volume) AS volume,
      COUNT(*) AS rounds,
      u.points AS points
    FROM game_logs g
    JOIN users u ON u.wallet = g.wallet
    WHERE g.time >= ? AND g.season = ?
    GROUP BY g.wallet
  `).all(cutoff, season);

  if (!rows.length) return res.json([]);

  const maxProfit = Math.max(...rows.map(r => Math.max(r.profit, 0)));
  const maxVolume = Math.max(...rows.map(r => r.volume));
  const maxRounds = Math.max(...rows.map(r => r.rounds));

  rows.forEach(r => {
    r.score =
      (maxProfit ? Math.max(r.profit, 0) / maxProfit : 0) * 0.5 +
      (maxVolume ? r.volume / maxVolume : 0) * 0.3 +
      (maxRounds ? r.rounds / maxRounds : 0) * 0.2;
  });

  rows.sort((a, b) => b.score - a.score);
  rows.forEach((r, i) => (r.rank = i + 1));

  res.json(rows.slice(0, 50));
});

/* ================= FINAL LEADERBOARD ================= */
app.get("/leaderboard/final", (req, res) => {
  const season = seasonId();

  const rows = db.prepare(`
    SELECT
      g.wallet,
      SUM(g.profit) AS profit,
      SUM(g.volume) AS volume,
      COUNT(*) AS rounds,
      u.points AS points
    FROM game_logs g
    JOIN users u ON u.wallet = g.wallet
    WHERE g.season = ?
    GROUP BY g.wallet
  `).all(season);

  if (!rows.length) return res.json([]);

  const maxProfit = Math.max(...rows.map(r => Math.max(r.profit, 0)));
  const maxVolume = Math.max(...rows.map(r => r.volume));
  const maxRounds = Math.max(...rows.map(r => r.rounds));

  rows.forEach(r => {
    r.finalScore =
      (maxProfit ? Math.max(r.profit, 0) / maxProfit : 0) * 0.5 +
      (maxVolume ? r.volume / maxVolume : 0) * 0.3 +
      (maxRounds ? r.rounds / maxRounds : 0) * 0.2;
  });

  rows.sort((a, b) => b.finalScore - a.finalScore);
  rows.forEach((r, i) => (r.rank = i + 1));

  res.json(rows.slice(0, 100));
});

/* ================= POINTS ================= */
app.get("/points", (req, res) => {
  const { wallet } = req.query;
  if (!wallet) return res.json({ ok: false, points: 0 });

  ensureUser(wallet);

  const row = db
    .prepare(`SELECT points FROM users WHERE wallet = ?`)
    .get(wallet);

  res.json({ ok: true, points: row.points });
});

/* ================= START ================= */
app.listen(PORT, () => {
  console.log(`🚀 Solspace MAINNET DB backend running on ${PORT}`);
});
