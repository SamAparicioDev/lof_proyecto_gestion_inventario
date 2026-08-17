-- US21 (T198) — Cotizaciones: la oferta que hoy se hace fuera del sistema.
--
-- FR-112 (documento con correlativo propio, cliente/proyecto del catálogo y líneas con IVA),
-- FR-113 (NUNCA mueve inventario), FR-114 (solo editable en BORRADOR), FR-115 (aceptarla genera
-- una salida pendiente enlazada), FR-117 (permisos).
--
-- Es el espejo exacto de `20260815030000_ordenes_compra` mirando al cliente en vez de al
-- proveedor, y por eso repite sus decisiones: correlativo BIGINT (el formato "COT-000042" es
-- presentación), `CHECK` en la base como red final, y el vínculo con el documento que la surte
-- —aquí `salidas.cotizacion_id`, allí `ingresos.orden_compra_id`— NULL a propósito, porque una
-- salida se sigue registrando sin cotización previa.
--
-- Lo propio de esta tabla: las líneas nacen ya con las columnas de IVA de US20, porque una
-- oferta a un cliente sin impuesto no es un precio que se pueda cerrar.

-- ---------------------------------------------------------------------------
-- 1. La cotización
-- ---------------------------------------------------------------------------
CREATE TYPE "estado_cotizacion" AS ENUM ('BORRADOR', 'ENVIADA', 'ACEPTADA', 'RECHAZADA', 'ANULADA');

CREATE TABLE "cotizaciones" (
    "id"                      BIGSERIAL NOT NULL,
    "numero"                  BIGINT NOT NULL,
    "cliente_id"              BIGINT NOT NULL,
    "proyecto_id"             BIGINT NOT NULL,
    "fecha"                   DATE NOT NULL,
    -- Hasta cuándo se sostiene el precio ofrecido. "Vencida" NO es un estado: se deriva
    -- comparando con la fecha de hoy, porque un estado exigiría que alguien —o un proceso
    -- programado— lo marcara, y una cotización no deja de estar enviada por caducar.
    "fecha_validez"           DATE NOT NULL,
    "observaciones"           TEXT,
    "estado"                  "estado_cotizacion" NOT NULL DEFAULT 'BORRADOR',
    -- Base gravable, mismo significado que en el resto de documentos (US20).
    "valor_total"             DECIMAL(14,2) NOT NULL DEFAULT 0,
    "valor_iva"               DECIMAL(14,2) NOT NULL DEFAULT 0,
    "motivo_anulacion"        TEXT,
    "fecha_creacion"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario_creacion_id"     BIGINT NOT NULL,
    "fecha_modificacion"      TIMESTAMPTZ(6),
    "usuario_modificacion_id" BIGINT,

    CONSTRAINT "cotizaciones_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cotizaciones_valor_iva_check" CHECK ("valor_iva" >= 0),
    -- La validez no puede ser anterior a la propia oferta: sería un documento nacido vencido.
    CONSTRAINT "cotizaciones_validez_check" CHECK ("fecha_validez" >= "fecha")
);

CREATE UNIQUE INDEX "cotizaciones_numero_key" ON "cotizaciones" ("numero");
-- El compuesto responde la pregunta del módulo: "¿qué le ofrecí a este cliente y en qué quedó?".
CREATE INDEX "cotizaciones_cliente_id_estado_idx" ON "cotizaciones" ("cliente_id", "estado");
CREATE INDEX "cotizaciones_proyecto_id_idx" ON "cotizaciones" ("proyecto_id");
CREATE INDEX "cotizaciones_fecha_idx" ON "cotizaciones" ("fecha");
CREATE INDEX "cotizaciones_estado_idx" ON "cotizaciones" ("estado");

