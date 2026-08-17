/**
 * @trazo/compartido — punto de entrada del contrato compartido.
 *
 * Qué vive aquí y por qué:
 * - `tipos/`    → formas de la API REST (errores, paginación) que frontend y backend
 *                 deben interpretar EXACTAMENTE igual (contracts/api-rest.md).
 * - `esquemas/` → esquemas Zod por módulo, con mensajes en español. El frontend los usa
 *                 para feedback inmediato (react-hook-form) y el backend los usa como
 *                 autoridad (PipeValidacionZod). Una sola fuente de verdad = Principio IV
 *                 de la constitución (Validación Estricta de Datos).
 *
 * Regla: este paquete NO importa NestJS, Next.js, Prisma ni ningún framework.
 * Solo Zod y TypeScript puro, para que ambos lados puedan consumirlo sin arrastre.
 *
 * Cada módulo de la spec agrega aquí su archivo de esquemas (ver tasks.md):
 * autenticacion (T013), productos/ingresos (T028), clientes (T039), salidas (T047),
 * inventario (T059/T060), reportes (T068), usuarios (T075/T077). `tipos/clientes.ts`
 * (T044) sigue el mismo criterio que `tipos/ingresos.ts`: formas de RESPUESTA (no de body
 * validado) de `GET /api/clientes*`. `tipos/reportes.ts` (T071/T072) sigue el mismo
 * criterio para `GET /api/reportes/consumo-{cliente,proyecto}`. `tipos/usuarios.ts` (T077)
 * agrega la forma de `GET /api/usuarios*`, que T075 dejó pendiente (solo agregó los
 * esquemas de validación de entrada). `tipos/roles.ts` + `esquemas/roles.ts` (US9) agregan
 * el contrato de `/api/roles` y `/api/permisos`, y `PerfilSesion` (en `tipos/api.ts`) gana
 * `permisos: string[]` — la lista con la que el frontend filtra navegación y botones
 * (FR-058; la autoridad sigue siendo el guard del servidor). `tipos/panel.ts` (US10/T115)
 * agrega la forma de `GET /api/panel`, con TODAS sus secciones opcionales porque el servidor
 * omite del JSON las que la sesión no puede consultar (FR-062).
 */
export * from './tipos/api';
export * from './tipos/productos';
export * from './tipos/ingresos';
export * from './tipos/clientes';
export * from './tipos/salidas';
export * from './tipos/inventario';
export * from './tipos/reportes';
export * from './tipos/usuarios';
export * from './tipos/roles';
export * from './tipos/panel';
export * from './tipos/ordenes-compra';
export * from './tipos/cotizaciones';
export * from './esquemas/autenticacion';
export * from './esquemas/comunes';
export * from './esquemas/impuestos';
export * from './esquemas/categorias';
export * from './esquemas/proveedores';
export * from './esquemas/unidades-medida';
export * from './esquemas/productos';
export * from './esquemas/ingresos';
export * from './esquemas/clientes';
export * from './esquemas/salidas';
export * from './esquemas/inventario';
export * from './esquemas/reportes';
export * from './esquemas/usuarios';
export * from './esquemas/roles';
export * from './esquemas/ordenes-compra';
export * from './esquemas/cotizaciones';
