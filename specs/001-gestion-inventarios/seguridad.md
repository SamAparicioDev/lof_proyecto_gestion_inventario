# Revisión transversal de seguridad y arquitectura (T088)

**Fecha**: 2026-08-11
**Alcance**: Checklist contra Principios III (Control de Acceso por Roles), IV (Validación
Estricta de Datos) y VI (Arquitectura Hexagonal y Calidad de Código) de la constitución
(`.specify/memory/constitution.md`). Verificado con pruebas reales contra `localhost:4000`
(backend real corriendo, no solo lectura de código) y con dos intentos deliberados de romper
el lint de fronteras.

**Cómo leer este documento**: cada ítem queda marcado **OK** (verificado, sin hallazgo) o
**HALLAZGO** (problema real encontrado). Los dos hallazgos reales de esta revisión ya están
corregidos y verificados en verde — ver la sección "Hallazgos y correcciones" al final.

---

## (a) `password_hash` nunca en una respuesta HTTP

**Estado: OK**

Probado en vivo contra la API real (login como `admin`, `gerente.demo`, `operario.demo`):

| Endpoint | Método de prueba | Resultado |
|---|---|---|
| `POST /api/auth/login` | `curl -i` (respuesta completa) | `204 No Content`, sin cuerpo — no hay superficie para filtrar el hash |
| `GET /api/auth/perfil` | `curl -i` (JSON crudo) | `{"id","nombreCompleto","rol","debeCambiarPassword"}` — sin `passwordHash`/`password_hash` |
| `GET /api/usuarios` (14 usuarios reales, admin) | `curl -i` (JSON crudo, 2618 bytes) | Ningún campo de contraseña en ninguno de los 14 registros |

Revisión de código que explica **por qué** estructuralmente, no solo "porque no until ahora
nadie lo mandó": `backend/src/infraestructura/persistencia/repositorio-usuarios.prisma.ts`
tiene dos mapeadores distintos —

- `aUsuarioDominio(registro)` (usada por `listar`/`buscarPorId`/`crear`/`actualizar`, es
  decir TODOS los caminos que llegan a un controlador) construye el objeto de dominio
  `Usuario` campo por campo, sin incluir `passwordHash` — el campo no puede "escaparse" por
  descuido en un `select *`, porque el tipo `Usuario` de dominio ni siquiera lo declara.
- `aUsuarioAutenticable(registro)` (usada SOLO por `buscarPorLogin`/
  `buscarConCredencialesPorId`, consumidas SOLO por `ControladorAuth.login` y por
  `CambiarMiPasswordCasoUso`) es la única que añade `passwordHash`, y ninguno de sus dos
  consumidores lo serializa en una respuesta.

`backend/src/interfaces/http/usuarios/controlador-usuarios.ts` (`crear`/`actualizar`)
devuelven `{id}` o `void`, nunca la entidad completa. Ningún `include: { usuario: ... }` de
Prisma aparece en `infraestructura/persistencia` que pudiera colar un objeto `usuario` anidado
con el hash (verificado por grep en todo `infraestructura/persistencia`); el enriquecimiento
de `usuarioNombre` en el historial de movimientos (`historial-producto.caso-uso.ts`) pasa por
`RepositorioUsuarios.buscarPorId` (el mapeador sin hash), nunca por el de credenciales.

---

## (b) Cookies de sesión httpOnly

**Estado: OK**

`Set-Cookie` real capturado con `curl -i` tras `POST /api/auth/login`:

```
Set-Cookie: trazo_sesion=eyJhbGci...; Max-Age=28800; Path=/; Expires=...; HttpOnly; SameSite=Lax
```

- `HttpOnly` presente — confirmado en las tres cuentas probadas (admin, gerente.demo,
  operario.demo) y también en la renovación deslizante (cada petición autenticada reemite la
  cookie con `HttpOnly` intacto, `jwt-auth.guard.ts::renovarCookieSesion`).
