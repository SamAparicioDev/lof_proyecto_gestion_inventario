# Capa `dominio` — el corazón del negocio

**Regla de oro (Principio VI, NO NEGOCIABLE): esta carpeta es TypeScript puro.**
Prohibido importar NestJS, Prisma, Express, Zod de infraestructura o cualquier otra capa.
El lint (`backend/eslint.config.mjs`) falla si se viola. Si necesitas algo externo
(BD, hash, reloj, archivos), defínelo como **puerto** (interfaz) y deja que
`infraestructura` lo implemente.

## Qué vive aquí

| Carpeta | Contenido | Ejemplo |
|---|---|---|
| `comunes/` | Errores de dominio tipados y tipos base | `DisponibilidadInsuficiente` (FR-028) |
| `entidades/` | Entidades del negocio con sus invariantes y transiciones de estado | `Ingreso` (PENDIENTE→RECIBIDO→VERIFICADO), `Salida`, `Producto` |
| `puertos/` | Interfaces hacia el exterior (repositorios, contadores, hasheador, reloj) | `RepositorioProductos`, `Contadores` |
| `servicios/` | Reglas que cruzan varias entidades | `ServicioStock.aplicarEntrada/aplicarSalida` (Principio I) |

## Convenciones

- Los nombres del dominio están en **español** y coinciden con el glosario de la spec
  (`specs/001-gestion-inventarios/spec.md` — Key Entities): `Salida`, no `Shipment`.
- Toda regla de negocio se protege con **errores tipados** de `comunes/errores.ts`,
  nunca con `throw new Error('...')`.
- Todo puerto y servicio lleva **TSDoc** explicando qué hace, por qué existe y qué
  requisito implementa (`FR-###`) — es la forma acordada de encontrar cada proceso.
- Las transiciones de estado válidas de cada entidad se ven en
  `specs/001-gestion-inventarios/data-model.md` (máquinas de estado).

## Por qué así

Las reglas críticas del sistema (stock nunca negativo, trazabilidad total, validación)
quedan aisladas de frameworks: se prueban con **tests unitarios sin base de datos**
(`backend/test/unit/`) usando puertos falsos en memoria, y sobreviven a cualquier cambio
de tecnología en las capas externas.
