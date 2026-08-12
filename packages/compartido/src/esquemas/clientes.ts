/**
 * Esquemas de clientes y proyectos — catálogo comercial y base del destino obligatorio de
 * salidas (FR-034…FR-038).
 *
 * Implementa: FR-034 (alta de cliente), FR-035 (NIT obligatorio — la unicidad concurrente la
 * refuerza la BD, esto solo valida la FORMA), FR-036 (proyecto de un cliente con fechas y
 * presupuesto coherentes), FR-038 (destino válido de salida — la validación de coherencia de
 * fechas de aquí es solo para UX inmediata, Principio IV; el `CHECK fecha_cierre_estimada >=
 * fecha_inicio` de `data-model.md` es la autoridad en BD) y FR-016/FR-047 (mensajes en
 * español que indican el campo).
 *
 * `esquemaCrearCliente`/`esquemaActualizarCliente` y `esquemaCrearProyecto`/
 * `esquemaActualizarProyecto` comparten exactamente el mismo shape en cada par
 * (contracts/api-rest.md: `PUT /api/clientes/:id` y `PUT /api/proyectos/:id` "mismo
 * esquema" que su `POST`) — se generan con la misma función interna para no duplicar las
 * reglas, patrón de `esquemas/ingresos.ts`.
 *
 * Sigue el patrón de esquemas/autenticacion.ts (archivo ejemplar).
 */
import { z } from 'zod';
import { esquemaPaginacion, esquemaTextoFiltro } from './comunes';

/**
 * Correo opcional: una cadena vacía (campo de formulario sin diligenciar) se trata como "no
 * proporcionado" en vez de disparar el mensaje de "correo no válido" — si el usuario SÍ
 * escribe algo, debe ser un correo con formato válido (FR-016).
 */
function esquemaEmailOpcional() {
  return z.preprocess(
    (valor) => (valor === '' ? undefined : valor),
    z
      .string()
      .trim()
      .max(150, 'El correo no puede superar 150 caracteres')
      .email('El correo no es válido')
      .optional(),
  );
}

/** Construye el esquema de cliente — reutilizado por crear y actualizar (mismo shape). */
function construirEsquemaCliente() {
  return z.object({
    nombre: z
      .string({ required_error: 'El nombre es obligatorio' })
      .trim()
      .min(1, 'El nombre es obligatorio')
      .max(150, 'El nombre no puede superar 150 caracteres'),
    nit: z
      .string({ required_error: 'El NIT es obligatorio' })
      .trim()
      .min(1, 'El NIT es obligatorio')
      .max(30, 'El NIT no puede superar 30 caracteres'),
    telefono: z.string().trim().max(30, 'El teléfono no puede superar 30 caracteres').optional(),
    email: esquemaEmailOpcional(),
    direccion: z.string().trim().max(200, 'La dirección no puede superar 200 caracteres').optional(),
    ciudad: z.string().trim().max(100, 'La ciudad no puede superar 100 caracteres').optional(),
  });
}

/** Body de `POST /api/clientes` (contracts/api-rest.md). */
export const esquemaCrearCliente = construirEsquemaCliente();
export type DatosCrearCliente = z.infer<typeof esquemaCrearCliente>;

/** Body de `PUT /api/clientes/:id` — mismo esquema que crear. */
export const esquemaActualizarCliente = construirEsquemaCliente();
export type DatosActualizarCliente = z.infer<typeof esquemaActualizarCliente>;

/**
 * Fecha (solo día, sin hora — columnas `DATE` de `data-model.md`) OPCIONAL en texto, formato
 * ISO `YYYY-MM-DD`. A diferencia de `esquemas/ingresos.ts` (fechas de cabecera obligatorias),
 * las fechas de un proyecto son opcionales pero deben tener formato válido si vienen
 * (FR-036); una cadena vacía se normaliza a "no proporcionada".
 */
function esquemaFechaOpcional(mensajeInvalida: string) {
  return z
    .string()
    .trim()
    .optional()
    .refine((valor) => valor === undefined || valor === '' || !Number.isNaN(Date.parse(valor)), mensajeInvalida)
    .transform((valor) => (valor === undefined || valor === '' ? undefined : valor));
}

/** Datos de fecha relevantes para validar la coherencia del rango del proyecto. */
interface FechasProyecto {
  fechaInicio?: string;
  fechaCierreEstimada?: string;
}

/**
 * Rechaza `fechaCierreEstimada` anterior a `fechaInicio` cuando AMBAS vienen en el body — esto
 * YA es un `CHECK` en BD (`data-model.md`, tabla `proyectos`); esta validación es solo para
 * retroalimentación inmediata en el formulario (Principio IV). El error se ancla a
 * `fechaCierreEstimada`, el campo que el usuario asocia con el problema.
 */
