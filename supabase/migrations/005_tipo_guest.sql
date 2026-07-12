-- ============================================================
-- OKAMI APP 2.0 — Migración 005: tipo "guest"
-- Amplía el check de tipo_puesto (creado en la migración 004)
-- para permitir tatuadores guest: no son del plantel, pero
-- visitan el estudio cada cierto tiempo y quedan registrados.
-- Idempotente y sin tocar datos.
-- ============================================================

ALTER TABLE tatuadores DROP CONSTRAINT IF EXISTS tatuadores_tipo_puesto_check;
ALTER TABLE tatuadores ADD CONSTRAINT tatuadores_tipo_puesto_check
  CHECK (tipo_puesto IN ('full', 'compartido', 'rotativo', 'guest'));
