/**
 * Adaptador `RepositorioProductosPrisma` — implementa el puerto `RepositorioProductos` del
 * dominio con Prisma (patrón Repository/Adapter, docs/arquitectura.md §3). Único punto del
 * backend donde el modelo `productos` de Prisma se traduce a la entidad `Producto` del
 * dominio: convierte `BigInt` a `number` y `Prisma.Decimal` a `number` (el dominio no
 * conoce el tipo de columna de la BD — docs/arquitectura.md §2).
 *
 * Traduce violaciones técnicas de Postgres a errores de dominio tipados: `P2002` (UNIQUE)
 * en `sku` → `Duplicado('sku', ...)` (FR-010) y `P2025` (registro inexistente) en
 * `actualizar`/`cambiarEstado` → `NoEncontrado` (contrato: `PUT /api/productos/:id` → 404).
 *
 * `listar` con `soloStockBajo` compara dos columnas de la MISMA fila (`stock_actual` vs
 * `umbral_stock_bajo`); Prisma no soporta comparaciones columna-a-columna en `where` sin SQL
 * crudo, y este backend reserva el SQL crudo EXCLUSIVAMENTE a `FOR UPDATE`/`RETURNING`
 * (docs/arquitectura.md §2) — por eso ese filtro se aplica en memoria sobre los candidatos
 * de `buscar` (aceptable a la escala de un solo almacén, research R9; T086 revisa
 * rendimiento con volumen real).
 *
 * `actualizarCosto` (US12, T126) es el único método de este adaptador que abre una
 * transacción: el `UPDATE` de `ultimo_costo` y el `INSERT` de `historial_costos_producto` van
 * juntos o no van (FR-072). Bloquea la fila del producto con `SELECT ... FOR UPDATE` antes de
 * leer el costo vigente — sin ese bloqueo, dos correcciones simultáneas podrían leer ambas el
 * mismo costo anterior y dejar un historial con dos filas que parten del mismo origen y una
 * cadena rota (`100→200` y `100→300` para un producto que hoy vale 300). NO toca
 * `stock_actual` ni escribe movimientos (FR-073).
 *
 * Implementa: FR-010 (alta/edición), FR-011 (alta rápida), FR-012 (baja lógica), FR-071/
 * FR-072/FR-074 (costo corregible con registro atómico, solo si cambió).
 */
import { construirBusquedaPorTerminos } from './busqueda-por-terminos';
import { Injectable } from '@nestjs/common';
import { Prisma, type EstadoProducto as EstadoProductoPrisma } from '@prisma/client';

/**
 * Toda lectura de producto arrastra su categoría (US15) y su unidad de medida (US17). No es un
 * `include` de conveniencia: la entidad de dominio los lleva resueltos porque cada pantalla que
 * muestra un producto muestra el nombre de su categoría y la abreviatura de su unidad junto a
 * la cantidad, y resolverlos aparte sería una consulta por fila.
 */
const INCLUIR_CATEGORIA = {
  categoria: { select: { id: true, nombre: true } },
  unidadMedida: { select: { id: true, nombre: true, abreviatura: true } },
} as const;

type ProductoPrisma = Prisma.ProductoGetPayload<{ include: typeof INCLUIR_CATEGORIA }>;
import { Duplicado, NoEncontrado } from '../../dominio/comunes/errores';
import type { EstadoProducto, Producto } from '../../dominio/entidades/producto';
import { ServicioStock } from '../../dominio/servicios/servicio-stock';
import type {
  ContextoCambioCosto,
  DatosActualizarProducto,
  DatosCorreccionCantidad,
  DatosNuevoProducto,
  FiltrosListarProductos,
  FiltrosListarTodosProductos,
  PaginaProductos,
  RepositorioProductos,
  ValoresClasificacionProductos,
} from '../../dominio/puertos/repositorio-productos';
import { PrismaService } from './prisma.service';
import { registrarCambioDeCosto } from './registrar-cambio-costo';
import { UnidadDeTrabajo } from './unidad-de-trabajo';

