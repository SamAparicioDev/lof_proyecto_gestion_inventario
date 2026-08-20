-- US30 (T237) — El super administrador: la llave de repuesto del sistema. FR-127/FR-128.
--
-- Ya ocurrió: un administrador tocó la matriz de permisos y el sistema quedó sin nadie que
-- pudiera volver a repartirlos. Los invariantes de FR-057 cubren el caso obvio (quitarle
-- `roles.gestionar` al último rol que lo tiene), pero cubren ESE caso — no todos los que se le
-- pueden ocurrir a alguien con prisa.
--
-- ---------------------------------------------------------------------------
-- Por qué este rol NO recibe filas en `roles_permisos`
-- ---------------------------------------------------------------------------
-- Sería la solución evidente y sería la equivocada: un rol "con todos los permisos" se queda sin
-- ninguno en cuanto alguien vacía la tabla, que es exactamente el accidente del que protege. Un
-- respaldo que se rompe con la misma operación de la que protege no es un respaldo.
--
-- Por eso su autorización no vive en datos sino en la columna: `PermisosGuard` concede cualquier
-- permiso a quien tenga un rol con `es_super_admin`, sin consultar la matriz. Vaciar `permisos`
-- o `roles_permisos` no le quita nada.
--
-- Es además `es_sistema = true`, así que hereda las protecciones de FR-057 como segunda capa;
-- las suyas propias (no se edita, no se desactiva, no se asigna) las aplican los casos de uso.

ALTER TABLE "roles" ADD COLUMN "es_super_admin" BOOLEAN NOT NULL DEFAULT false;

-- Índice único PARCIAL: puede no haber ninguno (bases anteriores a esta migración, un instante
-- antes del INSERT de abajo) pero nunca dos. Dos roles de respaldo serían dos llaves maestras
-- distintas, y la segunda no la vigilaría nadie.
CREATE UNIQUE INDEX "roles_super_admin_unico" ON "roles" ("es_super_admin") WHERE "es_super_admin";

INSERT INTO "roles" ("nombre", "descripcion", "es_sistema", "es_super_admin", "estado")
VALUES (
    'Super administrador',
    'Respaldo del sistema. Sus permisos no se resuelven contra la matriz de roles, así que ningún cambio de permisos puede dejarlo bloqueado. Solo se asigna desde la base de datos.',
    true,
    true,
    'ACTIVO'
)
ON CONFLICT ("nombre") DO UPDATE SET "es_super_admin" = true, "es_sistema" = true;

-- ---------------------------------------------------------------------------
-- El USUARIO no se crea aquí
-- ---------------------------------------------------------------------------
-- Necesita un hash bcrypt, y una contraseña dentro de una migración es una contraseña dentro del
-- repositorio para siempre — con la agravante de que quedaría en el historial de git aunque
-- después se cambie. Lo crea el arranque del backend a partir de `SUPERADMIN_LOGIN`,
-- `SUPERADMIN_EMAIL` y `SUPERADMIN_PASSWORD` (FR-129, `infraestructura/arranque/`): esas
-- variables viven en el entorno del servidor, no en el código, y si el usuario ya existe no se
-- toca. Para asignarle el rol a un usuario que YA existe, la única vía es esta:
--
--   UPDATE usuarios SET rol_id = (SELECT id FROM roles WHERE es_super_admin) WHERE login = '...';
