-- ============================================================
-- OKAMI APP 2.0 — Migración de clientes
-- Genera la cartera inicial de clientes a partir de los
-- consentimientos históricos, deduplicando por RUT normalizado
-- y tomando los datos del consentimiento MÁS RECIENTE de cada uno.
--
-- 100% ADITIVO: la tabla consentimientos NO se modifica.
-- Idempotente: los RUT ya existentes en clientes se saltan.
-- Requiere haber ejecutado antes 001_okami_app_schema.sql
-- ============================================================

INSERT INTO clientes (rut, nombre, telefono, direccion, nacimiento, created_at)
SELECT DISTINCT ON (normalizar_rut(c.rut))
  normalizar_rut(c.rut),
  c.nombre,
  NULLIF(TRIM(c.telefono), ''),
  NULLIF(TRIM(c.direccion), ''),
  NULLIF(TRIM(c.nacimiento), ''),
  -- Fecha de "alta" = primer consentimiento de ese RUT
  (SELECT MIN(c2.created_at) FROM consentimientos c2
    WHERE normalizar_rut(c2.rut) = normalizar_rut(c.rut))
FROM consentimientos c
WHERE normalizar_rut(c.rut) <> ''
ORDER BY normalizar_rut(c.rut), c.created_at DESC NULLS LAST
ON CONFLICT (rut) DO NOTHING;

-- Verificación: cuántos clientes quedaron
SELECT COUNT(*) AS clientes_totales FROM clientes;
