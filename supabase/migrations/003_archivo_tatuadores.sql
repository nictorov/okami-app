-- ============================================================
-- OKAMI APP 2.0 — Migración 003: archivo de tatuadores
-- ADITIVO e idempotente: solo agrega 3 columnas a tatuadores.
--
-- archivado = salió del estudio; se conserva toda su info e
--             historial, pero no es parte del plantel.
-- eliminado = oculto totalmente de la plataforma (NUNCA se borra
--             de la base de datos; sus atenciones, consentimientos
--             y balances históricos siguen intactos).
-- ============================================================

ALTER TABLE tatuadores ADD COLUMN IF NOT EXISTS archivado BOOLEAN DEFAULT FALSE;
ALTER TABLE tatuadores ADD COLUMN IF NOT EXISTS eliminado BOOLEAN DEFAULT FALSE;
ALTER TABLE tatuadores ADD COLUMN IF NOT EXISTS archivado_en TIMESTAMPTZ;
