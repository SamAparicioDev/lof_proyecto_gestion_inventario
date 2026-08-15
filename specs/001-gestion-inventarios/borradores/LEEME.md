# Borradores — SQL revisado, todavía NO aplicado

Migraciones ya escritas y revisadas que **no están en `prisma/migrations/`** a propósito: una
migración ahí se aplicaría en el siguiente `prisma migrate deploy`, y si `schema.prisma` aún no
la refleja, la base y el cliente de Prisma quedarían desalineados.

Al implementar la tarea correspondiente, se mueve el archivo a
`backend/prisma/migrations/<marca_de_tiempo>_<nombre>/migration.sql` **en el mismo cambio** que
actualiza `schema.prisma`.

Hoy no hay ninguno pendiente.

## Historial

| Archivo | Tarea | Dónde está ahora |
|---|---|---|
| `proveedores-migration.sql` | T157 (US15) | Aplicado en `backend/prisma/migrations/20260815010000_proveedores_como_catalogo/`. Al moverlo se le corrigió un defecto que solo se manifestaba en una base RECIÉN CREADA: el `INSERT` del proveedor del sistema corría sin condición, y como las migraciones se ejecutan antes que la semilla, no había ningún usuario al que apuntar en `usuario_creacion_id NOT NULL` — la migración fallaba y el backend no arrancaba. Ahora ese `INSERT` solo actúa si ya existe algún usuario; en una base nueva la fila la crea la semilla |
