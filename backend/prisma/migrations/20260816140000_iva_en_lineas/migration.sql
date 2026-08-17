-- ============================================================================================
-- US20 (T193) — IVA por línea en los documentos con precios (FR-109…FR-111).
--
-- Tres columnas nuevas por documento y ni un solo valor histórico movido: `DEFAULT 0` en todo,
-- así que cada ingreso, salida y orden de compra que ya existe queda con tasa 0 y su
-- `valor_total` intacto. El IVA aparece a partir de que alguien lo elija.
--
-- POR QUÉ `valor_total` NO CAMBIA DE SIGNIFICADO
--
-- Sigue siendo la BASE GRAVABLE (cantidad × precio unitario), tanto en las líneas como en las
-- cabeceras. Redefinirlo como "total con impuesto" habría sido más corto, y habría cambiado en
-- silencio el número de todos los reportes de valorización, del panel y del reporte de consumo
-- por cliente — exactamente lo que FR-111 prohíbe. El total con IVA se deriva sumando
-- (`valor_total + valor_iva`) y no se almacena en ninguna parte: un dato guardado que se puede
-- calcular es un dato que algún día contradice a sus sumandos.
--
-- EL `CHECK` DE LAS TASAS
--
-- 0, 5 y 19 son las tasas de IVA vigentes en Colombia. Se restringen en la base y no solo en el
-- esquema Zod porque es una regla de integridad del dato, no de la interfaz: una tasa inventada
-- por un cliente HTTP futuro produciría un impuesto que ningún contador podría explicar. Si
-- algún día cambia la ley, cambia con una migración — que es donde debe discutirse.
-- ============================================================================================

-- --------------------------------------------------------------------------------------------
-- Líneas: su propia tasa y el impuesto que resulta de ella.
-- --------------------------------------------------------------------------------------------
ALTER TABLE "detalles_ingresos"
    ADD COLUMN "tasa_iva"  DECIMAL(5, 2)  NOT NULL DEFAULT 0,
    ADD COLUMN "valor_iva" DECIMAL(14, 2) NOT NULL DEFAULT 0;

ALTER TABLE "detalles_salidas"
    ADD COLUMN "tasa_iva"  DECIMAL(5, 2)  NOT NULL DEFAULT 0,
    ADD COLUMN "valor_iva" DECIMAL(14, 2) NOT NULL DEFAULT 0;

ALTER TABLE "detalles_ordenes_compra"
    ADD COLUMN "tasa_iva"  DECIMAL(5, 2)  NOT NULL DEFAULT 0,
    ADD COLUMN "valor_iva" DECIMAL(14, 2) NOT NULL DEFAULT 0;

ALTER TABLE "detalles_ingresos"
    ADD CONSTRAINT "detalles_ingresos_tasa_iva_check" CHECK ("tasa_iva" IN (0, 5, 19)),
    ADD CONSTRAINT "detalles_ingresos_valor_iva_check" CHECK ("valor_iva" >= 0);

ALTER TABLE "detalles_salidas"
    ADD CONSTRAINT "detalles_salidas_tasa_iva_check" CHECK ("tasa_iva" IN (0, 5, 19)),
    ADD CONSTRAINT "detalles_salidas_valor_iva_check" CHECK ("valor_iva" >= 0);

ALTER TABLE "detalles_ordenes_compra"
    ADD CONSTRAINT "detalles_ordenes_compra_tasa_iva_check" CHECK ("tasa_iva" IN (0, 5, 19)),
    ADD CONSTRAINT "detalles_ordenes_compra_valor_iva_check" CHECK ("valor_iva" >= 0);

-- --------------------------------------------------------------------------------------------
-- Cabeceras: la suma del impuesto de sus líneas. Se guarda por el mismo motivo que ya se
-- guardaba `valor_total` — los listados muestran la cifra sin traerse los detalles de cada
-- documento — y se recalcula en la misma escritura que aquel.
-- --------------------------------------------------------------------------------------------
ALTER TABLE "ingresos"
    ADD COLUMN "valor_iva" DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD CONSTRAINT "ingresos_valor_iva_check" CHECK ("valor_iva" >= 0);

ALTER TABLE "salidas"
    ADD COLUMN "valor_iva" DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD CONSTRAINT "salidas_valor_iva_check" CHECK ("valor_iva" >= 0);

ALTER TABLE "ordenes_compra"
    ADD COLUMN "valor_iva" DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD CONSTRAINT "ordenes_compra_valor_iva_check" CHECK ("valor_iva" >= 0);
