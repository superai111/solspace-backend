const express = require("express");
const app = express();

app.use(express.json());

// ROOT
app.get("/", (req, res) => {
  res.json({ ok: true, service: "solspace-backend" });
});

// STATUS (CÁI BẠN ĐANG GỌI)
app.get("/status", (req, res) => {
  res.json({ ok: true, service: "solspace-backend", status: "running" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Solspace backend running on port", PORT);
});
