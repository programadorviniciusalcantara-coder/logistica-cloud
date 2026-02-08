const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);

// Habilita DELETE e outros métodos
app.use(cors({ origin: "*", methods: ["GET", "POST", "DELETE"] }));
app.use(express.json({ limit: "50mb" }));

// Conexão com Banco de Dados
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

let onlineDrivers = [];

const io = new Server(server, { cors: { origin: "*" } });

// --- ENDPOINTS ---

app.get("/api/dashboard/:store", async (req, res) => {
  const { store } = req.params;
  try {
    const pending = await pool.query("SELECT * FROM orders WHERE store_slug = $1 AND status = 'pending' ORDER BY created_at DESC", [store]);
    const active = await pool.query("SELECT * FROM orders WHERE store_slug = $1 AND status = 'on_route' ORDER BY created_at DESC", [store]);
    const history = await pool.query("SELECT * FROM delivery_history WHERE store_slug = $1 ORDER BY completed_at DESC LIMIT 50", [store]);
    
    const storeDrivers = onlineDrivers.filter(d => d.store_slug === store);
    res.json({ pendingOrders: pending.rows, activeOrders: active.rows, history: history.rows, drivers: storeDrivers });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/register-delivery", async (req, res) => {
  // GERA CÓDIGO DE 4 DÍGITOS
  const delivery_code = Math.floor(1000 + Math.random() * 9000).toString();
  
  const { store_slug, clientName, address, phone, price, lat, lng } = req.body;
  const id = "PED-" + Math.floor(10000 + Math.random() * 90000); 
  
  try {
    // Garante tabela
    await pool.query(`CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY, store_slug TEXT, client_name TEXT, address TEXT, 
        phone TEXT, price TEXT, lat TEXT, lng TEXT, status TEXT DEFAULT 'pending',
        driver_name TEXT, driver_phone TEXT, created_at TIMESTAMP DEFAULT NOW(),
        delivery_code TEXT
    )`);

    // --- CORREÇÃO AQUI: INSERE 'pending' EXPLICITAMENTE ---
    await pool.query(
      "INSERT INTO orders (id, store_slug, client_name, address, phone, price, lat, lng, delivery_code, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')",
      [id, store_slug, clientName, address, phone, price, lat, lng, delivery_code]
    );
    
    io.to(store_slug).emit("refresh_admin");
    res.json({ success: true, code: delivery_code });
  } catch (err) { 
      console.log(err);
      res.status(500).json({ error: err.message }); 
  }
});

app.post("/assign-order", async (req, res) => {
  const { orderId, driverName, driverPhone, store_slug } = req.body;
  try {
    await pool.query(
      "UPDATE orders SET status = 'on_route', driver_name = $1, driver_phone = $2 WHERE id = $3",
      [driverName, driverPhone, orderId]
    );
    io.to(store_slug).emit("refresh_admin");
    
    const driverSocket = onlineDrivers.find(d => d.phone === driverPhone);
    if(driverSocket) io.to(driverSocket.socketId).emit("refresh_driver");
    
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// FUNÇÃO DE EXCLUIR PEDIDO (Disponível para Pendentes e Em Rota)
app.delete("/delete-order/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const order = await pool.query("SELECT store_slug FROM orders WHERE id = $1", [id]);
        if(order.rows.length > 0) {
            const store = order.rows[0].store_slug;
            await pool.query("DELETE FROM orders WHERE id = $1", [id]);
            io.to(store).emit("refresh_admin");
            io.emit("refresh_driver"); 
            res.json({ success: true });
        } else {
            res.status(404).json({ error: "Pedido não encontrado" });
        }
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post("/verify-code", async (req, res) => {
    const { orderId, code } = req.body;
    try {
        const result = await pool.query("SELECT delivery_code FROM orders WHERE id = $1", [orderId]);
        if(result.rows.length > 0) {
            if(result.rows[0].delivery_code === code) {
                res.json({ valid: true });
            } else {
                res.json({ valid: false });
            }
        } else {
            res.json({ valid: false });
        }
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.post("/complete-delivery", async (req, res) => {
  const { orderId, store_slug, signature } = req.body; 
  try {
    const orderData = await pool.query("SELECT * FROM orders WHERE id = $1", [orderId]);
    if (orderData.rows.length > 0) {
      const o = orderData.rows[0];
      
      await pool.query(`CREATE TABLE IF NOT EXISTS delivery_history (
        id TEXT PRIMARY KEY, store_slug TEXT, client_name TEXT, price TEXT, 
        driver_name TEXT, driver_phone TEXT, completed_at TIMESTAMP DEFAULT NOW(),
        signature TEXT
      )`);

      await pool.query(
        "INSERT INTO delivery_history (id, store_slug, client_name, price, driver_name, driver_phone, signature) VALUES ($1, $2, $3, $4, $5, $6, $7)", 
        [o.id, store_slug, o.client_name, o.price, o.driver_name, o.driver_phone, signature || '']
      );
      
      await pool.query("DELETE FROM orders WHERE id = $1", [orderId]);
      io.to(store_slug).emit("refresh_admin");
      res.json({ success: true });
    } else {
        res.status(404).json({error: "Pedido não encontrado"});
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/delete-history/:id", async (req, res) => {
    try {
        await pool.query("DELETE FROM delivery_history WHERE id = $1", [req.params.id]);
        res.json({success:true});
    } catch(e) { res.status(500).json({error:e.message}); }
});

io.on("connection", (socket) => {
  socket.on("join_store", (store) => { socket.join(store); });
  
  socket.on("driver_join", (data) => {
      onlineDrivers = onlineDrivers.filter(d => d.phone !== data.phone);
      onlineDrivers.push({ socketId: socket.id, ...data });
      io.to(data.store_slug).emit("refresh_admin");
  });
  
  socket.on("driver_location", (data) => {
      const idx = onlineDrivers.findIndex(d => d.phone === data.phone);
      if(idx !== -1) { onlineDrivers[idx].lat = data.lat; onlineDrivers[idx].lng = data.lng; }
      io.to(data.store_slug).emit("update_map", data);
  });
  
  socket.on("send_chat_message", (data) => { io.emit("new_chat_message", data); });
  
  socket.on("disconnect", () => { 
      onlineDrivers = onlineDrivers.filter(d => d.socketId !== socket.id); 
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
