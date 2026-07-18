-- ============================================================
-- OKAMI APP 2.0 — Migración 010: arriendos de tatuadores
-- ADITIVO e idempotente.
--
-- Montos por tipo (editables por tatuador):
--   full        → $220.000 mensual
--   compartido  → $120.000 mensual
--   rotativo    → $12.000 por día/turno reservado; $20.000 si reserva
--                 ambos turnos de un finde; mínimo mensual $60.000
--                 (arriendo_monto guarda ese mínimo)
--   guest       → sin monto fijo ("Tarifas guest"): $15.000 día/turno,
--                 $25.000 día completo de finde; con 5+ días en el mes
--                 baja a la tarifa rotativa ($12.000 / $20.000)
-- ============================================================

ALTER TABLE tatuadores ADD COLUMN IF NOT EXISTS arriendo_monto INTEGER;

-- Asignación inicial según tipo (solo a quienes no tienen monto)
UPDATE tatuadores SET arriendo_monto = CASE (tipo_puesto)
    WHEN 'full' THEN 220000
    WHEN 'compartido' THEN 120000
    WHEN 'guest' THEN NULL
    ELSE 60000
  END
WHERE arriendo_monto IS NULL AND (tipo_puesto IS DISTINCT FROM 'guest');
