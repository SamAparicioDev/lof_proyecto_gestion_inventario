-- US36 (T275) — Buzón de solicitudes del super administrador. FR-148…FR-157.
--
-- Una tabla y CERO permisos, y esa segunda mitad es deliberada: el acceso a este módulo se
-- resuelve contra el ROL super administrador (FR-148), igual que las capacidades de US30, y no
-- contra `roles_permisos`. Por eso no hay aquí ningún INSERT de permiso que se pueda olvidar al
-- desplegar — la trampa que documenta `20260820140000_notificaciones` no aplica a esta migración
-- porque no hay nada que sembrar. Un permiso que no existe no se concede por error.

-- ---------------------------------------------------------------------------
-- Tipo
-- ---------------------------------------------------------------------------
-- COMPLETADA significa «implementado Y desplegado», no «el código compila». La base no puede
-- verificarlo; queda fijado en contracts/api-rest.md para que quien lo marque sepa qué afirma.
CREATE TYPE "estado_solicitud" AS ENUM ('PENDIENTE', 'COMPLETADA', 'DESCARTADA');

-- ---------------------------------------------------------------------------
-- solicitudes_funcionalidad
-- ---------------------------------------------------------------------------
-- Dos columnas de texto que nunca se mezclan: `descripcion` es lo que quiso decir una persona y
-- `prompt_refinado` es cómo lo entendió una máquina (FR-152). Guardarlas separadas es lo único
-- que permite darse cuenta de que el modelo entendió otra cosa.
--
-- Sin FK hacia productos, documentos ni movimientos, y nada del negocio apunta hacia aquí: es un
-- cuaderno con estado que vive AL LADO del sistema, no dentro de su modelo (FR-156).
CREATE TABLE "solicitudes_funcionalidad" (
    "id"                     BIGSERIAL PRIMARY KEY,
    "titulo"                 VARCHAR(150) NOT NULL,
    "descripcion"            TEXT NOT NULL,
    "prompt_refinado"        TEXT,
    "refinado_en"            TIMESTAMPTZ(6),
    "estado"                 "estado_solicitud" NOT NULL DEFAULT 'PENDIENTE',
    "creada_por_id"          BIGINT NOT NULL,
    "creada_en"              TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "estado_cambiado_por_id" BIGINT,
    "estado_cambiado_en"     TIMESTAMPTZ(6),

    CONSTRAINT "solicitudes_funcionalidad_creada_por_id_fkey"
        FOREIGN KEY ("creada_por_id") REFERENCES "usuarios"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "solicitudes_funcionalidad_estado_cambiado_por_id_fkey"
        FOREIGN KEY ("estado_cambiado_por_id") REFERENCES "usuarios"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- La lista se lee "lo más reciente primero" y se filtra por estado (FR-157).
CREATE INDEX "solicitudes_funcionalidad_estado_creada_en_idx"
    ON "solicitudes_funcionalidad" ("estado", "creada_en");
