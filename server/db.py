import os
import re
import logging
import asyncpg

logger = logging.getLogger('browserstrategy')

# Module-level pool reference. Other modules import this module and
# reference `db.pool` at runtime (do not import the pool by value).
pool: asyncpg.pool.Pool | None = None


def _mask_dsn(dsn: str) -> str:
    """Return a version of DSN with the password masked for logging.

    Keeps username and host, but replaces password with '***'.
    If DSN doesn't match expected pattern, return a truncated string.
    """
    try:
        # match postgresql://user:pass@host:port/...
        m = re.match(r"(postgresql://[^:]+:)([^@]+)(@.+)$", dsn)
        if m:
            return m.group(1) + '***' + m.group(3)
    except Exception:
        pass
    return (dsn[:80] + '...') if len(dsn) > 80 else dsn


async def init_pool(min_size: int = 1, max_size: int = 5) -> None:
    """Create an asyncpg pool and store it on this module.

    Raises RuntimeError when DATABASE_URL is not set or pool creation fails.
    """
    global pool
    if pool:
        return

    dsn = os.getenv('DATABASE_URL')
    if not dsn:
        logger.error('DATABASE_URL is not set; cannot initialize DB pool')
        raise RuntimeError('DATABASE_URL not set')

    try:
        logger.info('Initializing DB pool to %s', _mask_dsn(dsn))
        pool = await asyncpg.create_pool(dsn, min_size=min_size, max_size=max_size)
        logger.info('DB pool created')
    except Exception as e:
        logger.exception('Failed to create DB pool')
        raise


async def close_pool() -> None:
    """Close the asyncpg pool if it exists."""
    global pool
    if pool:
        try:
            await pool.close()
            logger.info('DB pool closed')
        finally:
            pool = None
