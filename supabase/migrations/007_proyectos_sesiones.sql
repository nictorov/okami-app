-- ============================================================
-- OKAMI APP 2.0 — Migración 007: Proyectos y Sesiones
-- ADITIVO e idempotente. Reemplaza (en la interfaz) el modelo
-- cotizaciones/atenciones por Proyectos con una o más Sesiones.
-- Las tablas antiguas NO se tocan: quedan como histórico.
--
-- Operación:
--  * Un proyecto de tatuaje tiene cliente (provisorio o real),
--    tatuador, descripción y 1..N sesiones con fecha y dinero.
--  * El día de la sesión el cliente firma su consentimiento y el
--    tatuador lo asocia a la sesión; los datos del consentimiento
--    sobreescriben los datos provisorios del cliente.
--  * Propiedad del cliente: si el proyecto lo agenda el tatuador
--    directo (sin Okami), el cliente queda asociado a su cuenta
--    (clientes.tatuador_id). Si vino de Okami, queda en el registro
--    general sin dueño.
-- ============================================================

-- Dueño del cliente (tatuador que lo agendó directo; NULL = del estudio)
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS tatuador_id UUID REFERENCES tatuadores(id);

-- Folio de proyectos: PRY-AAAA-NNNN
CREATE TABLE IF NOT EXISTS proyecto_counter (
  id INTEGER PRIMARY KEY DEFAULT 1,
  ultimo_numero INTEGER DEFAULT 0,
  CONSTRAINT pry_solo_una_fila CHECK (id = 1)
);
INSERT INTO proyecto_counter (id, ultimo_numero) VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION next_folio_proyecto()
RETURNS TEXT AS $$
DECLARE
  nuevo_numero INTEGER;
BEGIN
  UPDATE proyecto_counter SET ultimo_numero = ultimo_numero + 1 WHERE id = 1
  RETURNING ultimo_numero INTO nuevo_numero;
  RETURN 'PRY-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(nuevo_numero::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- PROYECTOS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proyectos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  folio TEXT UNIQUE NOT NULL,
  cliente_id UUID REFERENCES clientes(id),
  tatuador_id UUID NOT NULL REFERENCES tatuadores(id),
  creado_por TEXT DEFAULT 'tatuador' CHECK (creado_por IN ('tatuador', 'host', 'admin')),
  -- ¿Llegó desde una cotización del estudio Okami?
  -- (host/admin siempre true; el tatuador lo marca manualmente)
  desde_okami BOOLEAN DEFAULT FALSE,
  -- Descripción del proyecto
  descripcion TEXT,
  estilo_id UUID REFERENCES estilos(id),
  a_color BOOLEAN,
  zona TEXT,
  tamano TEXT,
  comentarios TEXT,
  estado TEXT DEFAULT 'activo' CHECK (estado IN ('activo', 'completado', 'cancelado')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proyectos_tatuador ON proyectos (tatuador_id);
CREATE INDEX IF NOT EXISTS idx_proyectos_cliente ON proyectos (cliente_id);

-- ------------------------------------------------------------
-- SESIONES
-- Estados:
--   espera_consentimiento  → agendada, aún sin consentimiento firmado
--   consentimiento_firmado → firmado, sesión en curso / por cerrar
--   completada / incompleta / cancelada → cierre
-- Reglas de 24 h (aplicadas por la app al cargar):
--   * consentimiento asociado sin firmar por 24 h → cancelada
--   * firmado sin cierre seleccionado por 24 h    → completada
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sesiones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  proyecto_id UUID NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  tatuador_id UUID NOT NULL REFERENCES tatuadores(id),
  numero INTEGER DEFAULT 1,
  inicio TIMESTAMPTZ NOT NULL,
  puesto_id UUID REFERENCES puestos(id),
  -- Dinero de la sesión
  valor INTEGER DEFAULT 0,          -- valor total de la sesión (CLP)
  abono INTEGER DEFAULT 0,          -- monto de abono (sugerido 50%)
  abonado BOOLEAN DEFAULT FALSE,    -- ¿el abono ya se pagó?
  -- Consentimiento
  consentimiento_id UUID REFERENCES consentimientos(id),
  consentimiento_asociado_en TIMESTAMPTZ,
  consentimiento_firmado_en TIMESTAMPTZ,
  -- Estado y cierre
  estado TEXT DEFAULT 'espera_consentimiento' CHECK (estado IN
    ('espera_consentimiento', 'consentimiento_firmado', 'completada', 'incompleta', 'cancelada')),
  observacion TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sesiones_inicio ON sesiones (inicio);
CREATE INDEX IF NOT EXISTS idx_sesiones_tatuador ON sesiones (tatuador_id);
CREATE INDEX IF NOT EXISTS idx_sesiones_proyecto ON sesiones (proyecto_id);
CREATE INDEX IF NOT EXISTS idx_sesiones_estado ON sesiones (estado);

-- ------------------------------------------------------------
-- Seguridad (RLS): mismo patrón del proyecto
-- ------------------------------------------------------------
ALTER TABLE proyecto_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE proyectos ENABLE ROW LEVEL SECURITY;
ALTER TABLE sesiones ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['proyecto_counter', 'proyectos', 'sesiones'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
        AND policyname = 'acceso_publico_' || t
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL USING (true) WITH CHECK (true)',
        'acceso_publico_' || t, t
      );
    END IF;
  END LOOP;
END $$;
