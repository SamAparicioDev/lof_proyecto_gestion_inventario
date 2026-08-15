# Borradores — SQL revisado, todavía NO aplicado

Migraciones ya escritas y revisadas que **no están en `prisma/migrations/`** a propósito: una
migración ahí se aplicaría en el siguiente `prisma migrate deploy`, y si `schema.prisma` aún no
la refleja, la base y el cliente de Prisma quedarían desalineados.

Al implementar la tarea correspondiente, se mueve el archivo a
`backend/prisma/migrations/<marca_de_tiempo>_<nombre>/migration.sql` **en el mismo cambio** que
actualiza `schema.prisma`.

| Archivo | Tarea | Qué hace |
|---|---|---|
| `proveedores-migration.sql` | T157 (US15) | Convierte `ingresos.proveedor` (texto obligatorio) en el catálogo `proveedores` + FK, sin perder ningún dato (FR-092) y marcando el proveedor de la carga masiva como del sistema (FR-093) |
