# Capa `infraestructura` — adaptadores de tecnología

Aquí vive TODO el código que habla con tecnología concreta, implementando los **puertos**
definidos por `dominio`/`aplicacion` (patrón Adapter + DIP). Es la única capa que puede
importar Prisma, bcrypt, exceljs o pdfmake.

## Organización

| Carpeta | Adaptadores | Implementa |
|---|---|---|
| `persistencia/` | `PrismaService`, `UnidadDeTrabajo`, `repositorio-*.prisma.ts`, `contadores.prisma.ts` | Puertos de repositorios del dominio |
| `seguridad/` | `AdaptadorHashBcrypt`, estrategia JWT de cookie | Puerto `Hasheador`; autenticación (FR-001) |
| `exportacion/` | `ExportadorExcel` (exceljs), `ExportadorPdf` (pdfmake) | Puerto `ExportadorReporte` — patrón **Strategy** (FR-043, research R8) |

## Reglas críticas de esta capa

- **Transacciones de stock** (`UnidadDeTrabajo`, research R4): toda confirmación de
  ingreso/salida/anulación corre en `prisma.$transaction` con
  `SELECT ... FOR UPDATE ORDER BY id` sobre los productos afectados. El orden fijo evita
  deadlocks; el bloqueo garantiza que el stock nunca quede negativo (Principio I) junto
  con el `CHECK` de la base de datos.
- **Traducción de errores**: los errores técnicos se convierten a errores de dominio.
  Ejemplo: violación de UNIQUE de PostgreSQL (código P2002 de Prisma) → `Duplicado` con
  el campo correspondiente, para que el formulario marque el campo exacto (FR-015).
- **Correlativos** (`contadores.prisma.ts`, research R5): `UPDATE contadores SET valor =
  valor + 1 WHERE clave = 'salida' RETURNING valor`, SIEMPRE dentro de la transacción del
  documento — números únicos y sin huecos bajo concurrencia.
- **Auditoría**: los repositorios pueblan `fecha_creacion`/`usuario_creacion`/
  `fecha_modificacion`/`usuario_modificacion` con el usuario recibido del caso de uso
  (FR-045). Nunca se hace DELETE de movimientos ni de usuarios (FR-008/FR-046).
- Los adaptadores NO contienen reglas de negocio: si estás escribiendo un `if` de negocio
  aquí, pertenece al dominio o al caso de uso.
