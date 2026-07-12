-- ============================================================
-- OKAMI APP 2.0 — Migración 006: tipos de atención y derivaciones
-- ADITIVO e idempotente.
--
-- Tipos de atención (cómo llegó el cliente):
--   agenda_privada   : el tatuador gestionó todo por fuera; solo hay
--                      consentimiento. La atención se genera desde él.
--   agenda_okami     : cotización directa al tatuador, gestionada con
--                      la herramienta del estudio.
--   desde_okami      : el estudio derivó el contacto al tatuador
--                      (stand-by) y este concretó la atención.
--   cotizacion_okami : el estudio recibió, cotizó y asignó.
-- ============================================================

-- Tipo de atención
ALTER TABLE atenciones ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'agenda_privada';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'atenciones_tipo_check') THEN
    ALTER TABLE atenciones ADD CONSTRAINT atenciones_tipo_check
      CHECK (tipo IN ('agenda_privada', 'agenda_okami', 'desde_okami', 'cotizacion_okami'));
  END IF;
END $$;

-- Total de sesiones planificadas (sesion_numero ya existe)
ALTER TABLE atenciones ADD COLUMN IF NOT EXISTS sesiones_total INTEGER DEFAULT 1;

-- Derivaciones (reenvío de contacto al tatuador, queda stand-by)
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS derivada BOOLEAN DEFAULT FALSE;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS contacto_instagram TEXT;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS contacto_email TEXT;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS contacto_telefono TEXT;
