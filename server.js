const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);

// Configuração do CORS para aceitar pedidos da Vercel
app.use(cors({
    origin: "*", 
    methods: ["GET", "POST", "DELETE"]
}));

app.use(express.json({ limit: "50mb" }));

// Conexão com o Banco de Dados
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Teste de conexão com o banco ao iniciar
pool.connect((err, client, release) => {
  if (err) {
    return console.error('ERRO AO CONECTAR NO SUPABASE:', err.stack);
  }
  console.log('CONEXÃO COM SUPABASE ESTABELECIDA COM SUCESSO!');
  release();
});

const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] } 
});

// --- ROTAS ---

app.get("/", (req, res) => res.send("Servidor de Logística Multi-lojas Online!"));

app.get("/api/dashboard/:store", async (req, res) => {
  const { store } = req.params;
  try {
    const pending = await pool.query("SELECT * FROM orders WHERE store_slug = $1 AND status = 'pending' ORDER BY created_at DESC", [store]);
    const active = await pool.query("SELECT * FROM orders WHERE store_slug = $1 AND status = 'on_route' ORDER BY created_at DESC", [store]);
    const history = await pool.query("SELECT * FROM delivery_history WHERE store_slug = $1 ORDER BY completed_at DESC LIMIT 20", [store]);
    
    res.json({
      pendingOrders: pending.rows,
      activeOrders: active.rows,
      history: history.rows
    });
  } catch (err) { 
    console.error("Erro no Dashboard:", err);
    res.status(500).json({ error: err.message }); 
  }
});

app.post("/register-delivery", async (req, res) => {
  const { store_slug, clientName, address, phone, price, lat, lng } = req.body;
  const id = "PED-" + Math.floor(1000 + Math.random() * 9000);
  const token = Math.floor(1000 + Math.random() * 9000).toString();

  try {
    console.log(`Tentando salvar pedido para: ${store_slug}`);
    const queryText = "INSERT INTO orders (id, store_slug, client_name, address, phone, price, lat, lng, token) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *";
    const values = [id, store_slug, clientName, address, phone, price, lat, lng, token];
    
    const result = await pool.query(queryText, values);
    console.log("Pedido salvo com sucesso:", result.rows[0].id);
    
    io.to(store_slug).emit("refresh_admin");
    res.json({ success: true, order: result.rows[0] });
  } catch (err) { 
    console.error("ERRO AO SALVAR NO BANCO:", err.message);
    res.status(500).json({ error: "Erro interno no banco de dados: " + err.message }); 
  }
});

app.post("/assign-order", async (req, res) => {
  const { orderId, driverName, store_slug } = req.body;
  try {
    await pool.query("UPDATE orders SET status = 'on_route', driver_name = $1 WHERE id = $2", [driverName, orderId]);
    io.to(store_slug).emit("refresh_admin");
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/complete-delivery", async (req, res) => {
  const { orderId, store_slug } = req.body;
  try {
    const orderData = await pool.query("SELECT * FROM orders WHERE id = $1", [orderId]);
    if (orderData.rows.length > 0) {
      const o = orderData.rows[0];
      await pool.query("INSERT INTO delivery_history (id, store_slug, client_name, price, driver_name) VALUES ($1, $2, $3, $4, $5)", 
        [o.id, store_slug, o.client_name, o.price, o.driver_name]);
      await pool.query("DELETE FROM orders WHERE id = $1", [orderId]);
      io.to(store_slug).emit("refresh_admin");
      res.json({ success: true });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- SOCKET.IO ---
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