function validarFechasCoherentes(datos: FechasProyecto, ctx: z.RefinementCtx): void {
  if (!datos.fechaInicio || !datos.fechaCierreEstimada) return;
  if (Date.parse(datos.fechaCierreEstimada) < Date.parse(datos.fechaInicio)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'La fecha de cierre estimada no puede ser anterior a la fecha de inicio',
      path: ['fechaCierreEstimada'],
    });
  }
}

/** Construye el esquema de proyecto — reutilizado por crear y actualizar (mismo shape). */
function construirEsquemaProyecto() {
  return z
    .object({
      nombre: z
        .string({ required_error: 'El nombre es obligatorio' })
        .trim()
        .min(1, 'El nombre es obligatorio')
        .max(150, 'El nombre no puede superar 150 caracteres'),
      descripcion: z.string().trim().optional(),
      fechaInicio: esquemaFechaOpcional('La fecha de inicio no es válida'),
      fechaCierreEstimada: esquemaFechaOpcional('La fecha de cierre estimada no es válida'),
      responsable: z.string().trim().max(150, 'El responsable no puede superar 150 caracteres').optional(),
      presupuestoEstimado: z
        .number({ invalid_type_error: 'El presupuesto estimado debe ser un número' })
        .min(0, 'El presupuesto estimado no puede ser negativo')
        .optional(),
    })
    .superRefine(validarFechasCoherentes);
}

/** Body de `POST /api/clientes/:id/proyectos` (contracts/api-rest.md). */
export const esquemaCrearProyecto = construirEsquemaProyecto();
export type DatosCrearProyecto = z.infer<typeof esquemaCrearProyecto>;

/** Body de `PUT /api/proyectos/:id` — mismo esquema que crear. */
export const esquemaActualizarProyecto = construirEsquemaProyecto();
export type DatosActualizarProyecto = z.infer<typeof esquemaActualizarProyecto>;

/**
 * Query de `GET /api/clientes?buscar=&estado=&ciudad=` — filtro de búsqueda (nombre/NIT),
 * estado y ciudad, más la paginación común a todos los listados (`esquemas/comunes.ts`), mismo
 * patrón que `esquemaFiltroIngresos` (FR-034).
 *
 * `ciudad` (US13, FR-075/FR-076) es igualdad EXACTA, no subcadena: es texto libre que capturó un
 * humano, así que la pantalla la ofrece como selección de las ciudades que EXISTEN entre los
 * clientes (`GET /api/clientes/opciones-filtro`) en vez de pedirle al usuario que adivine la
 * ortografía — mismo criterio que `categoria`/`ubicacion` en el inventario.
 */
export const esquemaFiltroClientes = z
  .object({
    buscar: z.string().trim().optional(),
    ciudad: esquemaTextoFiltro(),
    estado: z.enum(['ACTIVO', 'INACTIVO'], { errorMap: () => ({ message: 'El estado no es válido' }) }).optional(),
  })
  .merge(esquemaPaginacion);
export type FiltroClientes = z.infer<typeof esquemaFiltroClientes>;

/**
 * Body de `PUT /api/clientes/:id/estado` (contracts/api-rest.md) — baja lógica de un
 * cliente (Principio II/III: nunca DELETE). Un cliente `INACTIVO` deja de aportar destinos
 * válidos de salida para cualquiera de sus proyectos (FR-038).
 */
export const esquemaCambiarEstadoCliente = z.object({
  estado: z.enum(['ACTIVO', 'INACTIVO'], { errorMap: () => ({ message: 'El estado no es válido' }) }),
});
export type DatosCambiarEstadoCliente = z.infer<typeof esquemaCambiarEstadoCliente>;

/**
 * Body de `PUT /api/proyectos/:id/estado` (contracts/api-rest.md, US2-AS4) — transición de
 * la máquina de estados del proyecto. Un proyecto que deja de estar `ACTIVO` deja de ser
 * destino válido de nuevas salidas de inmediato (FR-038, `esDestinoValido` en
 * `dominio/entidades/proyecto.ts`).
 */
export const esquemaCambiarEstadoProyecto = z.object({
  estado: z.enum(['ACTIVO', 'COMPLETADO', 'SUSPENDIDO'], { errorMap: () => ({ message: 'El estado no es válido' }) }),
});
export type DatosCambiarEstadoProyecto = z.infer<typeof esquemaCambiarEstadoProyecto>;
