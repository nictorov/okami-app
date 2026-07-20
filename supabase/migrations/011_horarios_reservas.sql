-- ============================================================
-- OKAMI APP 2.0 — Migración 011: horarios en reservas y sesiones
-- ADITIVO e idempotente (solo toca tablas propias de la APP 2.0).
--
-- Full / Compartido pueden agendar "todo el día" (como hasta ahora)
-- o con horario (hora inicio–fin), para que dos colegas compartan
-- un puesto en el mismo día (mañana / tarde).
--
--  * reservas.hora_inicio / hora_fin: NULL = día completo.
--  * sesiones.hora_fin: NULL = todo el día (full/comp) o sin fin (rotativo).
--  * El índice único (1 reserva activa por puesto+fecha+bloque) se
--    reemplaza por una restricción de exclusión: rechaza reservas
--    activas cuyos horarios se TOPEN, pero permite las que no.
--    (Día completo se trata como 00:00–24:00.)
-- ============================================================

ALTER TABLE reservas ADD COLUMN IF NOT EXISTS hora_inicio TIME;
ALTER TABLE reservas ADD COLUMN IF NOT EXISTS hora_fin TIME;
ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS hora_fin TIME;

-- Requerida para combinar igualdad (uuid/fecha/texto) con rangos
CREATE EXTENSION IF NOT EXISTS btree_gist;

DROP INDEX IF EXISTS idx_reservas_unicas;
CREATE INDEX IF NOT EXISTS idx_reservas_puesto_fecha ON reservas (puesto_id, fecha);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservas_sin_tope'
  ) THEN
    ALTER TABLE reservas ADD CONSTRAINT reservas_sin_tope EXCLUDE USING gist (
      puesto_id WITH =,
      fecha WITH =,
      bloque WITH =,
      int4range(
        (EXTRACT(EPOCH FROM COALESCE(hora_inicio, '00:00'::time)) / 60)::int,
        (EXTRACT(EPOCH FROM COALESCE(hora_fin,   '24:00'::time)) / 60)::int
      ) WITH &&
    ) WHERE (estado = 'activa');
  END IF;
END $$;
