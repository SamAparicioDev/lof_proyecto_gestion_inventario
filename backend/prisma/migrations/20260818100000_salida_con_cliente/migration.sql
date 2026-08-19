-- US28 (T228) — El destino obligatorio de una salida es el CLIENTE; el proyecto es opcional.
--
-- FR-124/FR-125, y enmienda 2.0.0 de la constitución (Principio II). Hasta hoy `salidas` NO
-- guardaba el cliente: se derivaba del proyecto, que era NOT NULL. Esa deducción deja de ser
-- posible en cuanto el proyecto puede faltar, así que el cliente pasa a ser columna propia.
--
-- El orden importa: primero se crea `cliente_id` NULL, se rellena desde el proyecto de cada
-- salida y solo entonces se pone NOT NULL. Crearla NOT NULL de una vez fallaría con la tabla
-- ya poblada, y hacerlo con un DEFAULT metería un cliente inventado en el histórico.

-- ---------------------------------------------------------------------------
-- 1. La columna, rellenada desde el proyecto que cada salida ya tenía
-- ---------------------------------------------------------------------------
ALTER TABLE "salidas" ADD COLUMN "cliente_id" BIGINT;

UPDATE "salidas" s
   SET "cliente_id" = p."cliente_id"
  FROM "proyectos" p
 WHERE p."id" = s."proyecto_id";

-- Si algo quedara sin rellenar, la salida no tendría destino y el sistema perdería trazabilidad
-- en silencio (Principio II). Que la migración falle aquí es la respuesta correcta: significa
-- que hay una salida cuyo proyecto no existe, y eso hay que mirarlo, no taparlo.
ALTER TABLE "salidas" ALTER COLUMN "cliente_id" SET NOT NULL;

ALTER TABLE "salidas"
    ADD CONSTRAINT "salidas_cliente_id_fkey"
        FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. El proyecto deja de ser obligatorio
-- ---------------------------------------------------------------------------
-- Ninguna salida existente cambia: todas conservan el proyecto con el que se registraron. Lo
-- único que cambia es que las nuevas pueden no traerlo.
ALTER TABLE "salidas" ALTER COLUMN "proyecto_id" DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. El índice que el filtro por cliente necesita ahora
-- ---------------------------------------------------------------------------
-- Hasta hoy `?clienteId=3` se resolvía con un JOIN contra `proyectos` apoyado en
-- `salidas_proyecto_id_estado_idx`. Ahora es una igualdad sobre la columna nueva, y sin índice
-- propio sería un recorrido completo de la tabla en el filtro más usado del listado
-- (Restricciones adicionales de la constitución: los campos de búsqueda frecuente van
-- indexados). El compuesto con `estado` responde la pregunta real: "salidas de este cliente
-- que están en tal estado".
CREATE INDEX "salidas_cliente_id_estado_idx" ON "salidas" ("cliente_id", "estado");

-- El índice por proyecto SE MANTIENE: sigue sirviendo al reporte de consumo por proyecto y al
-- cálculo de comprometido. Ahora simplemente no cubre a las salidas sin proyecto, que es
-- correcto — no pertenecen a ninguno.
