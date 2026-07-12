-- ============================================================
-- OKAMI APP 2.0 — Migración 008: Reservas de puesto
-- ADITIVO e idempotente.
--
-- Una reserva bloquea un puesto en una fecha (día completo de
-- lunes a viernes; turno AM o PM los fines de semana).
--  * Puestos full y compartidos: calendario propio del puesto.
--  * Puestos rotativos: un solo calendario con cupos "Día 1..n"
--    (n = puestos rotativos activos); cada cupo corresponde a un
--    puesto físico que queda bloqueado al reservar.
--  * Cancelación: hasta el mismo día en semana; los fines de
--    semana con 1 día de anticipación (regla aplicada por la app).
-- ============================================================

CREATE TABLE IF NOT EXISTS reservas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fecha DATE NOT NULL,
  bloque TEXT DEFAULT 'dia' CHECK (bloque IN ('dia', 'am', 'pm')),
  puesto_id UUID NOT NULL REFERENCES puestos(id),
  tatuador_id UUID NOT NULL REFERENCES tatuadores(id),
  creada_por TEXT DEFAULT 'tatuador' CHECK (creada_por IN ('tatuador', 'host', 'admin')),
  estado TEXT DEFAULT 'activa' CHECK (estado IN ('activa', 'cancelada')),
  cancelada_en TIMESTAMPTZ,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Un puesto solo puede tener UNA reserva activa por fecha+bloque
CREATE UNIQUE INDEX IF NOT EXISTS idx_reservas_unicas
  ON reservas (puesto_id, fecha, bloque) WHERE estado = 'activa';

CREATE INDEX IF NOT EXISTS idx_reservas_fecha ON reservas (fecha);
CREATE INDEX IF NOT EXISTS idx_reservas_tatuador ON reservas (tatuador_id);

ALTER TABLE reservas ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reservas'
      AND policyname = 'acceso_publico_reservas'
  ) THEN
    CREATE POLICY acceso_publico_reservas ON reservas FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