/** Fila cruda de `SELECT id, ultimo_costo FROM productos ... FOR UPDATE` (research R4). */
interface FilaCostoBloqueado {
  id: bigint;
  ultimo_costo: Prisma.Decimal;
}

@Injectable()
export class RepositorioProductosPrisma implements RepositorioProductos {
  constructor(
    private readonly prisma: PrismaService,
    private readonly unidadDeTrabajo: UnidadDeTrabajo,
  ) {}

  async buscarPorId(id: number): Promise<Producto | null> {
    const registro = await this.prisma.producto.findUnique({ where: { id: BigInt(id) }, include: INCLUIR_CATEGORIA });
    return registro ? aProductoDominio(registro) : null;
  }

  async buscarPorSku(sku: string): Promise<Producto | null> {
    const registro = await this.prisma.producto.findUnique({ where: { sku }, include: INCLUIR_CATEGORIA });
    return registro ? aProductoDominio(registro) : null;
  }

  /** Lectura en lote (FR-044) — ver TSDoc del puerto: sin ids, ni siquiera consulta la BD. */
  async buscarPorIds(ids: readonly number[]): Promise<Producto[]> {
    if (ids.length === 0) return [];
    const registros = await this.prisma.producto.findMany({
      include: INCLUIR_CATEGORIA,
      where: { id: { in: ids.map((id) => BigInt(id)) } },
    });
    return registros.map(aProductoDominio);
  }

  async crear(datos: DatosNuevoProducto): Promise<Producto> {
    try {
      const registro = await this.prisma.producto.create({
        data: {
          sku: datos.sku,
          descripcion: datos.descripcion,
          categoriaId: datos.categoriaId === null ? null : BigInt(datos.categoriaId),
          unidadMedidaId: BigInt(datos.unidadMedidaId),
          ubicacion: datos.ubicacion,
          umbralStockBajo: datos.umbralStockBajo,
          usuarioCreacionId: BigInt(datos.usuarioCreacionId),
        },
        include: INCLUIR_CATEGORIA,
      });
      return aProductoDominio(registro);
    } catch (error) {
      throw traducirErrorEscrituraProducto(error);
    }
  }

  async actualizar(id: number, datos: DatosActualizarProducto): Promise<void> {
    try {
      await this.prisma.producto.update({
        where: { id: BigInt(id) },
        data: {
          descripcion: datos.descripcion,
          categoriaId: datos.categoriaId === null ? null : BigInt(datos.categoriaId),
          unidadMedidaId: datos.unidadMedidaId === null ? null : BigInt(datos.unidadMedidaId),
          ubicacion: datos.ubicacion,
          umbralStockBajo: datos.umbralStockBajo,
          usuarioModificacionId: BigInt(datos.usuarioModificacionId),
          fechaModificacion: new Date(),
        },
      });
    } catch (error) {
      throw traducirErrorEscrituraProducto(error);
    }
  }

  /**
   * Costo + su registro de historial, atómicos (FR-071/FR-072/FR-074) — ver TSDoc del puerto.
   *
   * Procedimiento fijo: bloquear la fila del producto (`FOR UPDATE`), leer el costo vigente ya
   * bloqueado, preguntar al dominio si eso es un cambio (`aplicarCambioDeCosto`, vía
   * `registrarCambioDeCosto`) y, solo si lo es, escribir el `UPDATE` y el `INSERT` en la misma
   * transacción. Si no cambió, la transacción no escribe NADA: ni la fila de historial ni un
   * `UPDATE` que ensuciaría `fecha_modificacion`/`usuario_modificacion` sin motivo.
   *
   * `stock_actual` no aparece por ningún lado, y es lo importante: corregir un precio jamás
   * mueve inventario (FR-073).
   */
  async actualizarCosto(id: number, costoNuevo: number, contexto: ContextoCambioCosto): Promise<boolean> {
    return this.unidadDeTrabajo.ejecutar(async (tx) => {
      const [productoBloqueado] = await tx.$queryRaw<FilaCostoBloqueado[]>`
        SELECT id, ultimo_costo FROM productos WHERE id = ${BigInt(id)} FOR UPDATE
      `;
      if (!productoBloqueado) throw new NoEncontrado('El producto');

      const costoAplicado = await registrarCambioDeCosto(tx, {
        productoId: id,
        costoAnterior: productoBloqueado.ultimo_costo.toNumber(),
        costoNuevo,
        origen: contexto.origen,
        usuarioId: contexto.usuarioId,
        documentoId: contexto.documentoId,
      });
      if (costoAplicado === null) return false;

      await tx.producto.update({
        where: { id: BigInt(id) },
        data: {
          ultimoCosto: costoAplicado,
          usuarioModificacionId: BigInt(contexto.usuarioId),
          fechaModificacion: new Date(),
        },
      });
      return true;
    });
  }

