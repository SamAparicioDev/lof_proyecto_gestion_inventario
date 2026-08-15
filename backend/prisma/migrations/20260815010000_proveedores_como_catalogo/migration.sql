-- US15 (T157) — El proveedor de un ingreso deja de ser texto libre y pasa a ser un CATÁLOGO.
--
-- FR-091 (mismas reglas que las categorías, pero el proveedor es OBLIGATORIO en un ingreso),
-- FR-092 (la migración no pierde ningún proveedor ya escrito), FR-093 (el proveedor que usa la
-- carga masiva es "del sistema" y no se puede borrar ni renombrar).
--
-- Mismo orden deliberado que la migración de categorías: crear → sembrar desde los datos
-- existentes → añadir la FK vacía → rellenar → recién entonces exigir NOT NULL y retirar el
-- texto. Aquí el `SET NOT NULL` es además la comprobación de que el relleno fue COMPLETO: si
-- algún ingreso se hubiera quedado sin emparejar, la migración falla en ese punto y no se
-- aplica nada, en vez de dejar ingresos huérfanos de proveedor.

-- ---------------------------------------------------------------------------
-- 1. Catálogo
-- ---------------------------------------------------------------------------
CREATE TYPE "estado_proveedor" AS ENUM ('ACTIVO', 'INACTIVO');

CREATE TABLE "proveedores" (
    "id"                      BIGSERIAL NOT NULL,
    "nombre"                  VARCHAR(150) NOT NULL,
    "nit"                     VARCHAR(20),
    "telefono"                VARCHAR(30),
    "email"                   VARCHAR(150),
    "estado"                  "estado_proveedor" NOT NULL DEFAULT 'ACTIVO',
    -- FR-093: el proveedor sintético de la carga masiva. Protegido igual que los roles semilla
    -- (FR-059): el proceso automático de importación depende de que exista con ese nombre.
    "es_sistema"              BOOLEAN NOT NULL DEFAULT false,
    "fecha_creacion"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario_creacion_id"     BIGINT NOT NULL,
    "fecha_modificacion"      TIMESTAMPTZ(6),
    "usuario_modificacion_id" BIGINT,

    CONSTRAINT "proveedores_pkey" PRIMARY KEY ("id")
);

-- Unicidad FUNCIONAL (FR-091, mismo criterio que categorías): 'Cementos S.A.' y 'cementos s.a. '
-- son el mismo proveedor, y la base de datos es la red final aunque se inserte por SQL.
CREATE UNIQUE INDEX "proveedores_nombre_normalizado_key" ON "proveedores" (lower(btrim("nombre")));
CREATE INDEX "proveedores_estado_idx" ON "proveedores" ("estado");

ALTER TABLE "proveedores"
    ADD CONSTRAINT "proveedores_usuario_creacion_id_fkey"
        FOREIGN KEY ("usuario_creacion_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "proveedores_usuario_modificacion_id_fkey"
        FOREIGN KEY ("usuario_modificacion_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Sembrar el catálogo con los proveedores ya escritos en los ingresos (FR-092)
-- ---------------------------------------------------------------------------
INSERT INTO "proveedores" ("nombre", "usuario_creacion_id")
SELECT MIN(btrim(i."proveedor")) AS nombre,
       (SELECT MIN(u."id") FROM "usuarios" u)
FROM "ingresos" i
WHERE btrim(i."proveedor") <> ''
GROUP BY lower(btrim(i."proveedor"));

-- El proveedor de la carga masiva debe existir en toda base YA EN USO (FR-093). Si ya entró en
-- el paso anterior (porque alguna importación lo usó), solo se marca más abajo.
--
-- El `EXISTS (SELECT 1 FROM usuarios)` no es defensivo por costumbre: en una base RECIÉN CREADA
-- las migraciones corren ANTES de la semilla (`prisma migrate deploy` al arrancar el backend,
-- ver backend/Dockerfile), así que no hay ningún usuario al que apuntar y este INSERT violaría
-- `usuario_creacion_id NOT NULL` — la migración fallaría y la aplicación no levantaría. En ese
-- caso no hay nada que preservar: la fila la crea la semilla, que es quien crea al administrador
-- (`sembrarProveedorDelSistema`, backend/prisma/seed.ts).
INSERT INTO "proveedores" ("nombre", "es_sistema", "usuario_creacion_id")
SELECT 'Carga masiva de inventario', true, (SELECT MIN(u."id") FROM "usuarios" u)
WHERE EXISTS (SELECT 1 FROM "usuarios")
  AND NOT EXISTS (
    SELECT 1 FROM "proveedores" p WHERE lower(btrim(p."nombre")) = 'carga masiva de inventario'
);

UPDATE "proveedores" SET "es_sistema" = true
WHERE lower(btrim("nombre")) = 'carga masiva de inventario';

-- ---------------------------------------------------------------------------
-- 3. y 4. La FK en ingresos, ya rellena
-- ---------------------------------------------------------------------------
ALTER TABLE "ingresos" ADD COLUMN "proveedor_id" BIGINT;

UPDATE "ingresos" i
SET "proveedor_id" = p."id"
FROM "proveedores" p
WHERE lower(btrim(i."proveedor")) = lower(btrim(p."nombre"));

-- Si algo quedó sin emparejar, esto aborta la migración entera. Es intencionado: un ingreso sin
-- proveedor no es trazable, y es preferible no migrar a migrar dejando huecos.
ALTER TABLE "ingresos" ALTER COLUMN "proveedor_id" SET NOT NULL;

ALTER TABLE "ingresos"
    ADD CONSTRAINT "ingresos_proveedor_id_fkey"
        FOREIGN KEY ("proveedor_id") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 5. Retirar el texto libre
-- ---------------------------------------------------------------------------
ALTER TABLE "ingresos" DROP COLUMN "proveedor";

CREATE INDEX "ingresos_proveedor_id_idx" ON "ingresos" ("proveedor_id");
