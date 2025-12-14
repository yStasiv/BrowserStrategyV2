-- This migration creates a table to store match results

CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  winner TEXT NOT NULL,
  round INT NOT NULL,
  details JSONB,
  played_at TIMESTAMPTZ DEFAULT now()
);
