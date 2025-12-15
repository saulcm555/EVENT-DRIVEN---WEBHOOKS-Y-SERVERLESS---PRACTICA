-- =========================================================
-- Script SQL para crear tabla webhook_subscribers en Supabase
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- =========================================================

-- Crear tabla de suscriptores de webhooks
CREATE TABLE IF NOT EXISTS webhook_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  target_url TEXT NOT NULL,
  -- Patrones de eventos como array JSONB
  -- Ejemplos: ["product.*"], ["order.confirmed", "order.cancelled"], ["*"]
  event_patterns JSONB NOT NULL DEFAULT '["*"]',
  is_active BOOLEAN NOT NULL DEFAULT true,
  -- Secret key individual por subscriber (opcional, usa WEBHOOK_SECRET si no está)
  secret_key VARCHAR(255),
  -- Metadata
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índice para consultas por is_active
CREATE INDEX IF NOT EXISTS idx_webhook_subscribers_active 
ON webhook_subscribers(is_active);

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_webhook_subscribers_updated_at
  BEFORE UPDATE ON webhook_subscribers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- Insertar suscriptores de ejemplo
-- =========================================================

-- Webhook Logger: recibe TODOS los eventos
INSERT INTO webhook_subscribers (name, target_url, event_patterns, is_active, description)
VALUES (
  'webhook-logger',
  'https://zjynrmbugltvupttaxqz.supabase.co/functions/v1/webhook-logger',
  '["*"]',
  true,
  'Logger de todos los eventos para auditoría'
) ON CONFLICT (name) DO UPDATE SET
  target_url = EXCLUDED.target_url,
  event_patterns = EXCLUDED.event_patterns,
  is_active = EXCLUDED.is_active;

-- Telegram Notifier: solo eventos de órdenes
INSERT INTO webhook_subscribers (name, target_url, event_patterns, is_active, description)
VALUES (
  'telegram-notifier',
  'https://zjynrmbugltvupttaxqz.supabase.co/functions/v1/telegram-notifier',
  '["order.confirmed", "order.cancelled", "product.stockReserved"]',
  true,
  'Notificador Telegram para eventos importantes'
) ON CONFLICT (name) DO UPDATE SET
  target_url = EXCLUDED.target_url,
  event_patterns = EXCLUDED.event_patterns,
  is_active = EXCLUDED.is_active;

-- =========================================================
-- Habilitar Row Level Security (RLS)
-- =========================================================

ALTER TABLE webhook_subscribers ENABLE ROW LEVEL SECURITY;

-- Política: permitir SELECT a usuarios autenticados y anon (para el servicio)
CREATE POLICY "Allow read access for service"
ON webhook_subscribers
FOR SELECT
USING (true);

-- Política: solo usuarios autenticados pueden INSERT/UPDATE/DELETE
CREATE POLICY "Allow full access for authenticated users"
ON webhook_subscribers
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- =========================================================
-- Queries útiles para pruebas
-- =========================================================

-- Ver todos los suscriptores activos
-- SELECT * FROM webhook_subscribers WHERE is_active = true;

-- Simular la query que hace el servicio
-- SELECT id, name, target_url, event_patterns, is_active, secret_key
-- FROM webhook_subscribers
-- WHERE is_active = true;

-- Desactivar un suscriptor
-- UPDATE webhook_subscribers SET is_active = false WHERE name = 'telegram-notifier';

-- Cambiar patrones de eventos
-- UPDATE webhook_subscribers 
-- SET event_patterns = '["order.*"]' 
-- WHERE name = 'telegram-notifier';
