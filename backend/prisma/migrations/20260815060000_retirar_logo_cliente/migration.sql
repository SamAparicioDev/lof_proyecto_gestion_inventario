-- Retira el LOGO POR CLIENTE (decisión del dueño del proyecto, 2026-08-15 — FR-066).
--
-- Los documentos que salen del sistema los firma LOF, no el cliente al que van dirigidos. El
-- logo por ficha obligaba a mantener una imagen por cliente para decorar un archivo que igual
-- identifica a quien lo emite, y dejaba SIN identidad los exportables que abarcan varios
-- clientes o ninguno (inventario, movimientos, ingresos, listados sin filtrar). Lo sustituye el
-- logotipo institucional de FR-067, que es un archivo del repositorio
-- (`assets/marca/logo-lof.png`) e imprime en TODOS los exportables sin excepción.
--
-- ESTA MIGRACIÓN BORRA DATOS Y NO SE PUEDE DESHACER: las imágenes cargadas se pierden. Es lo
-- pedido explícitamente. Se deja constancia aquí porque es la excepción a "en este sistema nada
-- se borra" (Principio II), y esa excepción se justifica en que un logo no es un hecho del
-- negocio —no es un movimiento, ni un documento, ni parte de ninguna trazabilidad—: es
-- decoración de un archivo, y su pérdida no deja ningún registro histórico incompleto.
--
-- Los dos CHECK se retiran ANTES que las columnas. `DROP COLUMN` se los llevaría por delante de
-- todas formas, pero nombrarlos deja el rastro de que existían y de que dejaron de aplicar aquí,
-- que es lo que alguien buscará dentro de un año al no encontrarlos.

ALTER TABLE "clientes" DROP CONSTRAINT IF EXISTS "clientes_logo_consistente";
ALTER TABLE "clientes" DROP CONSTRAINT IF EXISTS "clientes_logo_tipo_mime_admitido";

ALTER TABLE "clientes" DROP COLUMN IF EXISTS "logo";
ALTER TABLE "clientes" DROP COLUMN IF EXISTS "logo_tipo_mime";
