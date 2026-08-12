/**
 * Caso de uso `OpcionesFiltroInventarioCasoUso` — valores que hoy EXISTEN en el catálogo para
 * los dos campos de clasificación de texto libre del producto, categoría y ubicación
 * (`GET /api/inventario/opciones-filtro`, US13/FR-076).
 *
 * Por qué existe (y por qué no es una caja de texto en la pantalla): `categoria` y `ubicacion`
 * son texto libre sin catálogo propio (FR-052, decisión de US8), capturado a mano y a menudo por
 * otra persona. Un filtro que exigiera teclear el valor exacto —"Ferretería" con tilde,
 * "Bodega 1" con espacio— sería un filtro que nadie usa porque falla la primera vez. Publicar los
 * valores presentes convierte el filtro en una elección, no en una adivinanza.
 *
 * Es un caso de uso y no una lectura directa del repositorio en el controlador porque
 * `ControladorInventario` lo hace SIEMPRE así (ver su TSDoc de clase): a diferencia de
 * clientes/salidas/ingresos, ninguna de sus rutas habla con un repositorio a la cara.
 *
 * El universo de valores NO depende del filtro vigente, a propósito: si al filtrar por
 * "Ferretería" el selector dejara de ofrecer las demás categorías, el filtro sería una trampa de
 * un solo uso (habría que limpiarlo para poder cambiarlo).
 *
 * Implementa: FR-076 (los filtros de texto libre se ofrecen como selección de lo que existe).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import {
  REPOSITORIO_PRODUCTOS,
  type RepositorioProductos,
  type ValoresClasificacionProductos,
} from '../../dominio/puertos/repositorio-productos';

@Injectable()
export class OpcionesFiltroInventarioCasoUso implements CasoDeUso<void, ValoresClasificacionProductos> {
  constructor(@Inject(REPOSITORIO_PRODUCTOS) private readonly repositorioProductos: RepositorioProductos) {}

  async ejecutar(): Promise<ValoresClasificacionProductos> {
    return this.repositorioProductos.valoresDeClasificacion();
  }
}
