-- ============================================================================
-- US12 (T124) — historial_costos_producto: el costo del producto se puede corregir, pero
-- nunca de forma anónima (FR-071…FR-074).
--
-- Fuente de verdad: specs/001-gestion-inventarios/data-model.md
-- (§ historial_costos_producto) y contracts/api-rest.md (§ Historial de costos del producto).
--
-- Migración INCREMENTAL y ADITIVA: crea un tipo, una tabla y un permiso nuevos. NO altera
-- ninguna tabla ni columna existente, así que no puede perder datos ni requiere `migrate
-- reset` (regla dura del proyecto).
--
-- POR QUÉ UNA TABLA PROPIA Y NO `movimientos_inventario` (FR-073) — la decisión central de
-- esta historia: un cambio de costo no mueve cantidades. Registrarlo como movimiento rompería
-- el invariante 2 de data-model.md (`stock_actual(p) = Σ movimientos(p)`), que es la base de
-- la prueba de conciliación y de la confianza en el inventario. Son dos historiales distintos
-- porque responden dos preguntas distintas: *cuánto hay y por qué* vs. *cuánto vale y desde
-- cuándo*.
-- ============================================================================

-- CreateEnum
CREATE TYPE "origen_cambio_costo" AS ENUM ('IMPORTACION', 'EDICION_MANUAL', 'RECEPCION_INGRESO');

-- CreateTable
CREATE TABLE "historial_costos_producto" (
    "id" BIGSERIAL NOT NULL,
    "producto_id" BIGINT NOT NULL,
    "costo_anterior" DECIMAL(14,2) NOT NULL,
    "costo_nuevo" DECIMAL(14,2) NOT NULL,
    "origen" "origen_cambio_costo" NOT NULL,
    "documento_id" BIGINT,
    "fecha_hora" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario_id" BIGINT NOT NULL,

    CONSTRAINT "historial_costos_producto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "historial_costos_producto_producto_id_fecha_hora_idx" ON "historial_costos_producto"("producto_id", "fecha_hora");

-- CreateIndex
CREATE INDEX "historial_costos_producto_usuario_id_idx" ON "historial_costos_producto"("usuario_id");

-- AddForeignKey
ALTER TABLE "historial_costos_producto" ADD CONSTRAINT "historial_costos_producto_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_costos_producto" ADD CONSTRAINT "historial_costos_producto_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- CHECK de dominio (data-model.md § historial_costos_producto) — Prisma no los genera
-- declarativamente, igual que los de la migración inicial (T009). Un costo negativo no existe
-- como hecho de negocio; esta es la red final por debajo de la validación Zod y del dominio.
-- `costo_anterior` también se acota: la fila es un par (de dónde venía, a dónde fue) y ninguno
-- de los dos extremos puede ser negativo.
-- ============================================================================
ALTER TABLE "historial_costos_producto"
    ADD CONSTRAINT "historial_costos_producto_costos_no_negativos"
    CHECK ("costo_nuevo" >= 0 AND "costo_anterior" >= 0);

-- Un registro cuyo costo nuevo es igual al anterior no es un cambio: sería ruido en la ficha
-- del producto y contradiría FR-074 ("un costo se considera cambiado solo si difiere del
-- actual"). La regla vive en el dominio (`aplicarCambioDeCosto`); esto la hace imposible de
-- violar aunque un camino futuro se saltara ese servicio.
ALTER TABLE "historial_costos_producto"
    ADD CONSTRAINT "historial_costos_producto_cambio_real"
    CHECK ("costo_nuevo" <> "costo_anterior");

-- ============================================================================
-- INMUTABILIDAD (Principio II) — mismo trigger que protege `movimientos_inventario` desde la
-- migración inicial: la tabla solo admite INSERT. Un historial que se puede editar no es un
-- historial; si el costo se corrigió mal, se corrige otra vez y quedan las dos filas.
-- ============================================================================
CREATE OR REPLACE FUNCTION rechazar_modificacion_historial_costos_producto()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'historial_costos_producto es inmutable: no se permite % sobre esta tabla (FR-072)', TG_OP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER historial_costos_producto_inmutable
    BEFORE UPDATE OR DELETE ON "historial_costos_producto"
    FOR EACH ROW
    EXECUTE FUNCTION rechazar_modificacion_historial_costos_producto();

-- ============================================================================
-- Permiso nuevo del catálogo (US9/FR-056: un permiso por cada verificación real del código).
-- Lo consume `GET /api/inventario/:productoId/historial-costos`, que el contrato reserva a
-- Administrador y Gerente — por eso NO se cuelga de `inventario.ver`, que los tres roles del
-- sistema tienen (incluido Operario): el costo y su evolución son información de valorización,
-- mismo alcance que `reportes.ver`.
--
-- La matriz se puebla igual que en la migración de US9 (T099): Administrador y Gerente lo
-- reciben; Operario no. `prisma/seed.ts` reproduce este mismo catálogo de forma idempotente y
-- es quien lo mantiene al día en una base recreada desde cero.
-- ============================================================================
INSERT INTO "permisos" ("clave", "modulo", "descripcion") VALUES
    ('inventario.ver_costos', 'inventario', 'Consultar el historial de cambios de costo de un producto.');

INSERT INTO "roles_permisos" ("rol_id", "permiso_id")
SELECT r."id", p."id"
FROM "roles" r CROSS JOIN "permisos" p
WHERE r."nombre" IN ('Administrador', 'Gerente')
  AND p."clave" = 'inventario.ver_costos';
