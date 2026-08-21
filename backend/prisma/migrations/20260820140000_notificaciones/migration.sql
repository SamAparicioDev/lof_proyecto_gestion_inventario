-- US35 (T266) — Notificaciones del sistema. FR-139…FR-147.
--
-- Dos tablas y tres permisos. Los permisos van en la MIGRACIÓN y no solo en el seed porque el
-- seed NO se ejecuta en producción: sin este INSERT, en Railway la campana saldría vacía para
-- todo el mundo aunque el código fuera correcto (lección de `20260815040000_permisos_categorias`,
-- vigilada por `test/unit/permisos-en-migraciones.spec.ts`).

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
CREATE TYPE "tipo_notificacion" AS ENUM (
    'INGRESO_REGISTRADO', 'INGRESO_RECIBIDO', 'INGRESO_ANULADO',
    'SALIDA_POR_APROBAR', 'SALIDA_CONFIRMADA', 'SALIDA_ANULADA',
    'STOCK_BAJO', 'CANTIDAD_CORREGIDA'
);

CREATE TYPE "entidad_notificada" AS ENUM ('INGRESO', 'SALIDA', 'PRODUCTO');

-- ---------------------------------------------------------------------------
-- notificaciones — UNA fila por HECHO, no una por destinatario
-- ---------------------------------------------------------------------------
-- Quién ve cada aviso se resuelve al CONSULTAR (tipos visibles de la sesión), no al escribir.
-- Así, cambiar los permisos de un rol surte efecto también sobre lo ya ocurrido, un usuario
-- nuevo no hereda el fan-out de nadie y la tabla no se multiplica por el tamaño de la plantilla.
CREATE TABLE "notificaciones" (
    "id"                BIGSERIAL PRIMARY KEY,
    "tipo"              "tipo_notificacion" NOT NULL,
    "titulo"            VARCHAR(150) NOT NULL,
    "detalle"           VARCHAR(300),
    "entidad_tipo"      "entidad_notificada" NOT NULL,
    "entidad_id"        BIGINT NOT NULL,
    -- Quien provocó el hecho: se EXCLUYE de los destinatarios (FR-143). Nulo si fue el sistema.
    "usuario_origen_id" BIGINT REFERENCES "usuarios"("id"),
    "creada_en"         TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

-- La bandeja siempre pregunta lo mismo: lo más reciente, de estos tipos, desde esta fecha.
CREATE INDEX "notificaciones_creada_en_idx" ON "notificaciones" ("creada_en");
CREATE INDEX "notificaciones_tipo_creada_en_idx" ON "notificaciones" ("tipo", "creada_en");
CREATE INDEX "notificaciones_usuario_origen_id_idx" ON "notificaciones" ("usuario_origen_id");

-- ---------------------------------------------------------------------------
-- notificaciones_lecturas — la existencia de la fila ES "leída"
-- ---------------------------------------------------------------------------
-- Sin columna booleana y sin fila previa "no leída": el no-leído es la ausencia. Eso es lo que
-- permite que emitir un aviso no escriba nada por cada destinatario posible.
CREATE TABLE "notificaciones_lecturas" (
    "notificacion_id" BIGINT NOT NULL REFERENCES "notificaciones"("id") ON DELETE CASCADE,
    "usuario_id"      BIGINT NOT NULL REFERENCES "usuarios"("id"),
    "leida_en"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    PRIMARY KEY ("notificacion_id", "usuario_id")
);

CREATE INDEX "notificaciones_lecturas_usuario_id_idx" ON "notificaciones_lecturas" ("usuario_id");

-- ---------------------------------------------------------------------------
-- Los tres permisos de SUSCRIPCIÓN (FR-141)
-- ---------------------------------------------------------------------------
-- Son tres y no ocho —uno por tipo de aviso— porque una pantalla de roles con ocho casillas de
-- avisos se marca entera sin leerla, y entonces la parametrización no decide nada. Tres grupos
-- coinciden con cómo se reparte el trabajo de verdad: quien recibe mercancía, quien despacha,
-- quien cuida el inventario.
--
-- No son permisos RESERVADOS (FR-131): suscribir a alguien no le concede ninguna capacidad. Y no
-- amplían el acceso (FR-142) — hace falta además el permiso de lectura del módulo, cosa que la
-- descripción dice, porque una casilla que a veces no hace nada tiene que explicar cuándo.
INSERT INTO "permisos" ("clave", "modulo", "descripcion") VALUES
    ('notificaciones.ingresos', 'notificaciones',
     'Recibir avisos de entradas de mercancía: registradas, recibidas y anuladas. Requiere además poder ver ingresos.'),
    ('notificaciones.salidas', 'notificaciones',
     'Recibir avisos de salidas: pendientes por aprobar, confirmadas y anuladas. Requiere además poder ver salidas.'),
    ('notificaciones.inventario', 'notificaciones',
     'Recibir avisos de inventario: productos que cruzan su umbral de stock bajo y cantidades corregidas a mano. Requiere además poder ver el inventario.')
ON CONFLICT ("clave") DO NOTHING;

-- Se conceden a los TRES roles del sistema: los tres registran ingresos y salidas, y ninguno de
-- estos avisos muestra nada que su rol no viera ya en su propia pantalla.
INSERT INTO "roles_permisos" ("rol_id", "permiso_id")
SELECT r."id", p."id"
FROM "roles" r CROSS JOIN "permisos" p
WHERE r."nombre" IN ('Administrador', 'Gerente', 'Operario')
  AND p."clave" IN ('notificaciones.ingresos', 'notificaciones.salidas', 'notificaciones.inventario')
ON CONFLICT DO NOTHING;