- `SameSite=Lax` — mitiga CSRF en peticiones cross-site que cambian estado (POST/PUT), sin
  romper la navegación normal.
- `Secure` está condicionado a `process.env.NODE_ENV === 'production'`
  (`infraestructura/seguridad/cookie-sesion.ts`): ausente en este entorno de desarrollo (HTTP
  plano, `localhost`), lo cual es correcto — con `Secure` fijo el navegador jamás enviaría la
  cookie sobre HTTP y la app no funcionaría en dev. Queda como responsabilidad operativa
  confirmar `NODE_ENV=production` en el despliegue real para que `Secure` se active (no hay
  infraestructura de despliegue en este repo que verificar todavía).
- `Max-Age=28800` = 8h, coincide con `DURACION_SESION_SEGUNDOS` y con el contrato.
- El token nunca se expone en el body de `perfil` ni en ningún JSON — solo viaja en la
  cookie, nunca en un header `Authorization` (`estrategia-jwt.ts` lo extrae únicamente de la
  cookie).

---

## (c) 401/403 coherentes en el 100% de los endpoints protegidos

**Estado: OK**

Arquitectura de guards (`app.module.ts`): `JwtAuthGuard` y `RolesGuard` están registrados
como `APP_GUARD` **globales** — se aplican a todo controlador por defecto; una ruta necesita
un decorador explícito (`@Public()`) para escapar de `JwtAuthGuard`. Las únicas dos rutas
`@Public()` del sistema son `POST /api/auth/login` y `GET /api/salud`, ambas correctas (login
no puede exigir sesión previa; salud es un healthcheck de infraestructura).

`RolesGuard` deniega por defecto SOLO cuando el endpoint declara `@Roles(...)`; un endpoint
sin `@Roles` es accesible a cualquier usuario AUTENTICADO (no anónimo) — comportamiento
documentado explícitamente en el TSDoc de `roles.guard.ts` y correcto para las rutas de
autoservicio (`logout`/`perfil`/`password`) y las de consulta abiertas a los tres roles
(inventario, listados). Se auditó cada uno de los 11 controladores de
`backend/src/interfaces/http/**/controlador-*.ts` línea por línea (`@Controller`/`@Get`/
`@Post`/`@Put`/`@Roles`/`@Public`) y se contrastó cada ruta contra el rol que exige
`spec.md`/`contracts/api-rest.md`:

| Controlador | Cobertura de `@Roles` | Coincide con la spec |
|---|---|---|
| `auth` | login público; logout/perfil/password sin restricción de rol (autoservicio) | Sí |
| `salud` | público | Sí |
| `usuarios` | `@Roles('ADMINISTRADOR')` a nivel de clase, las 5 rutas | Sí (FR-005…FR-009) |
| `reportes` | `@Roles('ADMINISTRADOR','GERENTE')` en las 8 rutas (4 reportes × pantalla/export) | Sí (FR-039…044) |
| `clientes` | lectura A/G/O; alta/edición/estado/proyectos A/G | Sí (FR-034) |
| `proyectos` | edición/estado A/G | Sí (FR-036) |
| `productos` | lectura/alta-rápida A/G/O; edición/estado/plantilla/importar A/G | Sí (FR-011/FR-012, US8-AS4) |
| `ingresos` | lectura/alta/edición/recibir A/G/O; verificar/anular A/G | Sí (FR-013…019) |
| `salidas` | lectura/alta/edición/confirmar/completar/cancelar A/G/O; anular A/G | Sí (FR-025…032) |
| `inventario` | lectura A/G/O | Sí (US5: "cualquier usuario autenticado") |

Verificación EN VIVO (no solo lectura), con sesiones reales de `admin`/`gerente.demo`/
`operario.demo`:

