/**
 * Controlador `ControladorPanel` — `GET /api/panel` (contracts/api-rest.md § Panel de control,
 * US10/FR-060…FR-063). Traduce HTTP ↔ `ResumenPanelCasoUso`; cero reglas de negocio y cero
 * cálculo propio: el controlador ni siquiera sabe qué cifras existen, solo entrega el usuario
 * autenticado y devuelve lo que el caso de uso compone (docs/arquitectura.md §2).
 *
 * ## Por qué este endpoint NO declara `@RequierePermiso` (decisión de autorización, FR-062)
 *
 * El contrato lo publica para los tres roles del sistema (A,G,O) porque es la RUTA DE INICIO:
 * es lo que ve cualquier usuario al iniciar sesión. Exigirle un permiso propio (`panel.ver`)
 * crearía una casilla capaz de dejar a un rol sin portada —un `403` en `/`, justo el problema
 * que US10 viene a resolver— sin proteger nada nuevo: TODO su contenido ya está gateado dentro
 * del caso de uso, sección por sección, contra los MISMOS permisos que exigen los endpoints de
 * detalle (`inventario.ver`, `salidas.ver`, `ingresos.ver`, `reportes.ver`). Una sesión sin
 * ninguno de ellos recibe `200` con un objeto vacío `{}` — no hay nada que filtrar porque no se
 * calculó nada. Es el mismo criterio con el que `PermisosGuard` deja sin permiso las rutas que
 * un usuario autenticado ejerce sobre sí mismo (`GET /api/auth/perfil`): la sesión no es un
 * dato de negocio, y aquí el negocio ya está protegido pieza por pieza.
 *
 * Implementa: FR-060 (la ruta de inicio devuelve el panel operativo), FR-062 (el recorte por
 * permisos ocurre en el servidor: las claves que la sesión no puede consultar no se envían) y
 * FR-063 (composición de los casos de uso existentes, nunca un cálculo paralelo).
 */
import { Controller, Get } from '@nestjs/common';
import { ResumenPanelCasoUso, type ResumenPanel } from '../../../aplicacion/panel/resumen-panel.caso-uso';
import type { Usuario } from '../../../dominio/entidades/usuario';
import { UsuarioActual } from '../comunes/usuario-actual.decorator';

@Controller('panel')
export class ControladorPanel {
  constructor(private readonly resumenPanel: ResumenPanelCasoUso) {}

  /** `GET /api/panel` — resumen operativo con SOLO las secciones que la sesión puede consultar. */
  @Get()
  async resumen(@UsuarioActual() usuario: Usuario): Promise<ResumenPanel> {
    return this.resumenPanel.ejecutar({ usuario });
  }
}
