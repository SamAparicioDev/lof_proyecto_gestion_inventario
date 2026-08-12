-- ============================================================================
-- US11 (T118) — logo del cliente: la identidad visual de la empresa a la que corresponde un
-- documento exportado (FR-066…FR-069).
--
-- Fuente de verdad: specs/001-gestion-inventarios/data-model.md (§ Logo del cliente) y
-- contracts/api-rest.md (§ Exportación de procesos y logo del cliente).
--
-- Migración INCREMENTAL y ADITIVA: agrega DOS columnas nullable a `clientes` y sus CHECK. NO
-- reescribe ninguna columna existente, no borra datos y no requiere `migrate reset` (regla dura
-- del proyecto). Todo cliente ya registrado queda con `logo IS NULL`, que es exactamente el
-- estado "sin logo cargado" que FR-067 exige que NUNCA impida ni degrade una exportación.
--
-- POR QUÉ EN LA BASE Y NO EN DISCO (data-model.md § Logo del cliente): son imágenes pequeñas
-- (tope 500 KB) y así el logo viaja con el respaldo de la base, sin coordinar un segundo almacén
-- ni rutas de archivo entre entornos (Principio V — la alternativa solo se justifica con
-- volúmenes muy superiores).
-- ============================================================================

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN "logo" BYTEA;
ALTER TABLE "clientes" ADD COLUMN "logo_tipo_mime" VARCHAR(30);

-- ============================================================================
-- CHECK de dominio (data-model.md § Logo del cliente) — Prisma no los genera declarativamente,
-- igual que los de la migración inicial (T009).
-- ============================================================================

-- "`logo` y `logo_tipo_mime` son consistentes entre sí: o ambos con valor, o ambos NULL".
-- Sin esto podrían existir bytes sin su tipo (imposible servirlos con el Content-Type correcto)
-- o un tipo sin bytes (un cliente que "tiene logo" y no lo tiene).
ALTER TABLE "clientes"
    ADD CONSTRAINT "clientes_logo_consistente"
    CHECK (("logo" IS NULL) = ("logo_tipo_mime" IS NULL));

-- PNG/JPEG ÚNICAMENTE, NUNCA SVG (data-model.md): un SVG es un documento XML que puede contener
-- scripts, y servirlo desde el mismo origen de la aplicación sería una vía de XSS. La validación
-- REAL ocurre sobre los BYTES del archivo (`dominio/servicios/servicio-imagen-logo.ts`, números
-- mágicos — nunca la extensión ni el `Content-Type` que declare el navegador, que el cliente
-- controla y puede mentir); este CHECK es la red final por debajo de esa validación, para que
-- ningún camino futuro pueda persistir aquí un tipo que el endpoint de lectura no deba servir.
ALTER TABLE "clientes"
    ADD CONSTRAINT "clientes_logo_tipo_mime_admitido"
    CHECK ("logo_tipo_mime" IS NULL OR "logo_tipo_mime" IN ('image/png', 'image/jpeg'));
