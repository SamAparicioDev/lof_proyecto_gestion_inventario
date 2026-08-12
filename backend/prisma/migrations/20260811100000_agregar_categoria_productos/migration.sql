-- AlterTable
-- Agrega la columna "categoria" al catálogo de productos (US8, FR-052) — texto libre,
-- opcional, mismo criterio que "ubicacion" (sin catálogo propio de categorías en v1).
-- Ver specs/001-gestion-inventarios/data-model.md § productos.
ALTER TABLE "productos" ADD COLUMN "categoria" VARCHAR(100);