  /**
   * Corrige la cantidad al valor contado (US31, FR-130) — mismo procedimiento atómico que
   * `recibir`/`confirmar`: `FOR UPDATE` sobre la fila, regla de dominio pura, y persistencia del
   * stock junto al movimiento en la MISMA transacción.
   *
   * El movimiento sale con `documentoTipo: 'AJUSTE'` y `documentoId: null`: no hay documento que
   * lo respalde, y el `CHECK movimientos_documento_ajuste_check` de la base exige justamente esa
   * combinación. Lo que lo justifica es el `motivo`, que viaja obligatorio desde el esquema.
   *
   * NO toca `ultimoCosto` ni escribe en `historial_costos_producto`: corregir CUÁNTAS unidades
   * hay no dice nada sobre cuánto costó cada una. Mezclarlo inventaría un cambio de precio que
   * nadie hizo, y el historial de costos dejaría de responder "¿por qué subió el costo?".
   */
  async corregirCantidad(datos: DatosCorreccionCantidad): Promise<void> {
    await this.unidadDeTrabajo.ejecutar(async (tx) => {
      const filas = await tx.$queryRaw<{ id: bigint; stock_actual: Prisma.Decimal; descripcion: string }[]>`
        SELECT id, stock_actual, descripcion FROM productos WHERE id = ${BigInt(datos.productoId)} FOR UPDATE
      `;
      const fila = filas[0];
      if (!fila) {
        throw new NoEncontrado('El producto');
      }

      const correccion = new ServicioStock().aplicarCorreccion(
        { id: datos.productoId, stockActual: fila.stock_actual.toNumber(), descripcion: fila.descripcion },
        datos.cantidad,
      );

      await tx.producto.update({
        where: { id: BigInt(datos.productoId) },
        data: {
          stockActual: correccion.stockActualNuevo,
          fechaUltimoMovimiento: new Date(),
          usuarioModificacionId: BigInt(datos.usuarioId),
          fechaModificacion: new Date(),
        },
      });

      await tx.movimientoInventario.create({
        data: {
          tipo: correccion.tipoMovimiento,
          productoId: BigInt(datos.productoId),
          cantidad: correccion.cantidadMovimiento,
          stockResultante: correccion.stockActualNuevo,
          documentoTipo: 'AJUSTE',
          documentoId: null,
          usuarioId: BigInt(datos.usuarioId),
          motivo: datos.motivo,
        },
      });
    });
  }

  async cambiarEstado(id: number, estado: EstadoProducto, usuarioModificacionId: number): Promise<void> {
    try {
      await this.prisma.producto.update({
        where: { id: BigInt(id) },
        data: {
          estado: mapearEstadoAPrisma(estado),
          usuarioModificacionId: BigInt(usuarioModificacionId),
          fechaModificacion: new Date(),
        },
      });
    } catch (error) {
      throw traducirErrorEscrituraProducto(error);
    }
  }

