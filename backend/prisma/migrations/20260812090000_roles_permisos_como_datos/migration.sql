-- ============================================================================
-- US9 (T099) — Control de acceso como DATO: roles, permisos y roles_permisos
--
-- Fuente de verdad: specs/001-gestion-inventarios/data-model.md (§ roles, § permisos,
-- § roles_permisos, § usuarios) y research.md R16. FR-054…FR-059.
--
-- MIGRACIÓN DE SEGURIDAD SENSIBLE — el orden de los pasos NO es negociable:
--   1. crear las tablas nuevas
--   2. insertar los 3 roles del sistema (es_sistema = true)
--   3. insertar el catálogo de permisos (uno por cada verificación real del código)
--   4. poblar roles_permisos con EXACTAMENTE los permisos que hoy concede el @Roles(...)
--      de cada endpoint (FR-059/SC-013)
--   5. agregar usuarios.rol_id NULLABLE
--   6. poblarlo traduciendo el enum `rol` de CADA usuario existente
--   7. verificar que ningún usuario quedó sin rol (aborta la transacción si pasa)
--   8. recién entonces: NOT NULL + FK, y eliminar la columna vieja y su tipo enum
--
-- Ningún usuario queda sin rol en ningún punto intermedio: la columna nueva nace NULLABLE,
-- se puebla, se verifica y solo después se vuelve obligatoria. Prisma ejecuta cada archivo
-- de migración dentro de una transacción, así que si el paso 7 falla NADA se aplica.
-- ============================================================================

-- CreateEnum
CREATE TYPE "estado_rol" AS ENUM ('ACTIVO', 'INACTIVO');

