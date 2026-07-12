-- ============================================================
-- OKAMI APP 2.0 — Schema Fase 1
-- Ejecutar en: supabase.com → proyecto okami-consentimientos → SQL Editor
--
-- IMPORTANTE: Este script es 100% ADITIVO.
--   * No modifica ni elimina ninguna tabla, columna, función o
--     política existente (consentimientos, tatuadores, vitrina_*,
--     store_*, proveedores, tv_okami siguen intactas).
--   * Solo agrega columnas nuevas (IF NOT EXISTS) y tablas nuevas.
--   * Es idempotente: se puede ejecutar más de una vez sin error.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Utilidad: normalizar RUT (quita puntos/guión, mayúscula K)
--    Sirve para cruzar clientes ↔ consentimientos aunque el
--    formato de escritura difiera.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION normalizar_rut(rut_input TEXT)
RETURNS TEXT AS $$
  SELECT UPPER(REGEXP_REPLACE(COALESCE(rut_input, ''), '[^0-9kK]', '', 'g'));
$$ LANGUAGE sql IMMUTABLE;

-- Índice por RUT normalizado sobre consentimientos (solo índice, no altera datos)
CREATE INDEX IF NOT EXISTS idx_consentimientos_rut_norm
  ON consentimientos (normalizar_rut(rut));

-- ------------------------------------------------------------
-- 1. Extensión de TATUADORES (columnas nuevas, aditivas)
-- ------------------------------------------------------------
ALTER TABLE tatuadores ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE tatuadores ADD COLUMN IF NOT EXISTS instagram TEXT;
-- ¿Recibe cotizaciones que llegan al estudio? (reparto justo)
ALTER TABLE tatuadores ADD COLUMN IF NOT EXISTS participa_cotizaciones BOOLEAN DEFAULT FALSE;
-- ¿Acepta seguimiento en el sistema? (los que no, igual existen para consentimientos)
ALTER TABLE tatuadores ADD COLUMN IF NOT EXISTS en_sistema BOOLEAN DEFAULT FALSE;
-- Integración futura Google Calendar (Fase 4)
ALTER TABLE tatuadores ADD COLUMN IF NOT EXISTS google_calendar_id TEXT;
-- Documentación sanitaria: fecha de vencimiento (NULL = no presentada)
ALTER TABLE tatuadores ADD COLUMN IF NOT EXISTS vacunacion_vence DATE;
ALTER TABLE tatuadores ADD COLUMN IF NOT EXISTS asepsia_vence DATE;
ALTER TABLE tatuadores ADD COLUMN IF NOT EXISTS notas TEXT;

-- ------------------------------------------------------------
-- 2. Catálogo de ESTILOS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS estilos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  orden INTEGER DEFAULT 0,
  activo BOOLEAN DEFAULT TRUE
);

INSERT INTO estilos (nombre, orden) VALUES
  ('Realismo', 1), ('Blackwork', 2), ('Fine Line', 3),
  ('Tradicional', 4), ('Neotradicional', 5), ('Japonés', 6),
  ('Lettering', 7), ('Geométrico', 8), ('Acuarela', 9),
  ('Puntillismo', 10), ('Anime / Manga', 11), ('Old School', 12)
ON CONFLICT (nombre) DO NOTHING;

-- Estilos que domina cada tatuador, con nivel (alimenta el reparto justo)
CREATE TABLE IF NOT EXISTS tatuador_estilos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tatuador_id UUID NOT NULL REFERENCES tatuadores(id) ON DELETE CASCADE,
  estilo_id UUID NOT NULL REFERENCES estilos(id) ON DELETE CASCADE,
  nivel INTEGER NOT NULL DEFAULT 3 CHECK (nivel BETWEEN 1 AND 5),
  maneja_color BOOLEAN DEFAULT TRUE,
  UNIQUE (tatuador_id, estilo_id)
);

-- ------------------------------------------------------------
-- 3. CLIENTES (cartera unificada; se puebla desde consentimientos
--    con la migración 002)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clientes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  rut TEXT UNIQUE,                    -- normalizado con normalizar_rut()
  nombre TEXT NOT NULL,
  telefono TEXT,
  email TEXT,
  direccion TEXT,
  nacimiento TEXT,
  instagram TEXT,
  como_nos_conocio TEXT,              -- instagram / recomendación / walk-in / otro
  marketing_ok BOOLEAN DEFAULT FALSE, -- consintió recibir comunicaciones
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clientes_nombre ON clientes (LOWER(nombre));