  async listar(filtros: FiltrosListarProductos): Promise<PaginaProductos> {
    const where = construirWhereListar(filtros);

    if (!filtros.soloStockBajo) {
      const [registros, total] = await this.prisma.$transaction([
        this.prisma.producto.findMany({
          include: INCLUIR_CATEGORIA,
          where,
          orderBy: { id: 'asc' },
          skip: (filtros.pagina - 1) * filtros.porPagina,
          take: filtros.porPagina,
        }),
        this.prisma.producto.count({ where }),
      ]);
      return { datos: registros.map(aProductoDominio), total };
    }

    // Ver nota de cabecera: sin SQL crudo, el cruce stock_actual <= umbral_stock_bajo se
    // resuelve en memoria sobre los candidatos que ya pasaron el filtro `buscar`.
    const candidatos = await this.prisma.producto.findMany({ where, orderBy: { id: 'asc' }, include: INCLUIR_CATEGORIA });
    const bajoUmbral = candidatos.filter((registro) => registro.stockActual.lte(registro.umbralStockBajo));
    const inicio = (filtros.pagina - 1) * filtros.porPagina;
    return {
      datos: bajoUmbral.slice(inicio, inicio + filtros.porPagina).map(aProductoDominio),
      total: bajoUmbral.length,
    };
  }

  /** Lectura sin paginar para el reporte de inventario actual (FR-041) — ver TSDoc del
   *  puerto: reutiliza el mismo filtro `buscar` que `listar`, sin `soloStockBajo` ni
   *  `skip`/`take`. */
  async listarTodos(filtros?: FiltrosListarTodosProductos): Promise<Producto[]> {
    const busqueda = construirWhereBusqueda(filtros?.buscar);
    // US24 (FR-120): la categoría se combina con Y sobre la búsqueda — filtrar por familia y
    // escribir un término a la vez es una pregunta legítima ("los tornillos de construcción").
    const where: Prisma.ProductoWhereInput = filtros?.categoriaId
      ? { AND: [busqueda, { categoriaId: BigInt(filtros.categoriaId) }] }
      : busqueda;
    const registros = await this.prisma.producto.findMany({ where, orderBy: { id: 'asc' }, include: INCLUIR_CATEGORIA });
    return registros.map(aProductoDominio);
  }

  /**
   * Categorías y ubicaciones distintas del catálogo (US13, FR-076) — ver TSDoc del puerto.
   *
   * Dos `groupBy` (no dos `findMany` con `distinct`) para que la deduplicación la haga PostgreSQL
   * y solo viajen los valores, no una fila por producto. `productos_categoria_idx`/
   * `productos_ubicacion_idx` (migración `20260812220000_indices_filtros_listados`) los cubren.
   * Corren en paralelo porque son independientes entre sí.
   */
  async valoresDeClasificacion(): Promise<ValoresClasificacionProductos> {
    const [categorias, ubicaciones] = await Promise.all([
      // US15 (FR-088): las categorías salen del CATÁLOGO, ya no de un `groupBy` sobre productos.
      // Se ofrecen las ACTIVAS y, además, las inactivas que algún producto siga usando: sin esas
      // últimas, un listado guardado o compartido con `?categoriaId=` de una categoría dada de
      // baja mostraría el filtro aplicado sin poder nombrarlo en el selector.
      this.prisma.categoria.findMany({
        where: { OR: [{ estado: 'ACTIVA' }, { productos: { some: {} } }] },
        select: { id: true, nombre: true },
        orderBy: { nombre: 'asc' },
      }),
      this.prisma.producto.groupBy({
        by: ['ubicacion'],
        where: { ubicacion: { not: null } },
        orderBy: { ubicacion: 'asc' },
      }),
    ]);
    return {
      categorias: categorias.map((categoria) => ({ id: Number(categoria.id), nombre: categoria.nombre })),
      ubicaciones: soloTextosPresentes(ubicaciones.map((fila) => fila.ubicacion)),
    };
  }
}

/** Descarta nulos y cadenas en blanco de una lista de valores agrupados: un producto sin
 *  categoría (o con una capturada como espacios) no aporta una opción de filtro (FR-076). */
function soloTextosPresentes(valores: readonly (string | null)[]): string[] {
  return valores.filter((valor): valor is string => valor !== null && valor.trim() !== '');
}

