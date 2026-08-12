# Capa `interfaces/http` — la puerta REST

Controladores NestJS, guards, pipes y filtros. Esta capa **traduce HTTP ↔ casos de uso**
y nada más: cero reglas de negocio (si un controlador tiene un `if` de negocio, está en
la capa equivocada).

La fuente de verdad de rutas, códigos y formatos es
`specs/001-gestion-inventarios/contracts/api-rest.md` — los controladores la implementan
tal cual, y cada uno lleva TSDoc con los `FR-###` que expone.

## Piezas transversales (`comunes/`)

| Pieza | Rol |
|---|---|
| `pipe-validacion-zod.ts` | Valida body/query con los esquemas de `@trazo/compartido` (la MISMA validación que el frontend) → 400 con errores por campo en español (Principio IV) |
| `filtro-errores-dominio.ts` | Convierte errores tipados del dominio al formato único `{ error: { mensaje, campos } }` con su código HTTP (400/404/409) |
| `guards/` (T015, migrado en T103) | `JwtAuthGuard` (sesión por cookie httpOnly, revalida en BD que el usuario siga ACTIVO) + `PermisosGuard` con `@RequierePermiso('modulo.accion')`, que autoriza contra los permisos efectivos del rol resueltos en esa misma petición (FR-002/FR-003/FR-058) |

## Anatomía de un controlador (patrón a seguir)

```ts
/**
 * Endpoints de salidas de mercancía (FR-025…FR-033).
 * Contrato: contracts/api-rest.md § Salidas.
 */
@Controller('salidas')
export class ControladorSalidas {
  constructor(private readonly confirmarSalida: ConfirmarSalidaCasoUso /* , ... */) {}

  /** Confirma la salida: descuenta stock atómicamente (FR-028) y fija autorizante (FR-030). */
  @Post(':id/confirmar')
  @RequierePermiso('salidas.confirmar')
  @HttpCode(204)
  async confirmar(@Param('id', ParseIntPipe) id: number, @UsuarioActual() usuario: PerfilSesion) {
    await this.confirmarSalida.ejecutar({ salidaId: id, usuarioId: usuario.id });
  }
}
```

Claves del patrón: decorador `@RequierePermiso` SIEMPRE explícito, entrada validada con
`PipeValidacionZod`, delegación inmediata al caso de uso, sin try/catch (el filtro global
traduce los errores).

Sobre el permiso (US9/T103): se declara **UNO solo** por endpoint (el decorador no es
variádico — así no cabe la duda "¿se exigen todos o basta uno?" en el control de acceso) y
corresponde a una **operación de negocio**, no a una ruta: listar y ver detalle comparten
`*.ver`, y los tres endpoints de carga masiva comparten `productos.importar`. La clave debe
existir en el catálogo sembrado (`prisma/seed.ts`) — es `string` en tipos, así que un permiso
inventado no rompe la compilación: simplemente NADIE lo tendría y el endpoint respondería 403
a todo el mundo. El permiso se puede declarar en la clase (lo hacen `ControladorUsuarios` y
`ControladorRoles`, cuyas rutas exigen todas la misma capacidad) y el del método gana sobre el
de la clase.
