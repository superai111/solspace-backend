const express = require("express");
const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Solspace backend is running");
});

app.get("/api/ping", (req, res) => {
  res.json({
    ok: true,
    service: "solspace-backend",
    time: Date.now()
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
