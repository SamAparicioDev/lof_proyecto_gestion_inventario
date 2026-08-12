/**
 * Módulo de clientes y proyectos — cablea `/api/clientes` y `/api/proyectos` (US2) con sus
 * seis casos de uso. Los puertos `RepositorioClientes`/`RepositorioProyectos` ya los provee
 * `PersistenciaModule` (`@Global`, T041): este módulo NO los vuelve a registrar, solo
 * declara los casos de uso y los dos controladores que los consumen (docs/arquitectura.md —
 * los módulos de NestJS solo cablean).
 */
import { Module } from '@nestjs/common';
import { ActualizarClienteCasoUso } from '../../../aplicacion/clientes/actualizar-cliente.caso-uso';
import { ActualizarProyectoCasoUso } from '../../../aplicacion/clientes/actualizar-proyecto.caso-uso';
import { CambiarEstadoClienteCasoUso } from '../../../aplicacion/clientes/cambiar-estado-cliente.caso-uso';
import { CambiarEstadoProyectoCasoUso } from '../../../aplicacion/clientes/cambiar-estado-proyecto.caso-uso';
import { CrearClienteCasoUso } from '../../../aplicacion/clientes/crear-cliente.caso-uso';
import { CrearProyectoCasoUso } from '../../../aplicacion/clientes/crear-proyecto.caso-uso';
import { EliminarLogoClienteCasoUso } from '../../../aplicacion/clientes/eliminar-logo-cliente.caso-uso';
import { GuardarLogoClienteCasoUso } from '../../../aplicacion/clientes/guardar-logo-cliente.caso-uso';
import { ControladorProyectos } from '../proyectos/controlador-proyectos';
import { ControladorClientes } from './controlador-clientes';

@Module({
  controllers: [ControladorClientes, ControladorProyectos],
  providers: [
    CrearClienteCasoUso,
    ActualizarClienteCasoUso,
    CambiarEstadoClienteCasoUso,
    CrearProyectoCasoUso,
    ActualizarProyectoCasoUso,
    CambiarEstadoProyectoCasoUso,
    // US11/T118 — logo del cliente (FR-066).
    GuardarLogoClienteCasoUso,
    EliminarLogoClienteCasoUso,
  ],
})
export class ClientesModule {}
