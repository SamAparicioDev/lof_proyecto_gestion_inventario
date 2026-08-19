-- US26 (T221) — Cantidades enteras: FR-122.
--
-- No se entrega medio compresor ni se recibe 0,75 de un filtro. La regla se valida en los
-- esquemas Zod (navegador y servidor) y aquí queda la red final que exige la constitución
-- (Principio I: "la capa de persistencia DEBE reforzar estas restricciones, no solo la
-- interfaz").
--
-- ---------------------------------------------------------------------------
-- Por qué NOT VALID en las tablas de historia
-- ---------------------------------------------------------------------------
-- `ADD CONSTRAINT` valida por defecto TODAS las filas existentes y abortaría esta migración si
-- una sola cantidad histórica tuviera decimales — que es exactamente lo que puede haber, porque
-- hasta hoy se admitían dos. `NOT VALID` le dice a PostgreSQL que exija la regla en todo
-- INSERT/UPDATE futuro sin revisar lo ya escrito.
--
-- Es la política de la constitución enmendada (v2.0.0, Principio I): al endurecer una
-- restricción sobre datos que ya existen se aplica hacia adelante, nunca reescribiendo el
-- histórico — en `movimientos_inventario` reescribirlo está además prohibido por su trigger de
-- inmutabilidad (Principio II / FR-046).
--
-- Consecuencia deliberada: un documento PENDIENTE anterior a esta historia con cantidades
-- decimales se puede seguir leyendo, pero al EDITARLO sus líneas se reescriben y ahí sí se
-- exige la regla nueva. Es el mismo criterio de FR-103 con las unidades de medida: la limpieza
-- ocurre con el uso, de uno en uno, no con una migración que invente datos.
--
-- El tipo de columna NO cambia: `DECIMAL(12,2)` sigue siendo necesario para leer el histórico.
-- El tipo describe lo que hay guardado; el `CHECK` describe lo que se admite desde ahora.

ALTER TABLE "detalles_ingresos"
    ADD CONSTRAINT "detalles_ingresos_cantidad_entera_check"
        CHECK ("cantidad" = trunc("cantidad")) NOT VALID;

ALTER TABLE "detalles_salidas"
    ADD CONSTRAINT "detalles_salidas_cantidad_entera_check"
        CHECK ("cantidad" = trunc("cantidad")) NOT VALID;

ALTER TABLE "detalles_ordenes_compra"
    ADD CONSTRAINT "detalles_ordenes_compra_cantidad_entera_check"
        CHECK ("cantidad" = trunc("cantidad")) NOT VALID;

ALTER TABLE "detalles_cotizaciones"
    ADD CONSTRAINT "detalles_cotizaciones_cantidad_entera_check"
        CHECK ("cantidad" = trunc("cantidad")) NOT VALID;

ALTER TABLE "movimientos_inventario"
    ADD CONSTRAINT "movimientos_inventario_cantidad_entera_check"
        CHECK ("cantidad" = trunc("cantidad")) NOT VALID;

-- ---------------------------------------------------------------------------
-- El umbral SÍ se normaliza, y su CHECK sí se valida
-- ---------------------------------------------------------------------------
-- `umbral_stock_bajo` no es historia: es un parámetro de configuración de la alerta de stock
-- (FR-022), y redondearlo no falsea ningún hecho registrado. Se normaliza antes de exigir la
-- regla porque un `NOT VALID` aquí sería una trampa: PostgreSQL revisa la restricción en cada
-- UPDATE de la fila, así que un producto con umbral `2,5` heredado quedaría imposible de
-- guardar por cualquier vía que no tocara justo esa columna (por ejemplo, una carga masiva de
-- precios — FR-103).
--
-- Se redondea, no se trunca: el umbral dispara una alerta, y avisar un poco antes es el error
-- barato de los dos.
--
-- `stock_actual` NO lleva CHECK a propósito: sí es un valor derivado de la historia de
-- movimientos, y redondearlo cambiaría el inventario real. Un producto que hoy tenga 12,5
-- unidades sigue teniéndolas y sigue pudiendo moverse; sus movimientos NUEVOS serán enteros y
-- la fracción se arrastrará hasta que alguien la resuelva con un ajuste (US29).

UPDATE "productos"
   SET "umbral_stock_bajo" = round("umbral_stock_bajo")
 WHERE "umbral_stock_bajo" <> trunc("umbral_stock_bajo");

ALTER TABLE "productos"
    ADD CONSTRAINT "productos_umbral_entero_check"
        CHECK ("umbral_stock_bajo" = trunc("umbral_stock_bajo"));
