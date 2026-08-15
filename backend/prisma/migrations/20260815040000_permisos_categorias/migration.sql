-- US15 — Los DOS permisos de categorías, que se quedaron solo en `prisma/seed.ts`.
--
-- El defecto: `20260814235000_categorias_como_catalogo` creó la tabla y migró los datos, pero
-- no insertó `categorias.ver` ni `categorias.gestionar` en el catálogo de permisos. En
-- desarrollo no se notó —la semilla los crea— pero en producción la semilla NO se ejecuta
-- (crearía un usuario con contraseña conocida), así que allí nadie los tiene. Consecuencias
-- reales, ambas reportadas por el dueño del proyecto:
--
--   1. La entrada "Administración" de la barra lateral no aparecía: se muestra a quien tenga
--      `categorias.gestionar`, y en producción no lo tenía ni el Administrador.
--   2. `GET /api/categorias` respondía 403, así que el selector de categoría del formulario de
--      producto salía vacío — el código era correcto y la función estaba rota igual.
--
-- No se puede corregir editando aquella migración: Prisma valida su checksum y rechazaría toda
-- migración posterior. Por eso van aquí, con el mismo patrón que
-- `20260815030000_ordenes_compra` usó para proveedores y órdenes.
--
-- La lección está anotada como regla del proyecto: TODO permiso nuevo se inserta en una
-- migración, además del seed. `test/unit/permisos-en-migraciones.spec.ts` lo verifica ahora de
-- forma automática, para que no vuelva a depender de que alguien se acuerde.

INSERT INTO "permisos" ("clave", "modulo", "descripcion") VALUES
    ('categorias.ver',       'categorias', 'Consultar el catálogo de categorías para clasificar productos y filtrar.'),
    ('categorias.gestionar', 'categorias', 'Administrar el catálogo de categorías: alta, edición y estado.')
ON CONFLICT ("clave") DO NOTHING;

-- Matriz rol → permiso (FR-088): VER es trabajo diario —sin él no se clasifica un producto ni
-- se usa el filtro— así que lo tienen los TRES roles; administrar el catálogo, solo dos.
INSERT INTO "roles_permisos" ("rol_id", "permiso_id")
SELECT r."id", p."id"
FROM "roles" r CROSS JOIN "permisos" p
WHERE r."nombre" IN ('Administrador', 'Gerente', 'Operario')
  AND p."clave" = 'categorias.ver'
ON CONFLICT DO NOTHING;

INSERT INTO "roles_permisos" ("rol_id", "permiso_id")
SELECT r."id", p."id"
FROM "roles" r CROSS JOIN "permisos" p
WHERE r."nombre" IN ('Administrador', 'Gerente')
  AND p."clave" = 'categorias.gestionar'
ON CONFLICT DO NOTHING;
