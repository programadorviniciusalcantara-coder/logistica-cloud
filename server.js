const express = require('express');
const { Pool } = require('pg');
const app = express();

// Permite que o servidor entenda dados enviados em formato JSON
app.use(express.json());

// Configuração da conexão com o banco de dados na nuvem (Supabase)
// As informações sensíveis ficam protegidas em variáveis de ambiente (process.env)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Necessário para conexões seguras com Supabase/Render
  }
});

// Rota Principal: Apenas para testar se o sistema está online
app.get('/', (req, res) => {
  res.send('Sistema de Logística Multi-lojas (iGo iPhones, iphonezero81, oxeiphone) está ONLINE!');
});

// Rota para Salvar Novas Rotas de Entrega
app.post('/save-route', async (req, res) => {
  const { store_slug, origin, destinations } = req.body;

  try {
    // 1. Busca o ID da loja no banco através do "slug" (apelido)
    const storeResult = await pool.query('SELECT id FROM stores WHERE slug = $1', [store_slug]);
    
    if (storeResult.rows.length === 0) {
      return res.status(404).json({ error: "Loja não encontrada no sistema." });
    }

    const storeId = storeResult.rows[0].id;

    // 2. Insere a rota vinculada a essa loja específica
    const insertQuery = `
      INSERT INTO routes (origin, destinations, store_id)
      VALUES ($1, $2, $3)
      RETURNING *;
    `;
    const values = [origin, JSON.stringify(destinations), storeId];
    
    const result = await pool.query(insertQuery, values);

    res.status(201).json({
      success: true,
      message: `Rota salva com sucesso para a loja: ${store_slug}`,
      data: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao salvar no banco de dados na nuvem." });
  }
});

// Define a porta do servidor (o Render escolherá a porta automaticamente)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
