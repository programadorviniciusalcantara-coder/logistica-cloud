const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(express.json({ limit: "50mb" }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// TESTE DE CONEXÃO
pool.connect((err, client, release) => {
  if (err) return console.error('ERRO SUPABASE:', err.stack);
  console.log('CONEXÃO COM SUPABASE ESTABELECIDA COM SUCESSO!');
  release();
});

const io = new Server(server, { cors: { origin: "*" } });

// --- API ---

// 1. Dashboard Admin
app.get("/api/dashboard/:store", async (req, res) => {
  const { store } = req.params;
  try {
    const pending = await pool.query("SELECT * FROM orders WHERE store_slug = $1 AND status = 'pending' ORDER BY created_at DESC", [store]);
    const active = await pool.query("SELECT * FROM orders WHERE store_slug = $1 AND status = 'on_route' ORDER BY created_at DESC", [store]);
    const history = await pool.query("SELECT * FROM delivery_history WHERE store_slug = $1 ORDER BY completed_at DESC LIMIT 50", [store]);
    res.json({ pendingOrders: pending.rows, activeOrders: active.rows, history: history.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. Histórico Específico do Motoboy (Novo!)
app.get("/api/driver-history/:store/:phone", async (req, res) => {
  const { store, phone } = req.params;
  try {
    const result = await pool.query(
      "SELECT * FROM delivery_history WHERE store_slug = $1 AND driver_phone = $2 ORDER BY completed_at DESC",
      [store, phone]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. Criar Pedido
app.post("/register-delivery", async (req, res) => {
  const { store_slug, clientName, address, phone, price, lat, lng } = req.body;
  const id = "PED-" + Math.floor(1000 + Math.random() * 9000);
  try {
    await pool.query(
      "INSERT INTO orders (id, store_slug, client_name, address, phone, price, lat, lng) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [id, store_slug, clientName, address, phone, price, lat, lng]
    );
    io.to(store_slug).emit("refresh_admin");
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. Atribuir Rota (Agora com Telefone do Motoboy)
app.post("/assign-order", async (req, res) => {
  const { orderId, driverName, driverPhone, store_slug } = req.body;
  try {
    await pool.query(
      "UPDATE orders SET status = 'on_route', driver_name = $1, driver_phone = $2 WHERE id = $3",
      [driverName, driverPhone, orderId]
    );
    io.to(store_slug).emit("refresh_admin");
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. Finalizar Entrega (Guarda no histórico com ID único)
app.post("/complete-delivery", async (req, res) => {
  const { orderId, store_slug } = req.body;
  try {
    const orderData = await pool.query("SELECT * FROM orders WHERE id = $1", [orderId]);
    if (orderData.rows.length > 0) {
      const o = orderData.rows[0];
      await pool.query(
        "INSERT INTO delivery_history (id, store_slug, client_name, price, driver_name, driver_phone) VALUES ($1, $2, $3, $4, $5, $6)", 
        [o.id, store_slug, o.client_name, o.price, o.driver_name, o.driver_phone]
      );
      await pool.query("DELETE FROM orders WHERE id = $1", [orderId]);
      io.to(store_slug).emit("refresh_admin");
      res.json({ success: true });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

io.on("connection", (socket) => {
  socket.on("join_store", (store) => socket.join(store));
  socket.on("driver_location", (data) => io.to(data.store_slug).emit("update_map", data));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
