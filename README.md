# BrowserStrategy — збереження результатів боїв (Postgres)

Це невеликий бекенд для збереження результатів поєдинків із `battle_page.html` у PostgreSQL.

Що створено:
- `server/index.js` — простий Express-сервер з endpoint-ами для збереження матчу і статистики
- `server/db.js` — підключення до Postgres через `pg` + `dotenv`
- `migrations/create_matches.sql` — SQL-міграція для створення таблиці `matches`
- `.env.example` — приклад змінних середовища
- `package.json` — залежності і скрипти
- Оновлено `battle_page.html` щоб надсилати результат бою після завершення

Схема таблиці `matches`:
- id — PK
- winner — текст: `player` | `enemy` | `draw`
- round — число (останній раунд)
- details — JSONB із деталями матчу (состояние юнітів та ін.)
- played_at — timestamp із таймзоною

Інструкція (Windows, PowerShell):
1. Встановіть Node.js (рекомендовано v18+).
2. Скопіюйте `.env.example` в `.env` та вкажіть `DATABASE_URL`.
3. Встановіть залежності у корені проекту:

```powershell
npm install
```

4. Створіть базу даних у PostgreSQL і запустіть міграцію (можна командою psql або через GUI):

```powershell
# Якщо у вас налаштований psql та DATABASE_URL в .env
psql "$env:DATABASE_URL" -f migrations/create_matches.sql
```

або вручну замініть з'єднання:

```powershell
psql postgresql://user:password@localhost:5432/dbname -f migrations/create_matches.sql
```

5. Запустіть сервер:

```powershell
npm start
```

6. Відкрийте гру в браузері за адресою `http://localhost:3000/battle_page.html` — після завершення бою сторінка автоматично відправить результат на сервер.

API:
- POST /api/matches
  - payload: { winner: 'player' | 'enemy' | 'draw', round: number, units: Array }
  - відповідь: { id }
- GET /api/matches/stats
  - повертає просту статистику по `winner`

Python / FastAPI варіант
------------------------
Якщо ти хочеш запускати бекенд на Python + FastAPI, я додав відповідні файли в `server/` (requirements, app, db). Ось коротка інструкція:

1. Створи і активуй віртуальне оточення (опціонально, але рекомендовано):

```powershell
python -m venv .venv; .\.venv\Scripts\Activate
```

2. Встанови залежності:

```powershell
pip install -r server/requirements.txt
```

3. Скопіюй `.env.example` в `.env` та вкажи `DATABASE_URL`.

4. Застосуй міграцію (psql):

```powershell
psql "$env:DATABASE_URL" -f migrations/create_matches.sql
```

5. Запусти FastAPI сервер за допомогою uvicorn:

```powershell
uvicorn server.app:app --reload --host 0.0.0.0 --port 3000
```

Після цього `battle_page.html` буде доступний за адресою `http://localhost:3000/battle_page.html`, а API — за шляхом `/api/matches`.

Додаткові покращення (опціонально):
- додати аутентифікацію/ключі щоб уникнути спаму
- додати більш детальну аналітику (підсумкові метрики)
- використовувати node-migrate або knex для управління міграціями

Якщо хочеш — можу:
- додати тест для серверу
- додати endpoint для отримання останніх матчів
- інтегрувати авторизацію / rate-limit

