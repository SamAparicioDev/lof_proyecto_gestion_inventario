-- ============================================================================
-- US13 (T132) — índices de soporte de los filtros de listado nuevos (FR-075/FR-076).
--
-- Fuente de verdad: specs/001-gestion-inventarios/data-model.md (§ Índices) y
-- contracts/api-rest.md (§ Inventario, § Salidas).
--
-- Migración INCREMENTAL y ADITIVA: solo crea índices. No toca una sola columna, no reescribe
-- datos y no requiere `migrate reset` (regla dura del proyecto). Es reversible con un DROP INDEX.
--
-- POR QUÉ SOLO ESTOS TRES (el resto de filtros nuevos queda justificado por escrito en
-- data-model.md § Índices y medido en rendimiento.md § (g) — ninguno se omitió en silencio):
--
--  * `salidas.usuario_autoriza_id` — el filtro "¿qué autorizó esta persona?" corre sobre una
--    tabla que CRECE con la operación diaria (un documento por despacho). Sin índice sería un
--    Seq Scan permanente y evitable; con él se replica exactamente el criterio con el que ya
--    existe `movimientos_inventario.usuario_id` desde la migración inicial, para el mismo tipo
--    de pregunta en el reporte de movimientos (FR-042).
--
--  * `productos.categoria` / `productos.ubicacion` — sirven DOS consultas distintas: la igualdad
--    del filtro y el `SELECT DISTINCT` que alimenta su selector (FR-076), que sin índice recorre
--    el catálogo completo en cada carga de la pantalla de inventario. `productos` es la tabla que
--    más crece del catálogo (spec.md § Assumptions: miles de productos).
--
-- Los tres son índices COMPLETOS y no parciales (`WHERE col IS NOT NULL`) pese a que las tres
-- columnas son nullable y las filas nulas nunca son respuesta de estos filtros: un índice parcial
-- no se puede declarar en `schema.prisma`, y dejarlo solo en SQL desincronizaría el esquema de la
-- base (el siguiente `migrate dev` propondría eliminarlo). El ahorro de espacio no compensa
-- romper la correspondencia esquema↔base, que es lo que hace confiables a las migraciones.
-- ============================================================================

-- CreateIndex
CREATE INDEX "salidas_usuario_autoriza_id_idx" ON "salidas"("usuario_autoriza_id");

-- CreateIndex
CREATE INDEX "productos_categoria_idx" ON "productos"("categoria");

-- CreateIndex
CREATE INDEX "productos_ubicacion_idx" ON "productos"("ubicacion");
