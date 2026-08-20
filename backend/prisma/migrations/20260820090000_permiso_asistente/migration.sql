-- US33 (T254) — Permiso del asistente de consultas. FR-133/FR-134.
--
-- El seed NO se ejecuta en producción, así que todo permiso nuevo entra por una migración o el
-- endpoint responde 403 allí aunque el código sea correcto (lección de
-- `20260815040000_permisos_categorias`, vigilada por `test/unit/permisos-en-migraciones.spec.ts`).
--
-- ---------------------------------------------------------------------------
-- Por qué tiene permiso propio y no cuelga de `inventario.ver`
-- ---------------------------------------------------------------------------
-- Quién puede PREGUNTAR por chat y quién puede abrir el inventario son dos decisiones distintas:
-- una organización puede querer el asistente apagado para algunos roles sin quitarles ninguna
-- pantalla, o al revés.
--
-- Lo que este permiso NO hace es dar acceso a datos. Cada consulta que el asistente ejecuta por
-- dentro vuelve a comprobar el permiso que le corresponde (FR-134), así que tenerlo sin tener
-- `reportes.ver` sirve para preguntar por existencias y no por consumo. Es la llave de la puerta,
-- no de las habitaciones.
--
-- Se concede a los TRES roles: es de solo lectura y no expone nada que su rol no viera ya.
-- Tampoco es reservado (FR-131): no puede desmentir documentos ni repartir capacidades.

INSERT INTO "permisos" ("clave", "modulo", "descripcion") VALUES
    ('asistente.consultar', 'asistente',
     'Preguntarle al asistente sobre los datos del sistema. Es de solo lectura: cada consulta que hace por dentro respeta los permisos de quien pregunta.')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "roles_permisos" ("rol_id", "permiso_id")
SELECT r."id", p."id"
FROM "roles" r CROSS JOIN "permisos" p
WHERE r."nombre" IN ('Administrador', 'Gerente', 'Operario')
  AND p."clave" = 'asistente.consultar'
ON CONFLICT DO NOTHING;