/** Filtro `buscar` de SKU/descripción (búsqueda insensible a mayúsculas — FR-023). */
function construirWhereBusqueda(buscar: string | undefined): Prisma.ProductoWhereInput {
  // US22 (FR-118): "cemento gris" encuentra "Cemento gris 50 kg", y "cem 001" encuentra
  // "CEM-001" aunque no se escriba el guion. Se añaden ubicación y categoría a los campos
  // buscables: son los dos datos por los que se pregunta un producto cuando no se recuerda su
  // SKU ("lo que está en la bodega A").
  return (
    construirBusquedaPorTerminos<Prisma.ProductoWhereInput>(buscar, [
      (termino) => ({ sku: { contains: termino, mode: 'insensitive' } }),
      (termino) => ({ descripcion: { contains: termino, mode: 'insensitive' } }),
      (termino) => ({ ubicacion: { contains: termino, mode: 'insensitive' } }),
      (termino) => ({ categoria: { nombre: { contains: termino, mode: 'insensitive' } } }),
    ]) ?? {}
  );
}

/**
 * `buscar` + los filtros OPCIONALES del listado: estado (FR-012 — ver TSDoc de
 * `FiltrosListarProductos`: por defecto se ven ambos, los selectores de documentos nuevos pasan
 * `'ACTIVO'`) y, desde US13, categoría y ubicación por igualdad exacta (FR-075/FR-076).
 *
 * `disponibleMin`/`disponibleMax` NO aparecen aquí a propósito: filtran sobre `disponible`, que
 * no es una columna de `productos` (exige el agregado de salidas PENDIENTE), así que los resuelve
 * `ListarInventarioCasoUso` — mismo reparto que `soloStockBajo`.
 */
function construirWhereListar(filtros: FiltrosListarProductos): Prisma.ProductoWhereInput {
  const where: Prisma.ProductoWhereInput = construirWhereBusqueda(filtros.buscar);
  if (filtros.estado) where.estado = mapearEstadoAPrisma(filtros.estado);
  if (filtros.categoriaId) where.categoriaId = BigInt(filtros.categoriaId);
  if (filtros.ubicacion) where.ubicacion = filtros.ubicacion;
  return where;
}

/** Traduce un registro Prisma de `productos` a la entidad de dominio. */
function aProductoDominio(registro: ProductoPrisma): Producto {
  return {
    id: Number(registro.id),
    sku: registro.sku,
    descripcion: registro.descripcion,
    categoria: registro.categoria
      ? { id: Number(registro.categoria.id), nombre: registro.categoria.nombre }
      : null,
    unidadMedida: registro.unidadMedida
      ? {
          id: Number(registro.unidadMedida.id),
          nombre: registro.unidadMedida.nombre,
          abreviatura: registro.unidadMedida.abreviatura,
        }
      : null,
    ubicacion: registro.ubicacion,
    umbralStockBajo: registro.umbralStockBajo.toNumber(),
    stockActual: registro.stockActual.toNumber(),
    ultimoCosto: registro.ultimoCosto.toNumber(),
    fechaUltimoMovimiento: registro.fechaUltimoMovimiento,
    estado: mapearEstadoDeDominio(registro.estado),
  };
}

function mapearEstadoDeDominio(estado: EstadoProductoPrisma): EstadoProducto {
  switch (estado) {
    case 'ACTIVO':
      return 'ACTIVO';
    case 'INACTIVO':
      return 'INACTIVO';
    default: {
      const valorInesperado: never = estado;
      throw new Error(`Estado de producto de Prisma sin mapeo al dominio: ${String(valorInesperado)}`);
    }
  }
}

function mapearEstadoAPrisma(estado: EstadoProducto): EstadoProductoPrisma {
  switch (estado) {
    case 'ACTIVO':
      return 'ACTIVO';
    case 'INACTIVO':
      return 'INACTIVO';
    default: {
      const valorInesperado: never = estado;
      throw new Error(`Estado de producto de dominio sin mapeo a Prisma: ${String(valorInesperado)}`);
    }
  }
}

/** `P2002` (UNIQUE de `sku`) → `Duplicado`; `P2025` (registro inexistente) → `NoEncontrado`;
 *  cualquier otro error técnico se propaga sin traducir (lo maneja el filtro global). */
function traducirErrorEscrituraProducto(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return new Duplicado('sku', 'El SKU ya existe');
    if (error.code === 'P2025') return new NoEncontrado('El producto');
  }
  return error;
}
