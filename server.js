const express = require('express');
const { Pool } = require('pg');
const cors = require('cors'); // Importa o liberador de acesso
const app = express();

app.use(cors()); // Ativa a liberação para o seu site acessar a API
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.get('/', (req, res) => {
  res.send('Sistema Online e Liberado para o Painel!');
});

app.post('/save-route', async (req, res) => {
  const { store_slug, origin, destinations } = req.body;
  try {
    const storeResult = await pool.query('SELECT id FROM stores WHERE slug = $1', [store_slug]);
    if (storeResult.rows.length === 0) return res.status(404).json({ error: "Loja não encontrada." });

    const result = await pool.query(
      'INSERT INTO routes (origin, destinations, store_id) VALUES ($1, $2, $3) RETURNING *',
      [origin, JSON.stringify(destinations), storeResult.rows[0].id]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando!`));
