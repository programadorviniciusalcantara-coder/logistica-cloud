const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { Pool } = require('pg');
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Conexão com Supabase
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Servir arquivos estáticos (GitHub Pages cuidará do Front, mas deixamos aqui por segurança)
app.use(express.static(path.join(__dirname)));

// API Dashboard (Filtra por Loja)
app.get("/api/dashboard/:store", async (req, res) => {
  const { store } = req.params;
  try {
    const pending = await pool.query("SELECT * FROM orders WHERE store_slug = $1 AND status = 'pending'", [store]);
    const active = await pool.query("SELECT * FROM orders WHERE store_slug = $1 AND status = 'on_route'", [store]);
    const history = await pool.query("SELECT * FROM delivery_history WHERE store_slug = $1 ORDER BY completed_at DESC LIMIT 50", [store]);
    
    res.json({
      pendingOrders: pending.rows,
      activeOrders: active.rows,
      history: history.rows
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Criar Pedido
app.post("/register-delivery", async (req, res) => {
  const { store_slug, clientName, address, phone, price, lat, lng } = req.body;
  const id = "PED-" + Math.floor(1000 + Math.random() * 9000);
  const token = Math.floor(1000 + Math.random() * 9000).toString();

  try {
    await pool.query(
      "INSERT INTO orders (id, store_slug, client_name, address, phone, price, lat, lng, token) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [id, store_slug, clientName, address, phone, price, lat, lng, token]
    );
    io.to(store_slug).emit("refresh_admin");
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Despachar Pedido
app.post("/assign-order", async (req, res) => {
  const { orderId, driverName, store_slug } = req.body;
  await pool.query("UPDATE orders SET status = 'on_route', driver_name = $1 WHERE id = $2", [driverName, orderId]);
  io.to(store_slug).emit("refresh_admin");
  res.json({ success: true });
});

// Finalizar Pedido (Move para Histórico)
app.post("/complete-delivery", async (req, res) => {
  const { orderId, store_slug } = req.body;
  const order = await pool.query("SELECT * FROM orders WHERE id = $1", [orderId]);
  const o = order.rows[0];

  await pool.query("INSERT INTO delivery_history (id, store_slug, client_name, price, driver_name) VALUES ($1, $2, $3, $4, $5)", 
    [o.id, store_slug, o.client_name, o.price, o.driver_name]);
  
  await pool.query("DELETE FROM orders WHERE id = $1", [orderId]);
  io.to(store_slug).emit("refresh_admin");
  res.json({ success: true });
});

// Socket.io com Canais por Loja
io.on("connection", (socket) => {
  socket.on("join_store", (store_slug) => {
    socket.join(store_slug);
  });

  socket.on("driver_location", (data) => {
    io.to(data.store_slug).emit("update_map", data);
  });

  socket.on("send_chat_message", (data) => {
    io.to(data.store_slug).emit("new_chat_message", data);
  });
});

server.listen(process.env.PORT || 3000, () => console.log("Servidor Multi-lojas ATIVO"));