-- ------------------------------------------------------------
-- 4. COTIZACIONES (embudo: nueva → ... → atendida / perdida)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cotizacion_counter (
  id INTEGER PRIMARY KEY DEFAULT 1,
  ultimo_numero INTEGER DEFAULT 0,
  CONSTRAINT cot_solo_una_fila CHECK (id = 1)
);
INSERT INTO cotizacion_counter (id, ultimo_numero) VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION next_folio_cotizacion()
RETURNS TEXT AS $$
DECLARE
  nuevo_numero INTEGER;
BEGIN
  UPDATE cotizacion_counter SET ultimo_numero = ultimo_numero + 1 WHERE id = 1
  RETURNING ultimo_numero INTO nuevo_numero;
  RETURN 'COT-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(nuevo_numero::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS cotizaciones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  folio TEXT UNIQUE NOT NULL,
  -- Quién cotiza: cliente registrado o prospecto (solo nombre/contacto)
  cliente_id UUID REFERENCES clientes(id),
  contacto_nombre TEXT,
  contacto_medio TEXT,                -- teléfono / instagram / email del prospecto
  -- Origen del pedido
  origen TEXT DEFAULT 'estudio' CHECK (origen IN
    ('estudio', 'directa_tatuador', 'instagram', 'walk_in', 'web', 'otro')),
  -- Qué quiere
  descripcion TEXT,
  zona TEXT,
  tamano TEXT,                        -- ej: "10x15 cm" o chico/mediano/grande
  estilo_id UUID REFERENCES estilos(id),
  a_color BOOLEAN,
  referencias TEXT[],                 -- URLs de imágenes de referencia
  -- Respuesta
  precio_cotizado INTEGER,            -- CLP
  sesiones_estimadas INTEGER DEFAULT 1,
  tatuador_id UUID REFERENCES tatuadores(id),
  estado TEXT DEFAULT 'nueva' CHECK (estado IN
    ('nueva', 'asignada', 'cotizada', 'aceptada', 'agendada', 'atendida', 'perdida')),
  motivo_perdida TEXT,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_estado ON cotizaciones (estado);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_tatuador ON cotizaciones (tatuador_id);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_created ON cotizaciones (created_at);

-- ------------------------------------------------------------
-- 5. PUESTOS (15 en el estudio)
--    gestionado = false → tatuador no participa del sistema:
--    el panel lo muestra GRIS ("fuera del sistema")
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS puestos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,        -- ej: "Puesto 1"
  tipo TEXT DEFAULT 'rotativo' CHECK (tipo IN ('full', 'compartido', 'rotativo')),
  gestionado BOOLEAN DEFAULT TRUE,
  activo BOOLEAN DEFAULT TRUE,
  orden INTEGER DEFAULT 0,
  notas TEXT
);

-- Titulares fijos (para puestos full: 1 tatuador; compartido: 2)
CREATE TABLE IF NOT EXISTS puesto_titulares (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  puesto_id UUID NOT NULL REFERENCES puestos(id) ON DELETE CASCADE,
  tatuador_id UUID NOT NULL REFERENCES tatuadores(id) ON DELETE CASCADE,
  UNIQUE (puesto_id, tatuador_id)
);

-- Asignaciones día a día (para puestos rotativos que maneja el admin)
CREATE TABLE IF NOT EXISTS puesto_asignaciones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  puesto_id UUID NOT NULL REFERENCES puestos(id) ON DELETE CASCADE,
  tatuador_id UUID NOT NULL REFERENCES tatuadores(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  bloque TEXT DEFAULT 'dia' CHECK (bloque IN ('dia', 'am', 'pm')),
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (puesto_id, fecha, bloque)
);

CREATE INDEX IF NOT EXISTS idx_puesto_asig_fecha ON puesto_asignaciones (fecha);

-- Los 15 puestos iniciales (edítalos desde la app: nombre, tipo, titulares)
INSERT INTO puestos (nombre, orden)
SELECT 'Puesto ' || n, n FROM generate_series(1, 15) AS n
ON CONFLICT (nombre) DO NOTHING;

