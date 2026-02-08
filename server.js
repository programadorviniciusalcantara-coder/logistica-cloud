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

// LISTA DE MOTOBOYS ONLINE (Memória Volátil)
let onlineDrivers = [];

const io = new Server(server, { cors: { origin: "*" } });

// --- API ---

// 1. Dashboard Admin (Agora retorna os drivers online!)
app.get("/api/dashboard/:store", async (req, res) => {
  const { store } = req.params;
  try {
    const pending = await pool.query("SELECT * FROM orders WHERE store_slug = $1 AND status = 'pending' ORDER BY created_at DESC", [store]);
    const active = await pool.query("SELECT * FROM orders WHERE store_slug = $1 AND status = 'on_route' ORDER BY created_at DESC", [store]);
    const history = await pool.query("SELECT * FROM delivery_history WHERE store_slug = $1 ORDER BY completed_at DESC LIMIT 50", [store]);
    
    // Filtra apenas os motoboys desta loja
    const storeDrivers = onlineDrivers.filter(d => d.store_slug === store);
    
    res.json({ pendingOrders: pending.rows, activeOrders: active.rows, history: history.rows, drivers: storeDrivers });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. Histórico Específico
app.get("/api/driver-history/:store/:phone", async (req, res) => {
  const { store, phone } = req.params;
  try {
    const result = await pool.query("SELECT * FROM delivery_history WHERE store_slug = $1 AND driver_phone = $2 ORDER BY completed_at DESC", [store, phone]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. Criar Pedido
app.post("/register-delivery", async (req, res) => {
  const { store_slug, clientName, address, phone, price, lat, lng } = req.body;
  const id = "PED-" + Math.floor(10000 + Math.random() * 90000);
  try {
    await pool.query(
      "INSERT INTO orders (id, store_slug, client_name, address, phone, price, lat, lng) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [id, store_slug, clientName, address, phone, price, lat, lng]
    );
    io.to(store_slug).emit("refresh_admin");
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. Atribuir Rota
app.post("/assign-order", async (req, res) => {
  const { orderId, driverName, driverPhone, store_slug } = req.body;
  try {
    await pool.query(
      "UPDATE orders SET status = 'on_route', driver_name = $1, driver_phone = $2 WHERE id = $3",
      [driverName, driverPhone, orderId]
    );
    io.to(store_slug).emit("refresh_admin");
    // Avisa o motoboy específico
    const driverSocket = onlineDrivers.find(d => d.phone === driverPhone);
    if(driverSocket) io.to(driverSocket.socketId).emit("refresh_driver");
    
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. Finalizar Entrega
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

// SOCKETS
io.on("connection", (socket) => {
  
  socket.on("join_store", (store) => {
      socket.join(store);
  });

  // MOTOBOY ENTRA ONLINE
  socket.on("driver_join", (data) => {
      // Remove se já existir para evitar duplicatas
      onlineDrivers = onlineDrivers.filter(d => d.phone !== data.phone);
      // Adiciona na lista
      onlineDrivers.push({ socketId: socket.id, ...data });
      console.log("Motoboy Online:", data.name);
      io.to(data.store_slug).emit("refresh_admin");
  });

  socket.on("driver_location", (data) => {
      // Atualiza posição na lista em memória também
      const idx = onlineDrivers.findIndex(d => d.phone === data.phone);
      if(idx !== -1) {
          onlineDrivers[idx].lat = data.lat;
          onlineDrivers[idx].lng = data.lng;
      }
      io.to(data.store_slug).emit("update_map", data);
  });

  socket.on("disconnect", () => {
      onlineDrivers = onlineDrivers.filter(d => d.socketId !== socket.id);
      // Opcional: emitir refresh para o admin ver que saiu
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
