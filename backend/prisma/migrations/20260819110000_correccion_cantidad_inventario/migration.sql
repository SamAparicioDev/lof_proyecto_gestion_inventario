-- US31 (T242, parte 2 de 2) — Corregir la cantidad desde el inventario. FR-130/FR-131.
--
-- Cuando el conteo físico no cuadra, hoy hay que fabricar un documento: un ingreso para lo que
-- sobra y una salida —con cliente— para lo que falta. Inventar un cliente para justificar una
-- merma es el mismo dato falso que US29 quitó de la entrada, en el otro sentido.
--
-- ---------------------------------------------------------------------------
-- 1. Un movimiento que no tiene documento detrás
-- ---------------------------------------------------------------------------
-- `documento_id` pasa a admitir NULL, pero SOLO para los ajustes. El `CHECK` lo expresa como una
-- equivalencia y no como dos permisos sueltos: un movimiento de INGRESO/SALIDA sin documento
-- sería un huérfano imposible de auditar, y un AJUSTE con `documento_id` fingiría respaldarse en
-- algo que no existe. Las dos mentiras se cierran con la misma línea.
--
-- Lo que respalda a un ajuste es su `motivo`, que la aplicación exige y que aquí ya era
-- obligatorio para los movimientos AJUSTE_* desde la migración inicial.

ALTER TABLE "movimientos_inventario" ALTER COLUMN "documento_id" DROP NOT NULL;

ALTER TABLE "movimientos_inventario"
    ADD CONSTRAINT "movimientos_documento_ajuste_check"
        CHECK (("documento_tipo" = 'AJUSTE') = ("documento_id" IS NULL));

-- ---------------------------------------------------------------------------
-- 2. El permiso, y por qué está reservado
-- ---------------------------------------------------------------------------
-- Escribir el stock a mano es la única operación del sistema que puede desmentir a todos los
-- documentos a la vez. Por eso tiene permiso propio en vez de colgar de `inventario.ver`, y por
-- eso quién lo tiene no se decide con el mismo permiso que reparte todo lo demás: solo un super
-- administrador puede concederlo o retirarlo (FR-131, verificado en `ActualizarRolCasoUso`).
--
-- La RESERVA no se guarda aquí: vive en el dominio (`PERMISOS_RESERVADOS`). Es una propiedad del
-- significado del permiso, no un dato de operación — si fuera una columna editable, quitarle la
-- reserva sería el primer paso para saltarse la regla.
--
-- Nace concedido al Administrador. Al super administrador NO se le concede: no lo necesita, sus
-- permisos no se resuelven contra esta tabla (US30, FR-127).

INSERT INTO "permisos" ("clave", "modulo", "descripcion") VALUES
    ('inventario.ajustar', 'inventario',
     'Corregir a mano la cantidad de un producto para cuadrar con el conteo físico, sin documento de entrada ni de salida. Permiso reservado: solo el super administrador lo concede o lo retira.')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "roles_permisos" ("rol_id", "permiso_id")
SELECT r."id", p."id"
FROM "roles" r CROSS JOIN "permisos" p
WHERE r."nombre" = 'Administrador'
  AND p."clave" = 'inventario.ajustar'
ON CONFLICT DO NOTHING;
