-- ============================================================
-- OKAMI APP 2.0 — Migración 004: tipo de puesto del tatuador
-- ADITIVO e idempotente: agrega 1 columna a tatuadores.
--
-- full / compartido / rotativo: determina en qué tipo de puesto
-- puede ser asignado cada tatuador.
-- ============================================================

ALTER TABLE tatuadores ADD COLUMN IF NOT EXISTS tipo_puesto TEXT DEFAULT 'rotativo';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tatuadores_tipo_puesto_check'
  ) THEN
    ALTER TABLE tatuadores ADD CONSTRAINT tatuadores_tipo_puesto_check
      CHECK (tipo_puesto IN ('full', 'compartido', 'rotativo'));
  END IF;
END $$;
