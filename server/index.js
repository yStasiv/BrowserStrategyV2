const express = require('express');
const path = require('path');
const db = require('./db');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Віддавати статичні файли з кореня репозиторію (де знаходиться battle_page.html)
app.use(express.static(path.join(__dirname, '..')));

// Прийом результатів бою
app.post('/api/matches', async (req, res) => {
  try {
    const { winner, round, units } = req.body;
    if (!winner || typeof round !== 'number') {
      return res.status(400).json({ error: 'invalid_payload' });
    }

    const details = { units };
    const text = 'INSERT INTO matches(winner, round, details) VALUES($1, $2, $3) RETURNING id';
    const values = [winner, round, details];
    const result = await db.query(text, values);
    res.status(201).json({ id: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Простий endpoint для статистики
app.get('/api/matches/stats', async (req, res) => {
  try {
    const { rows } = await db.query("SELECT winner, COUNT(*)::int AS cnt FROM matches GROUP BY winner");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
