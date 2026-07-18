-- ============================================================
-- OKAMI APP 2.0 — Migración 009: Reparaciones + datos para Analytics
-- ADITIVO e idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- Reparaciones: tickets de los tatuadores (lámparas, camillas…)
-- Flujo: enviada → respondida → resuelta / cancelada
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reparaciones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tatuador_id UUID NOT NULL REFERENCES tatuadores(id),
  solicitud TEXT NOT NULL,
  respuesta TEXT,
  respondida_por TEXT,                -- 'admin' | 'host'
  estado TEXT DEFAULT 'enviada' CHECK (estado IN
    ('enviada', 'respondida', 'resuelta', 'cancelada')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reparaciones_estado ON reparaciones (estado);
CREATE INDEX IF NOT EXISTS idx_reparaciones_tatuador ON reparaciones (tatuador_id);

ALTER TABLE reparaciones ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reparaciones'
      AND policyname = 'acceso_publico_reparaciones'
  ) THEN
    CREATE POLICY acceso_publico_reparaciones ON reparaciones FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ------------------------------------------------------------
-- Analytics: fecha en que se pagó el abono (para el gráfico de
-- ingresos diarios; las sesiones antiguas sin fecha usan su inicio)
-- ------------------------------------------------------------
ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS abonado_en TIMESTAMPTZ;

-- ------------------------------------------------------------
-- Analytics: género del cliente (se captura opcionalmente en el
-- consentimiento y se copia a la ficha del cliente)
-- ------------------------------------------------------------
ALTER TABLE consentimientos ADD COLUMN IF NOT EXISTS genero TEXT;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS genero TEXT;
