-- US15 (T145) — La categoría de producto deja de ser texto libre y pasa a ser un CATÁLOGO.
--
-- FR-084 (catálogo administrable), FR-085 (unicidad ignorando mayúsculas y espacios),
-- FR-086 (sigue siendo opcional), FR-087 (no se borra si está en uso), FR-089 (la migración
-- NO pierde la clasificación existente).
--
-- El ORDEN de esta migración es lo que garantiza FR-089, así que no se reordena:
--   1. crear la tabla,
--   2. sembrarla con los valores de texto que YA existen en productos,
--   3. añadir la FK vacía,
--   4. rellenarla emparejando por nombre normalizado,
--   5. y SOLO ENTONCES eliminar la columna vieja.
-- Invertir 5 con 4 borraría la clasificación de todo el inventario sin recuperación posible.

-- ---------------------------------------------------------------------------
-- 1. Catálogo
-- ---------------------------------------------------------------------------
CREATE TYPE "estado_categoria" AS ENUM ('ACTIVA', 'INACTIVA');

CREATE TABLE "categorias" (
    "id"                      BIGSERIAL NOT NULL,
    "nombre"                  VARCHAR(100) NOT NULL,
    "descripcion"             VARCHAR(300),
    "estado"                  "estado_categoria" NOT NULL DEFAULT 'ACTIVA',
    "fecha_creacion"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario_creacion_id"     BIGINT NOT NULL,
    "fecha_modificacion"      TIMESTAMPTZ(6),
    "usuario_modificacion_id" BIGINT,

    CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

-- Unicidad FUNCIONAL, no literal (FR-085): un UNIQUE(nombre) normal dejaría convivir
-- 'Ferretería', 'ferreteria' y 'FERRETERIA ', que es justo el problema que US15 resuelve.
-- Aquí es la red final: vale aunque alguien inserte por SQL, saltándose la aplicación.
CREATE UNIQUE INDEX "categorias_nombre_normalizado_key" ON "categorias" (lower(btrim("nombre")));
CREATE INDEX "categorias_estado_idx" ON "categorias" ("estado");

ALTER TABLE "categorias"
    ADD CONSTRAINT "categorias_usuario_creacion_id_fkey"
        FOREIGN KEY ("usuario_creacion_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "categorias_usuario_modificacion_id_fkey"
        FOREIGN KEY ("usuario_modificacion_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Sembrar el catálogo con lo que ya está escrito en los productos (FR-089)
-- ---------------------------------------------------------------------------
-- Se agrupa por nombre NORMALIZADO: así 'Ferretería' y 'ferreteria ' colapsan en UNA sola
-- categoría, que es la corrección que persigue la historia. Como representante se toma
-- `MIN(btrim(categoria))`, un criterio determinista (no "el primero que salga").
--
-- La auditoría apunta al usuario más antiguo del sistema: estas filas no las creó una persona
-- en la aplicación, las creó esta migración, y `usuario_creacion_id` es NOT NULL en todas las
-- tablas del modelo. Dejarlo apuntando al administrador semilla es lo más fiel disponible.
INSERT INTO "categorias" ("nombre", "usuario_creacion_id")
SELECT MIN(btrim(p."categoria")) AS nombre,
       (SELECT MIN(u."id") FROM "usuarios" u)
FROM "productos" p
WHERE p."categoria" IS NOT NULL AND btrim(p."categoria") <> ''
GROUP BY lower(btrim(p."categoria"));

-- ---------------------------------------------------------------------------
-- 3. y 4. La FK en productos, ya rellena
-- ---------------------------------------------------------------------------
ALTER TABLE "productos" ADD COLUMN "categoria_id" BIGINT;

UPDATE "productos" p
SET "categoria_id" = c."id"
FROM "categorias" c
WHERE p."categoria" IS NOT NULL
  AND lower(btrim(p."categoria")) = lower(btrim(c."nombre"));

ALTER TABLE "productos"
    ADD CONSTRAINT "productos_categoria_id_fkey"
        FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 5. Retirar el texto libre
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "productos_categoria_idx";
ALTER TABLE "productos" DROP COLUMN "categoria";

CREATE INDEX "productos_categoria_id_idx" ON "productos" ("categoria_id");