-- ------------------------------------------------------------
-- 6. ATENCIONES
--    El consentimiento se firma JUSTO ANTES de tatuar, por lo que
--    consentimiento_id parte NULL y se vincula cuando el cliente
--    firma (flujo: agendada → en_curso → completada;
--    salidas: cancelada / no_show).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atenciones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cotizacion_id UUID REFERENCES cotizaciones(id),
  cliente_id UUID REFERENCES clientes(id),
  tatuador_id UUID NOT NULL REFERENCES tatuadores(id),
  consentimiento_id UUID REFERENCES consentimientos(id),  -- se vincula al firmar
  puesto_id UUID REFERENCES puestos(id),
  -- Agenda
  inicio TIMESTAMPTZ NOT NULL,
  fin TIMESTAMPTZ,
  sesion_numero INTEGER DEFAULT 1,    -- proyectos multi-sesión
  -- Dinero
  precio_final INTEGER,               -- CLP
  metodo_pago TEXT,                   -- efectivo / transferencia / tarjeta / otro
  abono INTEGER DEFAULT 0,
  comision_estudio INTEGER,           -- CLP que queda para el estudio
  monto_tatuador INTEGER,             -- CLP que recibe el tatuador
  -- Costos (base para el futuro analytics de tatuadores — sin front aún)
  costo_insumos INTEGER DEFAULT 0,    -- suma cacheada de atencion_insumos
  costo_otros INTEGER DEFAULT 0,
  -- Estado
  estado TEXT DEFAULT 'agendada' CHECK (estado IN
    ('agendada', 'en_curso', 'completada', 'cancelada', 'no_show')),
  cancelada_en TIMESTAMPTZ,
  cancelada_por TEXT CHECK (cancelada_por IN ('cliente', 'tatuador', 'estudio')),
  motivo_cancelacion TEXT,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_atenciones_inicio ON atenciones (inicio);
CREATE INDEX IF NOT EXISTS idx_atenciones_estado ON atenciones (estado);
CREATE INDEX IF NOT EXISTS idx_atenciones_tatuador ON atenciones (tatuador_id);
CREATE INDEX IF NOT EXISTS idx_atenciones_puesto ON atenciones (puesto_id);

-- Insumos utilizados por atención (reutiliza el catálogo de la vitrina;
-- costo_unitario se congela al momento de uso)
CREATE TABLE IF NOT EXISTS atencion_insumos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  atencion_id UUID NOT NULL REFERENCES atenciones(id) ON DELETE CASCADE,
  producto_id UUID REFERENCES vitrina_products(id),
  descripcion TEXT,                   -- para insumos fuera del catálogo
  cantidad NUMERIC NOT NULL DEFAULT 1,
  costo_unitario INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 7. AGENDA propia por tatuador (Google Calendar llega en Fase 4)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agenda_bloques (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tatuador_id UUID NOT NULL REFERENCES tatuadores(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  hora_inicio TIME NOT NULL DEFAULT '11:00',
  hora_fin TIME NOT NULL DEFAULT '20:00',
  disponible BOOLEAN DEFAULT TRUE,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agenda_fecha ON agenda_bloques (fecha, tatuador_id);

-- ------------------------------------------------------------
-- 8. Seguridad (RLS): mismo patrón que el resto del proyecto.
--    NOTA: acceso público vía anon key, protegido a nivel de app.
--    Pendiente endurecer con Supabase Auth en una fase posterior.
-- ------------------------------------------------------------
ALTER TABLE estilos ENABLE ROW LEVEL SECURITY;
ALTER TABLE tatuador_estilos ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE cotizacion_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE cotizaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE puestos ENABLE ROW LEVEL SECURITY;
ALTER TABLE puesto_titulares ENABLE ROW LEVEL SECURITY;
ALTER TABLE puesto_asignaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE atenciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE atencion_insumos ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_bloques ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'estilos', 'tatuador_estilos', 'clientes', 'cotizacion_counter',
    'cotizaciones', 'puestos', 'puesto_titulares', 'puesto_asignaciones',
    'atenciones', 'atencion_insumos', 'agenda_bloques'
  ] LOOP
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
