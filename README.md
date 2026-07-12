# Okami APP 2.0

Aplicación de gestión integral del Estudio Okami: tatuadores, clientes,
cotizaciones, atenciones, puestos y consentimientos informados.

Uso interno del estudio (mostrador/tablet), protegida con PIN.

## Arquitectura

- **Next.js + TypeScript + Supabase** — mismo stack y **misma base de datos**
  que `okami-consentimientos`. Las tablas nuevas referencian las existentes
  (`tatuadores`, `consentimientos`, `vitrina_products`) por foreign key.
- Los cambios a la base son **100% aditivos**: solo tablas nuevas y columnas
  nuevas. Las apps existentes (consentimientos, tienda, store) no se ven
  afectadas.

## Módulos

| Módulo | Estado | Descripción |
|---|---|---|
| Panel del día | ✅ Fase 1 | Semáforo de 15 puestos: 🟢 libre · 🟡 reservado · 🔴 en uso · ⚪ gris fuera del sistema. Alertas de documentación. |
| Puestos | ✅ Fase 1 | Tipo (full / compartido / rotativo), titulares fijos, asignación día a día. |
| Tatuadores | ✅ Fase 1 | Ficha extendida: estilos con nivel 1–5, docs sanitarios, participación en cotizaciones. |
| Clientes | ✅ Fase 1 | Cartera unificada (migrada desde consentimientos), búsqueda, historial. |
| Cotizaciones | ✅ Fase 2 | Embudo completo (nueva → asignada → cotizada → aceptada → agendada → atendida / perdida) + asignador justo por estilo y carga 30d. |
| Atenciones | ✅ Fase 2 | Agendamiento (desde cotización o walk-in), vínculo con consentimiento firmado, cierre con comisión, cancelaciones y no-show. |
| Estadísticas | 🔜 Fase 3 | Precios, conversión, ingresos, frecuencia de clientes. |
| Google Calendar | 🔜 Fase 4 | Cada tatuador conecta su calendario para ver disponibilidad real. |
| Consentimientos | ✅ | Los 3 módulos copiados de la app original e integrados: `/consentimiento/cliente` (público, prellena desde la cartera y crea/actualiza la ficha del cliente), `/consentimiento/tatuador` (público, al firmar vincula o genera la atención) y `/consentimiento/admin` (registro mensual + export PDF, solo Admin). Escriben en la MISMA tabla `consentimientos` que la app original: folios únicos compartidos, sin necesidad de fusionar tablas después. |

## Instalación

1. **Base de datos** — en supabase.com → proyecto → SQL Editor, ejecutar en orden:
   - `supabase/migrations/001_okami_app_schema.sql` (schema nuevo, idempotente)
   - `supabase/migrations/002_migrar_clientes.sql` (importa clientes desde los consentimientos históricos, deduplicando por RUT)

2. **App**:
   ```bash
   cp .env.local.example .env.local   # rellenar con credenciales de Supabase + PIN
   npm install
   npm run dev
   ```

3. **Deploy en Vercel**: igual que okami-consentimientos, agregando las tres
   variables de entorno (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `NEXT_PUBLIC_APP_PIN`).

## Roles (vistas separadas)

| Rol | Entra con | Ve |
|---|---|---|
| **Admin** | `NEXT_PUBLIC_APP_PIN` | Todo + links a las 3 vistas de consentimientos (/cliente, /tatuador, /admin) |
| **Tatuador** | Su PIN personal (`tatuadores.pin`) | Sus cotizaciones (auto-asignadas, puesto propio o rotativos), sus atenciones, sus clientes con su propio historial + link consentimiento tatuador |
| **Host (recepción)** | `NEXT_PUBLIC_HOST_PIN` | Panel, cotizaciones, atenciones del día sin montos (privacidad), puestos + link consentimiento clientes |

## Tipos de atención (cómo llegó el cliente)

| Tipo | Flujo |
|---|---|
| **Agenda privada** | El tatuador gestionó todo por fuera; solo existe el consentimiento. Desde "Consentimientos de hoy sin atención" se genera cliente + atención. |
| **Agenda Okami** | Cotización directa al tatuador gestionada con la herramienta (el tatuador la crea en su vista). |
| **Desde Okami** | El estudio derivó el contacto (stand-by con instagram/email/teléfono) y el tatuador concretó. |
| **Cotización Okami** | El estudio recibió, cotizó, asignó y agendó. |

## Decisiones de diseño

- **Consentimiento después de agendar**: la atención se crea sin consentimiento;
  `atenciones.consentimiento_id` se vincula cuando el cliente firma, justo antes
  de tatuar.
- **Puestos fuera del sistema**: `puestos.gestionado = false` → gris en el panel.
  Tatuadores que no participan pueden igual tener seguimiento voluntario
  (`tatuadores.en_sistema`).
- **Costos por atención**: `atencion_insumos` (FK a `vitrina_products`, costo
  congelado al momento de uso) + `costo_insumos`/`costo_otros` en `atenciones`.
  Sin front todavía — es la base del futuro analytics para tatuadores.
- **RUT normalizado**: `clientes.rut` se guarda sin puntos ni guión
  (función SQL `normalizar_rut`), para cruzar con `consentimientos` sin
  depender del formato de escritura.

## Seguridad (pendiente endurecer)

Las tablas usan políticas RLS de acceso público con la anon key, igual que el
resto del proyecto. La app se protege con PIN a nivel de interfaz. Para una
fase posterior: migrar a Supabase Auth con usuarios reales y políticas RLS
restrictivas.