ALTER TABLE "cotizaciones"
    ADD CONSTRAINT "cotizaciones_cliente_id_fkey"
        FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "cotizaciones_proyecto_id_fkey"
        FOREIGN KEY ("proyecto_id") REFERENCES "proyectos"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "cotizaciones_usuario_creacion_id_fkey"
        FOREIGN KEY ("usuario_creacion_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "cotizaciones_usuario_modificacion_id_fkey"
        FOREIGN KEY ("usuario_modificacion_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Sus líneas — con IVA desde el primer día (US20, FR-109)
-- ---------------------------------------------------------------------------
CREATE TABLE "detalles_cotizaciones" (
    "id"              BIGSERIAL NOT NULL,
    "cotizacion_id"   BIGINT NOT NULL,
    "producto_id"     BIGINT NOT NULL,
    "cantidad"        DECIMAL(12,2) NOT NULL,
    "precio_unitario" DECIMAL(14,2) NOT NULL,
    "valor_total"     DECIMAL(14,2) NOT NULL,
    "tasa_iva"        DECIMAL(5,2) NOT NULL DEFAULT 0,
    "valor_iva"       DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "detalles_cotizaciones_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "detalles_cotizaciones_cantidad_check" CHECK ("cantidad" > 0),
    CONSTRAINT "detalles_cotizaciones_precio_check" CHECK ("precio_unitario" > 0),
    CONSTRAINT "detalles_cotizaciones_tasa_iva_check" CHECK ("tasa_iva" IN (0, 5, 19)),
    CONSTRAINT "detalles_cotizaciones_valor_iva_check" CHECK ("valor_iva" >= 0)
);

CREATE UNIQUE INDEX "detalles_cotizaciones_cotizacion_producto_key"
    ON "detalles_cotizaciones" ("cotizacion_id", "producto_id");
CREATE INDEX "detalles_cotizaciones_producto_id_idx" ON "detalles_cotizaciones" ("producto_id");

ALTER TABLE "detalles_cotizaciones"
    -- CASCADE: solo se ejerce mientras la cotización es BORRADOR (FR-114).
    ADD CONSTRAINT "detalles_cotizaciones_cotizacion_id_fkey"
        FOREIGN KEY ("cotizacion_id") REFERENCES "cotizaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "detalles_cotizaciones_producto_id_fkey"
        FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. El vínculo con la salida que nace al aceptarla (FR-115)
-- ---------------------------------------------------------------------------
-- NULL a propósito: una salida se sigue registrando sin cotización previa, que es como funcionó
-- el sistema hasta esta historia.
ALTER TABLE "salidas" ADD COLUMN "cotizacion_id" BIGINT;

ALTER TABLE "salidas"
    ADD CONSTRAINT "salidas_cotizacion_id_fkey"
        FOREIGN KEY ("cotizacion_id") REFERENCES "cotizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "salidas_cotizacion_id_idx" ON "salidas" ("cotizacion_id");

-- ---------------------------------------------------------------------------
-- 4. El correlativo (FR-112)
-- ---------------------------------------------------------------------------
-- La fila debe existir ANTES del primer uso: `UPDATE ... RETURNING` sobre una clave inexistente
-- no afecta ninguna fila y el caso de uso no tendría número que asignar (research R5).
INSERT INTO "contadores" ("clave", "valor")
VALUES ('cotizacion', 0)
ON CONFLICT ("clave") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Permisos (FR-117)
-- ---------------------------------------------------------------------------
-- Van en la MIGRACIÓN y no solo en el seed: en producción nadie ejecuta la semilla —crearía un
-- usuario con contraseña conocida—, así que sin esto los endpoints nuevos responderían 403 con
-- el código correcto. Es la lección de `20260815040000_permisos_categorias`.
INSERT INTO "permisos" ("clave", "modulo", "descripcion") VALUES
    ('cotizaciones.ver',     'cotizaciones', 'Consultar las cotizaciones y su detalle.'),
    ('cotizaciones.crear',   'cotizaciones', 'Crear cotizaciones en borrador.'),
    ('cotizaciones.editar',  'cotizaciones', 'Editar una cotización mientras sigue en borrador.'),
    ('cotizaciones.enviar',  'cotizaciones', 'Marcar una cotización como enviada al cliente: compromete el precio ofrecido.'),
    ('cotizaciones.cerrar',  'cotizaciones', 'Registrar la respuesta del cliente: aceptar (genera la salida) o rechazar.'),
    ('cotizaciones.anular',  'cotizaciones', 'Anular una cotización indicando el motivo.')
ON CONFLICT ("clave") DO NOTHING;

-- Matriz rol → permiso (FR-059/FR-117), mismo criterio que las órdenes de compra: los TRES roles
-- arman la oferta —quien atiende al cliente es quien la prepara—, y las tres acciones que la
-- comprometen frente a un tercero o generan una salida quedan en Administrador y Gerente.
INSERT INTO "roles_permisos" ("rol_id", "permiso_id")
SELECT r."id", p."id"
FROM "roles" r CROSS JOIN "permisos" p
WHERE r."nombre" IN ('Administrador', 'Gerente', 'Operario')
  AND p."clave" IN ('cotizaciones.ver', 'cotizaciones.crear', 'cotizaciones.editar')
ON CONFLICT DO NOTHING;

INSERT INTO "roles_permisos" ("rol_id", "permiso_id")
SELECT r."id", p."id"
FROM "roles" r CROSS JOIN "permisos" p
WHERE r."nombre" IN ('Administrador', 'Gerente')
  AND p."clave" IN ('cotizaciones.enviar', 'cotizaciones.cerrar', 'cotizaciones.anular')
ON CONFLICT DO NOTHING;
