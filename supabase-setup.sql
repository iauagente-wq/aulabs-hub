-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- AU LABS Hub â€” Supabase Schema completo
-- Ejecutar en: supabase.com â†’ SQL Editor â†’ New Query
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- Tablas
CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pedidos (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- chat_history compartido entre web y Telegram
-- telegram_chat_id = NULL significa que vino desde la web app
CREATE TABLE IF NOT EXISTS chat_history (
  id               SERIAL PRIMARY KEY,
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content          TEXT NOT NULL,
  telegram_chat_id BIGINT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE tasks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_history ENABLE ROW LEVEL SECURITY;

-- PolÃ­ticas abiertas (app personal)
CREATE POLICY "allow_all" ON tasks        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON pedidos      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON chat_history FOR ALL USING (true) WITH CHECK (true);

-- Ãndices
CREATE INDEX IF NOT EXISTS idx_tasks_created      ON tasks        (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pedidos_created    ON pedidos      (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_created       ON chat_history (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_telegram      ON chat_history (telegram_chat_id, created_at ASC);
