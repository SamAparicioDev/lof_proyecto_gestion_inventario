-- US31 (T242, parte 1 de 2) — `AJUSTE` entra en `documento_tipo`. FR-130.
--
-- Va SOLO en esta migración a propósito. PostgreSQL admite `ALTER TYPE ... ADD VALUE` dentro de
-- una transacción (y Prisma envuelve cada migración en una), pero NO deja USAR el valor nuevo en
-- esa misma transacción. La migración siguiente lo usa en un `CHECK`, así que tiene que ser otra
-- transacción — es decir, otro archivo.

ALTER TYPE "documento_tipo" ADD VALUE IF NOT EXISTS 'AJUSTE';
