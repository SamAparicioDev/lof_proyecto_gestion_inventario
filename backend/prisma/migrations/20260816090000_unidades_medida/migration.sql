-- US17 (T177) — La unidad de medida de un producto pasa a ser un CATÁLOGO.
--
-- FR-101 (catálogo administrable con nombre y abreviatura, ambos únicos), FR-102 (obligatoria al
-- dar de alta un producto), FR-103 (los productos anteriores se quedan sin ella y el sistema
-- sigue operando con normalidad).
--
-- La FK es NULLABLE Y ESO ES EL PUNTO DE LA HISTORIA: hay productos cargados desde hace meses y
-- nadie sabe hoy en qué se miden. Un `NOT NULL` habría exigido inventarles una unidad aquí
-- —"unidad" para todo, probablemente— y ese dato inventado sería indistinguible después de uno
-- real. La obligatoriedad vive en la APLICACIÓN: alta y edición la exigen, así que el catálogo
-- se limpia con el uso y cada unidad que aparezca la habrá decidido una persona.

-- ---------------------------------------------------------------------------
-- 1. El catálogo
-- ---------------------------------------------------------------------------
CREATE TYPE "estado_unidad_medida" AS ENUM ('ACTIVA', 'INACTIVA');

CREATE TABLE "unidades_medida" (
    "id"                      BIGSERIAL NOT NULL,
    "nombre"                  VARCHAR(60) NOT NULL,
    -- Corta a propósito: es lo que se imprime junto a una cantidad en una celda de tabla.
    "abreviatura"             VARCHAR(10) NOT NULL,
    "estado"                  "estado_unidad_medida" NOT NULL DEFAULT 'ACTIVA',
    "fecha_creacion"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario_creacion_id"     BIGINT,
    "fecha_modificacion"      TIMESTAMPTZ(6),
    "usuario_modificacion_id" BIGINT,

    CONSTRAINT "unidades_medida_pkey" PRIMARY KEY ("id")
);

-- DOS unicidades funcionales, no una (FR-101). El nombre por el mismo motivo que en los otros
-- catálogos; la abreviatura porque dos unidades que se abrevien igual serían indistinguibles
-- justo donde más importa: en una tabla de cantidades, que es donde solo cabe la abreviatura.
CREATE UNIQUE INDEX "unidades_medida_nombre_normalizado_key" ON "unidades_medida" (lower(btrim("nombre")));
CREATE UNIQUE INDEX "unidades_medida_abreviatura_normalizada_key" ON "unidades_medida" (lower(btrim("abreviatura")));
CREATE INDEX "unidades_medida_estado_idx" ON "unidades_medida" ("estado");

-- `usuario_creacion_id` es NULLABLE aquí, a diferencia del resto de catálogos: las unidades
-- iniciales de más abajo las crea ESTA migración, que corre antes de que exista ningún usuario
-- en una base nueva. `NULL` significa "vino con el sistema", que es la verdad.
ALTER TABLE "unidades_medida"
    ADD CONSTRAINT "unidades_medida_usuario_creacion_id_fkey"
        FOREIGN KEY ("usuario_creacion_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "unidades_medida_usuario_modificacion_id_fkey"
        FOREIGN KEY ("usuario_modificacion_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. La referencia desde productos (FR-102/FR-103)
-- ---------------------------------------------------------------------------
ALTER TABLE "productos" ADD COLUMN "unidad_medida_id" BIGINT;

ALTER TABLE "productos"
    ADD CONSTRAINT "productos_unidad_medida_id_fkey"
        FOREIGN KEY ("unidad_medida_id") REFERENCES "unidades_medida"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "productos_unidad_medida_id_idx" ON "productos" ("unidad_medida_id");

-- ---------------------------------------------------------------------------
-- 3. Unidades iniciales
-- ---------------------------------------------------------------------------
-- Sin esto, dar de alta un producto sería IMPOSIBLE hasta que alguien entrara a Administración a
-- inventar la primera unidad — un sistema recién desplegado en el que no se puede crear un
-- producto. Son las unidades de uso general del negocio (mercancía por piezas, peso, longitud,
-- volumen y empaque); las que no sirvan se desactivan o se borran, que para eso el catálogo es
-- administrable.
INSERT INTO "unidades_medida" ("nombre", "abreviatura") VALUES
    ('Unidad',      'und'),
    ('Kilogramo',   'kg'),
    ('Gramo',       'g'),
    ('Tonelada',    't'),
    ('Litro',       'L'),
    ('Mililitro',   'mL'),
    ('Metro',       'm'),
    ('Centímetro',  'cm'),
    ('Metro cuadrado', 'm2'),
    ('Metro cúbico', 'm3'),
    ('Caja',        'caja'),
    ('Paquete',     'paq'),
    ('Rollo',       'rollo'),
    ('Galón',       'gal'),
    ('Bulto',       'bulto')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Permisos del catálogo
-- ---------------------------------------------------------------------------
-- Van en la migración además del seed porque la semilla NO se ejecuta en producción (crearía un
-- usuario con contraseña conocida): sin esto, los endpoints nuevos responderían 403 con el
-- código correcto. Ver `test/unit/permisos-en-migraciones.spec.ts`, que lo verifica solo.
INSERT INTO "permisos" ("clave", "modulo", "descripcion") VALUES
    ('unidades_medida.ver',       'unidades_medida', 'Consultar las unidades de medida para dar de alta productos.'),
    ('unidades_medida.gestionar', 'unidades_medida', 'Administrar el catálogo de unidades de medida: alta, edición y estado.')
ON CONFLICT ("clave") DO NOTHING;

-- VER lo tienen los TRES roles: los tres pueden crear productos (`productos.crear`), y desde
-- US17 no se puede crear uno sin elegir su unidad.
INSERT INTO "roles_permisos" ("rol_id", "permiso_id")
SELECT r."id", p."id"
FROM "roles" r CROSS JOIN "permisos" p
WHERE r."nombre" IN ('Administrador', 'Gerente', 'Operario')
  AND p."clave" = 'unidades_medida.ver'
ON CONFLICT DO NOTHING;

INSERT INTO "roles_permisos" ("rol_id", "permiso_id")
SELECT r."id", p."id"
FROM "roles" r CROSS JOIN "permisos" p
WHERE r."nombre" IN ('Administrador', 'Gerente')
  AND p."clave" = 'unidades_medida.gestionar'
ON CONFLICT DO NOTHING;