-- CreateTable
CREATE TABLE "roles" (
    "id" BIGSERIAL NOT NULL,
    "nombre" VARCHAR(50) NOT NULL,
    "descripcion" VARCHAR(200),
    "es_sistema" BOOLEAN NOT NULL DEFAULT false,
    "estado" "estado_rol" NOT NULL DEFAULT 'ACTIVO',

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permisos" (
    "id" BIGSERIAL NOT NULL,
    "clave" VARCHAR(60) NOT NULL,
    "modulo" VARCHAR(30) NOT NULL,
    "descripcion" VARCHAR(200) NOT NULL,

    CONSTRAINT "permisos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles_permisos" (
    "rol_id" BIGINT NOT NULL,
    "permiso_id" BIGINT NOT NULL,

    CONSTRAINT "roles_permisos_pkey" PRIMARY KEY ("rol_id","permiso_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_nombre_key" ON "roles"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "permisos_clave_key" ON "permisos"("clave");

-- AddForeignKey
ALTER TABLE "roles_permisos" ADD CONSTRAINT "roles_permisos_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles_permisos" ADD CONSTRAINT "roles_permisos_permiso_id_fkey" FOREIGN KEY ("permiso_id") REFERENCES "permisos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Paso 2 — Los 3 roles del sistema (FR-059). `es_sistema = true`: no se eliminan ni se
-- renombran (FR-057). Sus nombres son la identidad estable con la que el adaptador de
-- usuarios traduce, durante la migración del guard (T102/T103), el enum viejo.
-- ============================================================================
INSERT INTO "roles" ("nombre", "descripcion", "es_sistema", "estado") VALUES
    ('Administrador', 'Gestión total del sistema, incluidos usuarios, roles y permisos.', true, 'ACTIVO'),
    ('Gerente',       'Operación completa de inventario, clientes, proyectos y reportes.',  true, 'ACTIVO'),
    ('Operario',      'Registro de entradas y salidas de mercancía y consultas básicas.',   true, 'ACTIVO');

-- ============================================================================
-- Paso 3 — Catálogo de permisos (FR-056). UNO por cada verificación real que existe hoy en
-- los controladores de backend/src/interfaces/http: no hay permisos sin endpoint detrás
-- (research R16). `modulo` agrupa la lista en la UI y cumple `clave = modulo || '.' || accion`.
-- El seed (prisma/seed.ts, T100) reproduce este mismo catálogo de forma idempotente y es
-- quien lo mantiene al día cuando se agreguen endpoints nuevos.
-- ============================================================================
INSERT INTO "permisos" ("clave", "modulo", "descripcion") VALUES
    ('inventario.ver',          'inventario', 'Consultar el inventario, la ficha de un producto y su historial de movimientos.'),
    ('productos.ver',           'productos',  'Consultar el catálogo de productos para seleccionarlos en documentos.'),
    ('productos.crear',         'productos',  'Dar de alta productos en el catálogo.'),
    ('productos.editar',        'productos',  'Editar los datos de un producto del catálogo.'),
    ('productos.cambiar_estado','productos',  'Activar o desactivar un producto del catálogo.'),
    ('productos.importar',      'productos',  'Descargar la plantilla y el catálogo, y hacer carga masiva de inventario.'),
    ('clientes.ver',            'clientes',   'Consultar clientes, su ficha y sus proyectos.'),
    ('clientes.crear',          'clientes',   'Registrar clientes nuevos.'),
    ('clientes.editar',         'clientes',   'Editar los datos de un cliente.'),
    ('clientes.cambiar_estado', 'clientes',   'Activar o desactivar un cliente.'),
    ('proyectos.crear',         'proyectos',  'Crear proyectos para un cliente.'),
    ('proyectos.editar',        'proyectos',  'Editar los datos de un proyecto.'),
    ('proyectos.cambiar_estado','proyectos',  'Cambiar el estado de un proyecto (activo, completado o suspendido).'),
    ('ingresos.ver',            'ingresos',   'Consultar los ingresos de mercancía y su detalle.'),
    ('ingresos.crear',          'ingresos',   'Registrar ingresos de mercancía por factura.'),
    ('ingresos.editar',         'ingresos',   'Editar un ingreso mientras sigue pendiente.'),
    ('ingresos.recibir',        'ingresos',   'Recibir un ingreso: suma la mercancía al inventario.'),
    ('ingresos.verificar',      'ingresos',   'Verificar un ingreso ya recibido.'),
    ('ingresos.anular',         'ingresos',   'Anular un ingreso, revirtiendo el stock que hubiera sumado.'),
    ('salidas.ver',             'salidas',    'Consultar las salidas de mercancía y su detalle.'),
    ('salidas.crear',           'salidas',    'Registrar salidas de mercancía hacia un proyecto.'),
    ('salidas.editar',          'salidas',    'Editar una salida mientras sigue pendiente.'),
    ('salidas.confirmar',       'salidas',    'Confirmar una salida: descuenta la mercancía del inventario.'),
    ('salidas.completar',       'salidas',    'Marcar como completada una salida ya confirmada.'),
    ('salidas.cancelar',        'salidas',    'Cancelar una salida pendiente, que nunca tocó el inventario.'),
    ('salidas.anular',          'salidas',    'Anular una salida confirmada, devolviendo la mercancía al inventario.'),
    ('reportes.ver',            'reportes',   'Consultar los reportes de consumo, inventario y movimientos.'),
    ('reportes.exportar',       'reportes',   'Exportar los reportes a PDF y Excel.'),
    ('usuarios.gestionar',      'usuarios',   'Administrar usuarios: alta, edición, estado y restablecimiento de contraseña.'),
    ('roles.gestionar',         'roles',      'Administrar roles y los permisos de cada rol.');

-- ============================================================================
-- Paso 4 — Matriz rol↔permiso (FR-059/SC-013). ESTA ES LA PIEZA CRÍTICA de la migración:
-- cada rol del sistema recibe EXACTAMENTE los permisos que su `@Roles(...)` concedía el día
-- de la migración, de modo que ningún usuario existente note un cambio de comportamiento.
--
--   Administrador → los 30 permisos del catálogo.
--   Gerente       → los 30 MENOS 'usuarios.gestionar' y 'roles.gestionar'  (28).
--   Operario      → solo los endpoints que hoy declaran (A,G,O)            (14).
--
-- La tabla legible rol→permisos vive en el comentario de prisma/seed.ts (T100); aquí se
-- expresa por diferencia para que sea imposible que un permiso quede fuera de Administrador.
-- ============================================================================

-- Administrador: TODO el catálogo.
INSERT INTO "roles_permisos" ("rol_id", "permiso_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permisos" p WHERE r."nombre" = 'Administrador';

-- Gerente: todo MENOS la administración de usuarios y de roles.
INSERT INTO "roles_permisos" ("rol_id", "permiso_id")
SELECT r."id", p."id"
FROM "roles" r CROSS JOIN "permisos" p
WHERE r."nombre" = 'Gerente'
  AND p."clave" NOT IN ('usuarios.gestionar', 'roles.gestionar');

-- Operario: exactamente los endpoints que hoy declaran @Roles('ADMINISTRADOR','GERENTE','OPERARIO').
INSERT INTO "roles_permisos" ("rol_id", "permiso_id")
SELECT r."id", p."id"
FROM "roles" r CROSS JOIN "permisos" p
WHERE r."nombre" = 'Operario'
  AND p."clave" IN (
      'inventario.ver',
      'productos.ver', 'productos.crear',
      'clientes.ver',
      'ingresos.ver', 'ingresos.crear', 'ingresos.editar', 'ingresos.recibir',
      'salidas.ver', 'salidas.crear', 'salidas.editar',
      'salidas.confirmar', 'salidas.completar', 'salidas.cancelar'
  );

-- ============================================================================
-- Pasos 5 y 6 — usuarios.rol_id: se agrega NULLABLE y se puebla traduciendo el enum viejo
-- de CADA usuario existente. La traducción es explícita (no un lower()/initcap() implícito):
-- si mañana alguien renombrara un rol del sistema, este mapeo seguiría siendo legible.
-- ============================================================================
ALTER TABLE "usuarios" ADD COLUMN "rol_id" BIGINT;

UPDATE "usuarios" u
SET "rol_id" = r."id"
FROM "roles" r
WHERE r."nombre" = CASE u."rol"
        WHEN 'ADMINISTRADOR' THEN 'Administrador'
        WHEN 'GERENTE'       THEN 'Gerente'
        WHEN 'OPERARIO'      THEN 'Operario'
    END;

-- ============================================================================
-- Paso 7 — Red de seguridad: si CUALQUIER usuario quedó sin rol, la migración completa se
-- revierte. Un usuario sin rol es un usuario sin control de acceso resoluble: preferimos
-- una migración que falla ruidosamente a una base de datos a medio migrar.
-- ============================================================================
DO $$
DECLARE
    sin_rol BIGINT;
BEGIN
    SELECT COUNT(*) INTO sin_rol FROM "usuarios" WHERE "rol_id" IS NULL;
    IF sin_rol > 0 THEN
        RAISE EXCEPTION
            'Migración abortada: % usuario(s) quedaron sin rol_id al traducir el enum "rol" (FR-059).',
            sin_rol;
    END IF;
END $$;

-- ============================================================================
-- Paso 8 — Ahora sí: obligatoriedad, FK, y baja de la columna vieja y su tipo enum.
-- `ON DELETE RESTRICT` es la garantía de BD del invariante de FR-057: no se puede borrar un
-- rol que tenga usuarios asignados (el caso de uso lo verifica antes, con un mensaje en
-- español que dice CUÁNTOS usuarios lo tienen; esto es la red final).
-- ============================================================================
ALTER TABLE "usuarios" ALTER COLUMN "rol_id" SET NOT NULL;

ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "usuarios" DROP COLUMN "rol";

DROP TYPE "rol";
