import os
import json
from dotenv import load_dotenv
from typing import List, Any, Dict, Optional

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import logging
from fastapi import status

from . import db

class MatchPayload(BaseModel):
    winner: str
    round: int
    units: List[Dict[str, Any]]
    moves: Optional[List[Dict[str, Any]]] = None

app = FastAPI()

# configure basic logging so logger.info/exception are visible in uvicorn output
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("browserstrategy")

# load .env into environment (so DATABASE_URL from .env becomes available)
load_dotenv()

# NOTE: static files mount is registered after routes so that API endpoints
# (like /api/matches) are matched first. The mount will be added at the end
# of this module after route definitions.

@app.on_event('startup')
async def on_startup():
    # let init_pool read DATABASE_URL from the environment (or raise a clear error)
    await db.init_pool()

@app.on_event('shutdown')
async def on_shutdown():
    await db.close_pool()

@app.post('/api/matches', status_code=status.HTTP_201_CREATED)
async def create_match(payload: MatchPayload):
    # ensure DB pool is initialized (lazy init in case uvicorn was started
    # in a different environment before .env was set)
    if not db.pool:
        logger.info('DB pool not initialized in handler; attempting init_pool()')
        try:
            await db.init_pool()
        except Exception:
            logger.exception('Failed to init DB pool in handler')
            raise HTTPException(status_code=500, detail='db_not_initialized')
    logger.info('Create match request: %s', payload.dict())
    try:
        async with db.pool.acquire() as conn:
            details = {'units': payload.units}
            if payload.moves is not None:
                details['moves'] = payload.moves
            row = await conn.fetchrow(
                'INSERT INTO matches(winner, round, details) VALUES($1, $2, $3::jsonb) RETURNING id',
                payload.winner, payload.round, json.dumps(details)
            )
            logger.info('Inserted match id=%s winner=%s', row['id'], payload.winner)
            return {'id': row['id']}
    except Exception as e:
        logger.exception('DB error while inserting match')
        raise HTTPException(status_code=500, detail='db_error')

@app.get('/api/matches/stats')
async def matches_stats():
    if not db.pool:
        logger.info('DB pool not initialized in stats handler; attempting init_pool()')
        try:
            await db.init_pool()
        except Exception:
            logger.exception('Failed to init DB pool in stats handler')
            raise HTTPException(status_code=500, detail='db_not_initialized')
    try:
        async with db.pool.acquire() as conn:
            rows = await conn.fetch('SELECT winner, COUNT(*)::int AS cnt FROM matches GROUP BY winner')
            return [dict(r) for r in rows]
    except Exception:
        raise HTTPException(status_code=500, detail='db_error')


@app.get('/api/matches')
async def list_matches(limit: int = 20):
    """Return recent matches ordered by played_at desc. Use ?limit=50 to increase."""
    if not db.pool:
        logger.info('DB pool not initialized in list_matches; attempting init_pool()')
        try:
            await db.init_pool()
        except Exception:
            logger.exception('Failed to init DB pool in list_matches')
            raise HTTPException(status_code=500, detail='db_not_initialized')
    try:
        async with db.pool.acquire() as conn:
            rows = await conn.fetch(
                'SELECT id, winner, round, details, played_at FROM matches ORDER BY played_at DESC LIMIT $1',
                limit
            )
            results = []
            for r in rows:
                d = dict(r)
                # ensure details is a dict (asyncpg returns JSONB as native)
                results.append(d)
            return results
    except Exception:
        raise HTTPException(status_code=500, detail='db_error')


@app.get('/api/matches/{match_id}')
async def get_match(match_id: int):
    """Return a single match by id, including details (units + moves)."""
    if not db.pool:
        logger.info('DB pool not initialized in get_match; attempting init_pool()')
        try:
            await db.init_pool()
        except Exception:
            logger.exception('Failed to init DB pool in get_match')
            raise HTTPException(status_code=500, detail='db_not_initialized')
    try:
        async with db.pool.acquire() as conn:
            row = await conn.fetchrow('SELECT id, winner, round, details, played_at FROM matches WHERE id = $1', match_id)
            if not row:
                raise HTTPException(status_code=404, detail='not_found')
            return dict(row)
    except HTTPException:
        raise
    except Exception:
        logger.exception('DB error in get_match')
        raise HTTPException(status_code=500, detail='db_error')


# Mount static files from project root so battle_page.html is available
# placed after API routes to avoid StaticFiles intercepting POST/PUT/etc.
app.mount('/', StaticFiles(directory=os.path.join(os.path.dirname(__file__), '..'), html=True), name='static')