| Prueba | Esperado | Obtenido |
|---|---|---|
| `GET /api/usuarios` sin cookie | `401` | `401` |
| `GET /api/usuarios` como operario | `403` | `403` |
| `GET /api/usuarios` como gerente | `403` | `403` |
| `GET /api/reportes/consumo-cliente` como operario | `403` | `403` |
| `GET /api/reportes/consumo-cliente` como gerente | `200` | `200` |
| `POST /api/clientes` como operario | `403` | `403` |
| `POST /api/salidas/1/anular` como operario | `403` | `403` |
| `GET /api/productos/plantilla-importacion` como operario | `403` | `403` |
| `GET /api/inventario` sin cookie | `401` (no `403`: confirma que `JwtAuthGuard` corre antes que `RolesGuard`) | `401` |
| `GET /api/inventario` como operario | `200` | `200` |

Los cuerpos de `401`/`403` siguen el formato único `{error:{mensaje,campos:null}}` en
español ("Debes iniciar sesión para continuar." / "No tienes permisos para realizar esta
acción."), sin trazas ni detalles internos — confirmado con `curl` crudo.

`ControladorAuth.login` además compara SIEMPRE contra un hash señuelo cuando el login no
existe (`HASH_SIMULADO`, comentado en el propio archivo como mitigación de canal lateral de
tiempo) — refuerza el mensaje genérico de credenciales inválidas (US6-AS4), verificado con
`curl` que el mensaje y el tamaño de respuesta son IDÉNTICOS para login inexistente y
password incorrecta.

---

## (d) Validación Zod en todos los bodies/queries

**Estado: HALLAZGO real, corregido** (ver detalle en "Hallazgos y correcciones")

Se hizo un grep exhaustivo de todo `@Body(...)`/`@Query(...)` en
`backend/src/interfaces/http/**/controlador-*.ts`. Antes de la corrección, **3 de 33** usos
(`POST /api/salidas/:id/cancelar`, `POST /api/salidas/:id/anular`,
`POST /api/ingresos/:id/anular`) extraían `motivo` con `@Body('motivo')` SIN pasar por
`PipeValidacionZod` — el resto (30/33) ya usaba el pipe correctamente. Confirmado en vivo que
un `motivo` no-string (`123`, `["a"]`, `{"a":1}`) producía un `500 Internal Server Error` en
vez de un `400` de campo. Corregido con un esquema `esquemaMotivo` compartido — ver abajo.
Tras la corrección, un grep de `@Body('` / `@Query('` (sin `PipeValidacionZod`) en todo
`interfaces/http` no devuelve resultados: **0/33** usos sin pipe.

La subida de archivo de `POST /api/productos/importar` no usa Zod (no aplica a un
`multipart/form-data` binario) pero sí valida por otras vías equivalentes: `FileInterceptor`
con límite de tamaño a nivel de Multer (5 MB, corta el stream en vez de bufferizar completo
en memoria — corrección de un hallazgo HIGH de una revisión adversarial anterior, documentada
en el propio TSDoc del controlador) y cada fila del Excel se valida individualmente contra
`esquemaFilaImportacionProducto` dentro del caso de uso (FR-051).

---

## (e) `npm run lint -w backend` — cero violaciones de la regla de dependencia hexagonal

**Estado: HALLAZGO real, corregido** (ver detalle en "Hallazgos y correcciones")

Prueba positiva (el lint SÍ rechaza lo que debe rechazar): se agregó deliberadamente
`import { Injectable } from '@nestjs/common';` a `backend/src/dominio/comunes/errores.ts` y
se corrió `npm run lint -w backend`:

```
error  '@nestjs/common' import is restricted from being used by a pattern.
       El dominio no puede depender de NestJS (Principio VI)   no-restricted-imports
```

Rechazado con el mensaje exacto esperado. Se revirtió el cambio de inmediato y se confirmó
`npm run lint -w backend` limpio de nuevo.

Prueba negativa (¿hay una capa que el lint NO cubre?): `backend/eslint.config.mjs` solo tenía
reglas `no-restricted-imports` para `src/dominio/**` y `src/aplicacion/**`. La tabla de
`docs/arquitectura.md` §2 dice explícitamente que `interfaces/http` tiene PROHIBIDO
"Prisma directo", pero no había ninguna regla de lint que lo hiciera cumplir. Se confirmó el
hueco agregando deliberadamente `import type { PrismaClient } from '@prisma/client';` a
`backend/src/interfaces/http/salud/controlador-salud.ts`: el lint pasó sin ningún error de
fronteras (solo el error genérico, no relacionado, de "variable sin usar"). Corregido — ver
abajo. Se revirtió el archivo de prueba.

`npm run lint -w backend` queda en verde al cierre de esta revisión (ver evidencia de
`npm run verificar` al final).

---

## Hallazgos y correcciones

### Hallazgo 1 (validación, ítem d): `motivo` sin tipo runtime garantizado → `500` en vez de `400`

**Dónde**: `backend/src/interfaces/http/salidas/controlador-salidas.ts` (`cancelar`,
`anular`) y `backend/src/interfaces/http/ingresos/controlador-ingresos.ts` (`anular`).

**Causa raíz**: los tres métodos leían `@Body('motivo') motivo: string | undefined` — la
anotación de tipo de TypeScript es solo compile-time; en runtime, un cliente que mande
`{"motivo": 123}` (o un arreglo/objeto) llega intacto hasta el caso de uso
(`AnularSalidaCasoUso`/`CancelarSalidaCasoUso`/`AnularIngresoCasoUso`), donde
`entrada.motivo.trim()` lanza un `TypeError` sin tipo de dominio. `FiltroErroresDominio` no
lo reconoce como ninguno de sus errores tipados y cae en la rama genérica: `500` con mensaje
"Ocurrió un error inesperado...", en vez del `400` de campo que exige la constitución
(Principio IV) y el propio patrón del resto de la API.

**Verificado en vivo ANTES de corregir** (con sesión real de `gerente.demo`, contra un id
inexistente para no requerir un documento real):

```
POST /api/salidas/999999/anular   {"motivo": 123}      → 500
POST /api/ingresos/999999/anular  {"motivo": 123}      → 500
POST /api/salidas/999999/cancelar {"motivo": 123}      → 500
```

**Corrección**: nuevo esquema compartido `esquemaMotivo` en
`packages/compartido/src/esquemas/comunes.ts` (`{ motivo: z.string(...).optional() }`) — solo
garantiza el TIPO; la regla de negocio "no puede estar vacío" se deja donde ya vivía
correctamente, en cada caso de uso (con su mensaje específico: "El motivo de
anulación/cancelación es obligatorio"), porque es una decisión de negocio con matices por
operación, no una regla de forma. Los tres controladores ahora usan
`@Body(new PipeValidacionZod(esquemaMotivo)) datos: DatosMotivo`.

**Verificado en vivo DESPUÉS de corregir**:

```
POST /api/salidas/999999/anular   {"motivo": 123}   → 400 {"campos":{"motivo":"El motivo debe ser un texto"}}
POST /api/ingresos/999999/anular  {"motivo": ["a"]} → 400 {"campos":{"motivo":"El motivo debe ser un texto"}}
POST /api/salidas/999999/cancelar {"motivo": {"a":1}} → 400 {"campos":{"motivo":"El motivo debe ser un texto"}}

# comportamiento previo preservado (motivo vacío/ausente sigue siendo la validación de negocio existente):
POST /api/salidas/999999/anular   {"motivo": ""}    → 400 "El motivo de anulación es obligatorio"
POST /api/ingresos/999999/anular  {}                → 400 "El motivo de anulación es obligatorio"
POST /api/salidas/999999/anular   {"motivo": "ok"}  → 404 (llega hasta la búsqueda del documento, como antes)
```

**Regresión**: `npm run test:integracion -w backend -- salidas.spec.ts salidas-stock.spec.ts
ingresos.spec.ts conciliacion.spec.ts` (las 4 suites que ejercitan `anular`/`cancelar` con un
`motivo` de texto real) — 17/17 en verde, sin cambios de comportamiento para el camino feliz.

### Hallazgo 2 (arquitectura, ítem e): `interfaces/http` sin regla de lint contra Prisma directo

**Dónde**: `backend/eslint.config.mjs`.

**Causa raíz**: `docs/arquitectura.md` §2 documenta que `interfaces/http` tiene prohibido
importar Prisma directamente (debe pasar por un caso de uso o un puerto), pero el archivo de
configuración de ESLint solo definía el bloque `no-restricted-imports` para `src/dominio/**`
y `src/aplicacion/**` — la fila de la tabla correspondiente a `interfaces/http` no tenía
ninguna regla automática que la hiciera cumplir. Ningún archivo real de `interfaces/http`
importa Prisma hoy (confirmado por grep antes de tocar nada), así que esto NO era una
violación activa, pero sí un hueco real en la "barrera automática" que la constitución dice
que existe ("si el lint falla, el diseño está mal, no el lint" — CLAUDE.md raíz).

**Corrección**: nuevo bloque en `backend/eslint.config.mjs` para `files: ['src/interfaces/**/*.ts']`
con `no-restricted-imports` sobre `@prisma/*`/`.prisma/*`, mismo patrón que el bloque ya
existente de `aplicacion`.

**Verificado**: se repitió la prueba con un import de prueba de `PrismaClient` en
`controlador-salud.ts` — ahora el lint lo rechaza con
`"interfaces/http no puede depender de Prisma directo; pasa por un caso de uso o un puerto (docs/arquitectura.md §2)"`.
Se revirtió el archivo de prueba; `npm run lint -w backend` queda limpio (no había ninguna
violación real preexistente que la nueva regla sacara a la luz).

---

## Nota menor (no corregida, informativa)

- `JWT_SECRET`/`SEED_ADMIN_PASSWORD` en `backend/.env` de este entorno siguen siendo el valor
  de plantilla de `.env.example` ("cambia-este-secreto"/"cambia-esta-clave"). No hay ningún
  chequeo de arranque que rechace un secreto/contraseña semilla obviamente débil en
  `NODE_ENV=production`. Es una responsabilidad operativa de despliegue (ya documentada como
  tal en los comentarios de `.env.example`: "Genera uno propio"), no un defecto de código, y
  agregar una validación de "fuerza" del secreto en el arranque sería una regla nueva no
  pedida por ningún FR/tarea (Principio V, YAGNI) — se documenta aquí para que quede
  registrado antes de un despliegue real, sin tocar código.

---

## Verificación final

```
npm run lint -w backend       → limpio (incluida la regla nueva de interfaces/http)
npm run lint -w frontend      → limpio
npm run typecheck -w backend  → limpio
npm run typecheck -w frontend → limpio
npm run test -w backend       → 6 suites / 57 pruebas unitarias en verde
```

Adicional (no exigido por `npm run verificar`, corrido igual por tocar código de
`anular`/`cancelar` que SÍ tienen pruebas de integración críticas, T056/T057/T058):

```
npm run test:integracion -w backend -- salidas.spec.ts salidas-stock.spec.ts ingresos.spec.ts conciliacion.spec.ts
  → 4 suites / 17 pruebas en verde
```

## Archivos tocados en esta revisión

- `packages/compartido/src/esquemas/comunes.ts` — nuevo `esquemaMotivo`/`DatosMotivo`
- `backend/src/interfaces/http/salidas/controlador-salidas.ts` — `cancelar`/`anular` usan el pipe Zod
- `backend/src/interfaces/http/ingresos/controlador-ingresos.ts` — `anular` usa el pipe Zod
- `backend/eslint.config.mjs` — nueva regla de fronteras para `src/interfaces/**`
