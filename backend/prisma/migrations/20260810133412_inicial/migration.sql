-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "rol" AS ENUM ('ADMINISTRADOR', 'GERENTE', 'OPERARIO');

-- CreateEnum
CREATE TYPE "estado_usuario" AS ENUM ('ACTIVO', 'INACTIVO');

-- CreateEnum
CREATE TYPE "estado_producto" AS ENUM ('ACTIVO', 'INACTIVO');

-- CreateEnum
CREATE TYPE "estado_cliente" AS ENUM ('ACTIVO', 'INACTIVO');

-- CreateEnum
CREATE TYPE "estado_proyecto" AS ENUM ('ACTIVO', 'COMPLETADO', 'SUSPENDIDO');

-- CreateEnum
CREATE TYPE "estado_ingreso" AS ENUM ('PENDIENTE', 'RECIBIDO', 'VERIFICADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "estado_salida" AS ENUM ('PENDIENTE', 'CONFIRMADA', 'COMPLETADA', 'ANULADA');

-- CreateEnum
CREATE TYPE "tipo_movimiento" AS ENUM ('ENTRADA', 'SALIDA', 'AJUSTE_ENTRADA', 'AJUSTE_SALIDA');

-- CreateEnum
CREATE TYPE "documento_tipo" AS ENUM ('INGRESO', 'SALIDA');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" BIGSERIAL NOT NULL,
    "nombre_completo" VARCHAR(150) NOT NULL,
    "email" VARCHAR(150) NOT NULL,
    "login" VARCHAR(50) NOT NULL,
    "password_hash" VARCHAR(100) NOT NULL,
    "rol" "rol" NOT NULL,
    "estado" "estado_usuario" NOT NULL DEFAULT 'ACTIVO',
    "debe_cambiar_password" BOOLEAN NOT NULL DEFAULT true,
    "fecha_creacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario_creacion_id" BIGINT,
    "fecha_modificacion" TIMESTAMPTZ(6),
    "usuario_modificacion_id" BIGINT,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productos" (
    "id" BIGSERIAL NOT NULL,
    "sku" VARCHAR(50) NOT NULL,
    "descripcion" VARCHAR(300) NOT NULL,
    "ubicacion" VARCHAR(100),
    "umbral_stock_bajo" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "stock_actual" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "ultimo_costo" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "fecha_ultimo_movimiento" TIMESTAMPTZ(6),
    "estado" "estado_producto" NOT NULL DEFAULT 'ACTIVO',
    "fecha_creacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario_creacion_id" BIGINT NOT NULL,
    "fecha_modificacion" TIMESTAMPTZ(6),
    "usuario_modificacion_id" BIGINT,

    CONSTRAINT "productos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" BIGSERIAL NOT NULL,
    "nombre" VARCHAR(150) NOT NULL,
    "nit" VARCHAR(30) NOT NULL,
    "telefono" VARCHAR(30),
    "email" VARCHAR(150),
    "direccion" VARCHAR(200),
    "ciudad" VARCHAR(100),
    "fecha_registro" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" "estado_cliente" NOT NULL DEFAULT 'ACTIVO',
    "fecha_creacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario_creacion_id" BIGINT NOT NULL,
    "fecha_modificacion" TIMESTAMPTZ(6),
    "usuario_modificacion_id" BIGINT,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proyectos" (
    "id" BIGSERIAL NOT NULL,
    "cliente_id" BIGINT NOT NULL,
    "nombre" VARCHAR(150) NOT NULL,
    "descripcion" TEXT,
    "fecha_inicio" DATE,
    "fecha_cierre_estimada" DATE,
    "responsable" VARCHAR(150),
    "presupuesto_estimado" DECIMAL(14,2),
    "estado" "estado_proyecto" NOT NULL DEFAULT 'ACTIVO',
    "fecha_creacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario_creacion_id" BIGINT NOT NULL,
    "fecha_modificacion" TIMESTAMPTZ(6),
    "usuario_modificacion_id" BIGINT,

    CONSTRAINT "proyectos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingresos" (
    "id" BIGSERIAL NOT NULL,
    "numero_factura" VARCHAR(50) NOT NULL,
    "fecha_factura" DATE NOT NULL,
    "proveedor" VARCHAR(150) NOT NULL,
    "fecha_recepcion" DATE NOT NULL,
    "observaciones" TEXT,
    "estado" "estado_ingreso" NOT NULL DEFAULT 'PENDIENTE',
    "valor_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "usuario_registra_id" BIGINT NOT NULL,
    "motivo_anulacion" TEXT,
    "fecha_creacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario_creacion_id" BIGINT NOT NULL,
    "fecha_modificacion" TIMESTAMPTZ(6),
    "usuario_modificacion_id" BIGINT,

    CONSTRAINT "ingresos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "detalles_ingresos" (
    "id" BIGSERIAL NOT NULL,
    "ingreso_id" BIGINT NOT NULL,
    "producto_id" BIGINT NOT NULL,
    "cantidad" DECIMAL(12,2) NOT NULL,
    "precio_unitario" DECIMAL(14,2) NOT NULL,
    "valor_total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "detalles_ingresos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salidas" (
    "id" BIGSERIAL NOT NULL,
    "numero" BIGINT NOT NULL,
    "fecha_salida" DATE NOT NULL,
    "proyecto_id" BIGINT NOT NULL,
    "observaciones" TEXT,
    "estado" "estado_salida" NOT NULL DEFAULT 'PENDIENTE',
    "valor_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "usuario_autoriza_id" BIGINT,
    "fecha_confirmacion" TIMESTAMPTZ(6),
    "motivo_anulacion" TEXT,
    "fecha_creacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario_creacion_id" BIGINT NOT NULL,
    "fecha_modificacion" TIMESTAMPTZ(6),
    "usuario_modificacion_id" BIGINT,

    CONSTRAINT "salidas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "detalles_salidas" (
    "id" BIGSERIAL NOT NULL,
    "salida_id" BIGINT NOT NULL,
    "producto_id" BIGINT NOT NULL,
    "cantidad" DECIMAL(12,2) NOT NULL,
    "precio_unitario" DECIMAL(14,2) NOT NULL,
    "valor_total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "detalles_salidas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos_inventario" (
    "id" BIGSERIAL NOT NULL,
    "fecha_hora" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tipo" "tipo_movimiento" NOT NULL,
    "producto_id" BIGINT NOT NULL,
    "cantidad" DECIMAL(12,2) NOT NULL,
    "stock_resultante" DECIMAL(12,2) NOT NULL,
    "documento_tipo" "documento_tipo" NOT NULL,
    "documento_id" BIGINT NOT NULL,
    "proyecto_id" BIGINT,
    "usuario_id" BIGINT NOT NULL,
    "motivo" TEXT,

    CONSTRAINT "movimientos_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contadores" (
    "clave" VARCHAR(30) NOT NULL,
    "valor" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "contadores_pkey" PRIMARY KEY ("clave")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_login_key" ON "usuarios"("login");

-- CreateIndex
CREATE UNIQUE INDEX "productos_sku_key" ON "productos"("sku");

-- CreateIndex
CREATE INDEX "productos_descripcion_idx" ON "productos"("descripcion");

-- CreateIndex
CREATE INDEX "productos_estado_idx" ON "productos"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_nit_key" ON "clientes"("nit");

-- CreateIndex
CREATE INDEX "clientes_nombre_idx" ON "clientes"("nombre");

-- CreateIndex
CREATE INDEX "proyectos_cliente_id_estado_idx" ON "proyectos"("cliente_id", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "proyectos_cliente_id_nombre_key" ON "proyectos"("cliente_id", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "ingresos_numero_factura_key" ON "ingresos"("numero_factura");

-- CreateIndex
CREATE INDEX "ingresos_fecha_recepcion_idx" ON "ingresos"("fecha_recepcion");

-- CreateIndex
CREATE INDEX "ingresos_estado_idx" ON "ingresos"("estado");

-- CreateIndex
CREATE INDEX "detalles_ingresos_producto_id_idx" ON "detalles_ingresos"("producto_id");

-- CreateIndex
CREATE UNIQUE INDEX "detalles_ingresos_ingreso_id_producto_id_key" ON "detalles_ingresos"("ingreso_id", "producto_id");

-- CreateIndex
CREATE UNIQUE INDEX "salidas_numero_key" ON "salidas"("numero");

-- CreateIndex
CREATE INDEX "salidas_proyecto_id_estado_idx" ON "salidas"("proyecto_id", "estado");

-- CreateIndex
CREATE INDEX "salidas_fecha_salida_idx" ON "salidas"("fecha_salida");

-- CreateIndex
CREATE INDEX "salidas_estado_idx" ON "salidas"("estado");

-- CreateIndex
CREATE INDEX "detalles_salidas_producto_id_idx" ON "detalles_salidas"("producto_id");

-- CreateIndex
CREATE UNIQUE INDEX "detalles_salidas_salida_id_producto_id_key" ON "detalles_salidas"("salida_id", "producto_id");

-- CreateIndex
CREATE INDEX "movimientos_inventario_producto_id_fecha_hora_idx" ON "movimientos_inventario"("producto_id", "fecha_hora");

-- CreateIndex
CREATE INDEX "movimientos_inventario_documento_tipo_documento_id_idx" ON "movimientos_inventario"("documento_tipo", "documento_id");

-- CreateIndex
CREATE INDEX "movimientos_inventario_proyecto_id_idx" ON "movimientos_inventario"("proyecto_id");

-- CreateIndex
CREATE INDEX "movimientos_inventario_usuario_id_idx" ON "movimientos_inventario"("usuario_id");

-- CreateIndex
CREATE INDEX "movimientos_inventario_fecha_hora_idx" ON "movimientos_inventario"("fecha_hora");

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_usuario_creacion_id_fkey" FOREIGN KEY ("usuario_creacion_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_usuario_modificacion_id_fkey" FOREIGN KEY ("usuario_modificacion_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos" ADD CONSTRAINT "productos_usuario_creacion_id_fkey" FOREIGN KEY ("usuario_creacion_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos" ADD CONSTRAINT "productos_usuario_modificacion_id_fkey" FOREIGN KEY ("usuario_modificacion_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_usuario_creacion_id_fkey" FOREIGN KEY ("usuario_creacion_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_usuario_modificacion_id_fkey" FOREIGN KEY ("usuario_modificacion_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_usuario_creacion_id_fkey" FOREIGN KEY ("usuario_creacion_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_usuario_modificacion_id_fkey" FOREIGN KEY ("usuario_modificacion_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingresos" ADD CONSTRAINT "ingresos_usuario_registra_id_fkey" FOREIGN KEY ("usuario_registra_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingresos" ADD CONSTRAINT "ingresos_usuario_creacion_id_fkey" FOREIGN KEY ("usuario_creacion_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingresos" ADD CONSTRAINT "ingresos_usuario_modificacion_id_fkey" FOREIGN KEY ("usuario_modificacion_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalles_ingresos" ADD CONSTRAINT "detalles_ingresos_ingreso_id_fkey" FOREIGN KEY ("ingreso_id") REFERENCES "ingresos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalles_ingresos" ADD CONSTRAINT "detalles_ingresos_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salidas" ADD CONSTRAINT "salidas_proyecto_id_fkey" FOREIGN KEY ("proyecto_id") REFERENCES "proyectos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salidas" ADD CONSTRAINT "salidas_usuario_autoriza_id_fkey" FOREIGN KEY ("usuario_autoriza_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salidas" ADD CONSTRAINT "salidas_usuario_creacion_id_fkey" FOREIGN KEY ("usuario_creacion_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salidas" ADD CONSTRAINT "salidas_usuario_modificacion_id_fkey" FOREIGN KEY ("usuario_modificacion_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalles_salidas" ADD CONSTRAINT "detalles_salidas_salida_id_fkey" FOREIGN KEY ("salida_id") REFERENCES "salidas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalles_salidas" ADD CONSTRAINT "detalles_salidas_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_proyecto_id_fkey" FOREIGN KEY ("proyecto_id") REFERENCES "proyectos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- SQL crudo agregado a mano (tarea T009) — Prisma no genera lo siguiente:
--   1. CHECK constraints del invariante "stock nunca negativo" (Principio I) y de
--      cantidades/precios/presupuesto/fechas positivos y coherentes (Principio IV).
--   2. Trigger de inmutabilidad de movimientos_inventario (Principio II / FR-046).
--   3. Fila semilla de contadores('salida', 0) para el correlativo de salidas (research R5).
-- ============================================================================

-- CheckConstraint: productos.stock_actual nunca negativo — la RED FINAL de defensa del
-- invariante crítico del sistema (Principio I). Las mutaciones válidas ya lo garantizan
-- desde la UnidadDeTrabajo (SELECT ... FOR UPDATE + revalidación); este CHECK es lo que
-- impide que CUALQUIER camino (incluido un error de programación futuro) deje stock < 0.
ALTER TABLE "productos" ADD CONSTRAINT "productos_stock_actual_check" CHECK ("stock_actual" >= 0);

-- CheckConstraint: el umbral de alerta de stock bajo no puede ser negativo (FR-010/FR-022).
ALTER TABLE "productos" ADD CONSTRAINT "productos_umbral_stock_bajo_check" CHECK ("umbral_stock_bajo" >= 0);

-- CheckConstraint: líneas de ingreso — cantidad y precio unitario estrictamente positivos
-- (FR-016; un ingreso con cantidad o precio 0/negativo no es una operación real de compra).
ALTER TABLE "detalles_ingresos" ADD CONSTRAINT "detalles_ingresos_cantidad_check" CHECK ("cantidad" > 0);
ALTER TABLE "detalles_ingresos" ADD CONSTRAINT "detalles_ingresos_precio_unitario_check" CHECK ("precio_unitario" > 0);

-- CheckConstraint: líneas de salida — cantidad estrictamente positiva (FR-016); el precio
-- unitario es de referencia y SÍ admite 0 (supuesto documentado en data-model.md), a
-- diferencia del precio de compra en ingresos.
ALTER TABLE "detalles_salidas" ADD CONSTRAINT "detalles_salidas_cantidad_check" CHECK ("cantidad" > 0);
ALTER TABLE "detalles_salidas" ADD CONSTRAINT "detalles_salidas_precio_unitario_check" CHECK ("precio_unitario" >= 0);

-- CheckConstraint: presupuesto del proyecto, si existe, no puede ser negativo (base del
-- margen FR-040).
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_presupuesto_estimado_check" CHECK ("presupuesto_estimado" >= 0);

-- CheckConstraint: la fecha de cierre estimada no puede ser anterior al inicio del proyecto
-- cuando ambas fechas existen (NULL en cualquiera de las dos deja pasar la fila).
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_fechas_coherentes_check" CHECK (
    "fecha_cierre_estimada" IS NULL OR "fecha_inicio" IS NULL OR "fecha_cierre_estimada" >= "fecha_inicio"
);

-- CheckConstraint: todo movimiento de inventario mueve una cantidad estrictamente positiva;
-- el signo del efecto sobre stock_actual lo determina la columna "tipo", no el signo de
-- "cantidad" (data-model.md).
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_cantidad_check" CHECK ("cantidad" > 0);

-- ============================================================================
-- Trigger de inmutabilidad de movimientos_inventario (Principio II / FR-046)
--
-- movimientos_inventario es la bitácora permanente del sistema: una vez insertada una
-- fila, NADA puede modificarla ni borrarla — ni siquiera un script administrativo. Las
-- correcciones se hacen con movimientos de ajuste (AJUSTE_ENTRADA/AJUSTE_SALIDA) que
-- también quedan escritos para siempre. Este trigger es la garantía a nivel de BD: aunque
-- una futura versión del backend (o un acceso directo a la BD) intente UPDATE o DELETE,
-- PostgreSQL rechaza la operación completa con una excepción.
-- ============================================================================
CREATE OR REPLACE FUNCTION rechazar_modificacion_movimientos_inventario()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'movimientos_inventario es inmutable: no se permite % sobre esta tabla (FR-046)', TG_OP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER movimientos_inventario_inmutable
    BEFORE UPDATE OR DELETE ON "movimientos_inventario"
    FOR EACH ROW
    EXECUTE FUNCTION rechazar_modificacion_movimientos_inventario();

-- ============================================================================
-- Fila semilla del correlativo de salidas (research R5) — el puerto Contadores hace
-- `UPDATE contadores SET valor = valor + 1 WHERE clave = 'salida' RETURNING valor` dentro
-- de la transacción de creación de cada salida; sin esta fila ese UPDATE no afecta ninguna
-- fila y el correlativo nunca avanzaría.
-- ============================================================================
INSERT INTO "contadores" ("clave", "valor") VALUES ('salida', 0);

