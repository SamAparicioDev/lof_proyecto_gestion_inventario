/**
 * Adaptador `ContadoresPrisma` — implementa el puerto `Contadores` del dominio con Prisma
 * (patrón Repository/Adapter, docs/arquitectura.md §3). `UPDATE contadores SET valor =
 * valor + 1 WHERE clave = $1 RETURNING valor` vía `$queryRaw` — atómico por sí mismo gracias
 * al `UPDATE ... RETURNING` de PostgreSQL, sin necesidad de `SELECT ... FOR UPDATE` previo
 * (research R5).
 *
 * Decisión de tx-scoping (research R5, requisito de T049): `siguienteNumero` (el método del
 * PUERTO) ejecuta el `UPDATE` sobre `this.prisma` directamente — útil si algún día se llama
 * de forma standalone, fuera de una transacción mayor. PERO cuando `RepositorioSalidasPrisma
 * .crear` lo necesita, el número asignado DEBE persistirse o revertirse JUNTO con el
 * `INSERT` de la salida (si la creación falla después de incrementar el contador, ese número
 * NO debe quedar "quemado" de forma visible aunque perder algunos huecos ante rollback es
 * aceptable — lo que no es aceptable es la carrera de `MAX()+1`). Por eso se expone
 * `siguienteNumeroEnTransaccion(tx, clave)`: la MISMA query, pero recibiendo el
 * `PrismaTransactionClient` (`tx`) ya abierto por `UnidadDeTrabajo.ejecutar` en el
 * repositorio llamador, en vez de abrir su propia conexión. Este método NO forma parte del
 * puerto `Contadores` del dominio (el dominio no conoce `Prisma.TransactionClient` —
 * docs/arquitectura.md §2); es un detalle de integración entre dos adaptadores de
 * infraestructura, por eso vive como método adicional de la clase concreta, no de la
 * interfaz. Ambos delegan en el mismo helper privado para no duplicar la query (DRY).
 *
 * Implementa: FR-026 (correlativo de salida sin huecos bajo concurrencia), research R5.
 */
import { Injectable } from '@nestjs/common';
import type { Contadores } from '../../dominio/puertos/contadores';
import { PrismaService } from './prisma.service';
import type { PrismaTransactionClient } from './unidad-de-trabajo';

/** Cliente Prisma capaz de ejecutar `$queryRaw` — satisfecho tanto por `PrismaService` (fuera
 *  de transacción) como por `PrismaTransactionClient` (dentro de una transacción activa). */
type ClientePrismaConQueryRaw = Pick<PrismaService, '$queryRaw'> | PrismaTransactionClient;

/** Fila cruda de `UPDATE contadores ... RETURNING valor`. */
interface FilaContador {
  valor: bigint;
}

@Injectable()
export class ContadoresPrisma implements Contadores {
  constructor(private readonly prisma: PrismaService) {}

  /** Implementación del puerto — abre su propia conexión (`this.prisma`), sin transacción
   *  externa. Ver TSDoc de cabecera para el caso de uso DENTRO de una transacción. */
  async siguienteNumero(clave: string): Promise<number> {
    return incrementarContador(this.prisma, clave);
  }

  /** Variante para llamar DESDE otro adaptador que ya abrió una transacción con
   *  `UnidadDeTrabajo.ejecutar` (p. ej. `RepositorioSalidasPrisma.crear`) — ver TSDoc de
   *  cabecera (research R5). */
  async siguienteNumeroEnTransaccion(tx: PrismaTransactionClient, clave: string): Promise<number> {
    return incrementarContador(tx, clave);
  }
}

/** `UPDATE ... RETURNING` atómico, parametrizado (docs/arquitectura.md §"SQL crudo"). Si la
 *  clave no tiene fila semilla (la migración T009 debe haberla creado), es un error de
 *  configuración de la BD, no un caso de negocio — se lanza `Error` genérico. */
async function incrementarContador(cliente: ClientePrismaConQueryRaw, clave: string): Promise<number> {
  const filas = await cliente.$queryRaw<FilaContador[]>`
    UPDATE contadores SET valor = valor + 1 WHERE clave = ${clave} RETURNING valor
  `;
  const fila = filas[0];
  if (!fila) {
    throw new Error(`Contador sin fila semilla para la clave "${clave}" — falta en la migración (research R5)`);
  }
  return Number(fila.valor);
}
