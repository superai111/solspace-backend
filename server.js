import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* ================= CONFIG ================= */
const POINT_PER_SOL = 1000;

/* ================= MEMORY DB ================= */
/*
gameLogs = [
  {
    wallet,
    profit,
    volume,
    rounds,
    time
  }
]
*/
const gameLogs = [];

/* ================= HELPER ================= */
function getRangeMs(range) {
  if (range === "48h") return 48 * 60 * 60 * 1000;
  if (range === "7d") return 7 * 24 * 60 * 60 * 1000;
  return 48 * 60 * 60 * 1000;
}

/* ================= STATUS ================= */
app.get("/", (req, res) => {
  res.json({ ok: true, service: "solspace-backend" });
});

/* ================= GAME RESULT ================= */
/*
Frontend gọi SAU MỖI VÁN
*/
app.post("/game/result", (req, res) => {
  const { wallet, profit, volume } = req.body;

  if (!wallet || typeof profit !== "number" || typeof volume !== "number") {
    return res.status(400).json({ ok: false });
  }

  gameLogs.push({
    wallet,
    profit,
    volume,
    rounds: 1,
    time: Date.now()
  });

  res.json({ ok: true });
});

/* ================= LEADERBOARD ================= */
app.get("/leaderboard", (req, res) => {
  const range = req.query.range || "48h";
  const now = Date.now();
  const fromTime = now - getRangeMs(range);

  // 1️⃣ Filter theo thời gian
  const filtered = gameLogs.filter(g => g.time >= fromTime);

  // 2️⃣ Gom theo wallet
  const map = {};
  for (const g of filtered) {
    if (!map[g.wallet]) {
      map[g.wallet] = {
        wallet: g.wallet,
        profit: 0,
        volume: 0,
        rounds: 0
      };
    }
    map[g.wallet].profit += g.profit;
    map[g.wallet].volume += g.volume;
    map[g.wallet].rounds += g.rounds;
  }

  const users = Object.values(map);
  if (users.length === 0) return res.json([]);

  // 3️⃣ Lấy max để chuẩn hoá
  const maxProfit = Math.max(...users.map(u => Math.max(u.profit, 0)));
  const maxVolume = Math.max(...users.map(u => u.volume));
  const maxRounds = Math.max(...users.map(u => u.rounds));

  // 4️⃣ Tính score
  for (const u of users) {
    const profitScore = maxProfit ? u.profit / maxProfit : 0;
    const volumeScore = maxVolume ? u.volume / maxVolume : 0;
    const roundsScore = maxRounds ? u.rounds / maxRounds : 0;

    u.score =
      profitScore * 0.5 +
      volumeScore * 0.3 +
      roundsScore * 0.2;
  }

  // 5️⃣ Sort + rank
  users.sort((a, b) => b.score - a.score);
  users.forEach((u, i) => (u.rank = i + 1));

  res.json(users.slice(0, 50)); // top 50
});

/* ================= START ================= */
app.listen(PORT, () => {
  console.log("Solspace backend running on", PORT);
});
