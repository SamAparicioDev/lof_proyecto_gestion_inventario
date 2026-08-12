/**
 * Caso de uso `ResolverLogoDocumentoCasoUso` — decide QUÉ logo (si alguno) lleva un archivo
 * exportado (US11, FR-067/FR-068/FR-069). Es el único lugar del sistema donde se responde esa
 * pregunta, para que las cuatro exportaciones nuevas y las de reportes no la contesten cada una
 * a su manera.
 *
 * ## La regla (contracts/api-rest.md § Exportación de procesos y logo del cliente)
 *
 * El logo se incluye **solo cuando el export corresponde a UN ÚNICO cliente**: el documento de
 * una salida, el reporte de consumo por cliente, el de consumo por proyecto y el listado de
 * salidas filtrado por `clienteId`. Un export que abarca VARIOS clientes o NINGUNO (inventario,
 * movimientos, ingresos, salidas sin filtrar) va **sin logo**: no existiría uno correcto que
 * mostrar, y poner el de cualquiera sería peor que no poner ninguno (US11-AS4).
 *
 * Por eso las dos entradas son OPCIONALES y devolver `undefined` es una respuesta normal, no un
 * fallo: "este archivo no corresponde a un solo cliente".
 *
 * ## Los proyectos no tienen logo propio (FR-069)
 *
 * `porProyecto` resuelve el cliente DUEÑO del proyecto y usa SU logo: la identidad visual es de
 * la empresa, no del trabajo puntual que se le factura.
 *
 * ## Nunca falla (FR-068)
 *
 * Ningún camino de este caso de uso lanza. Si el cliente no existe, no tiene logo, o la lectura
 * de los bytes falla (columna corrupta, incidente de base de datos), devuelve `undefined` y el
 * archivo se genera igual sin logo. El contenido de datos manda sobre la decoración: un PDF de
 * entrega sin logotipo sirve; un `500` en mitad de una descarga, no.
 *
 * Implementa: FR-067 (logo en todo export de un único cliente), FR-068 (su ausencia o su fallo
 * nunca impiden generar el archivo), FR-069 (un proyecto hereda el logo de su cliente).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LogoDocumento } from '../reportes/puertos/exportador-reporte';
import { REPOSITORIO_CLIENTES, type RepositorioClientes } from '../../dominio/puertos/repositorio-clientes';
import { REPOSITORIO_PROYECTOS, type RepositorioProyectos } from '../../dominio/puertos/repositorio-proyectos';

/**
 * A qué corresponde el archivo. Ambos campos opcionales: sin ninguno (o con `clienteId`
 * indefinido porque el usuario no filtró por cliente) el resultado es `undefined`, que es
 * exactamente lo que pide US11-AS4 para un export multi-cliente.
 */
export interface ResolverLogoDocumentoEntrada {
  readonly clienteId?: number;
  /** Proyecto del que se deriva el cliente dueño (FR-069) — se ignora si ya llega `clienteId`. */
  readonly proyectoId?: number;
}

@Injectable()
export class ResolverLogoDocumentoCasoUso {
  private readonly registro = new Logger(ResolverLogoDocumentoCasoUso.name);

  constructor(
    @Inject(REPOSITORIO_CLIENTES) private readonly repositorioClientes: RepositorioClientes,
    @Inject(REPOSITORIO_PROYECTOS) private readonly repositorioProyectos: RepositorioProyectos,
  ) {}

  /**
   * Logo a incrustar, o `undefined` si el archivo no corresponde a un único cliente, ese
   * cliente no tiene logo, o su lectura falló (los tres casos son "genera el archivo sin
   * logo" — FR-068).
   */
  async ejecutar(entrada: ResolverLogoDocumentoEntrada): Promise<LogoDocumento | undefined> {
    try {
      const clienteId = await this.resolverClienteId(entrada);
      if (clienteId === undefined) return undefined;

      const logo = await this.repositorioClientes.obtenerLogo(clienteId);
      return logo ?? undefined;
    } catch (error) {
      // Se registra pero NO se propaga: la exportación continúa sin logo (FR-068). Si esto se
      // repite, el rastro queda en el log del servidor, no en la cara del usuario.
      this.registro.warn(
        `No fue posible resolver el logo del cliente para una exportación; el archivo se genera sin logo. ${String(error)}`,
      );
      return undefined;
    }
  }

  /** `clienteId` explícito si viene; si no, el cliente DUEÑO del proyecto (FR-069). */
  private async resolverClienteId(entrada: ResolverLogoDocumentoEntrada): Promise<number | undefined> {
    if (entrada.clienteId !== undefined) return entrada.clienteId;
    if (entrada.proyectoId === undefined) return undefined;

    const proyecto = await this.repositorioProyectos.buscarPorId(entrada.proyectoId);
    return proyecto?.clienteId;
  }
}
