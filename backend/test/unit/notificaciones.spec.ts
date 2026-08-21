/**
 * Pruebas unitarias de las NOTIFICACIONES (US35/T272) — las tres reglas que deciden si un aviso
 * llega, y la coherencia entre los tres sitios donde vive la lista de tipos.
 *
 * Todo lo de aquí es dominio puro: sin base de datos y sin NestJS. La entrega contra PostgreSQL
 * real (exclusión del autor, marcado, ventana) se prueba en `test/integracion/notificaciones.spec.ts`,
 * que es donde tiene sentido — aquí se prueba la REGLA, allá el SQL que la obedece.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { TIPOS_NOTIFICACION } from '@trazo/compartido';
import {
  CATALOGO_NOTIFICACIONES,
  PERMISOS_DE_AVISOS,
  tiposVisiblesPara,
  type TipoNotificacion,
} from '../../src/dominio/entidades/notificacion';
import { cruzaElUmbral } from '../../src/dominio/entidades/producto';
import { DIAS_DE_VENTANA, inicioDeLaBandeja } from '../../src/aplicacion/notificaciones/ventana-bandeja';

describe('tiposVisiblesPara — la suscripción SUSCRIBE, nunca amplía (FR-141/FR-142)', () => {
  it('entrega un tipo solo si la sesión tiene la suscripción Y el permiso de lectura del módulo', () => {
    const visibles = tiposVisiblesPara(['notificaciones.salidas', 'salidas.ver']);

    expect(visibles).toEqual(
      expect.arrayContaining(['SALIDA_POR_APROBAR', 'SALIDA_CONFIRMADA', 'SALIDA_ANULADA']),
    );
    expect(visibles).not.toContain('INGRESO_RECIBIDO');
  });

  it('con la casilla de avisos marcada pero SIN poder ver el módulo, no entrega nada (US35-AS4)', () => {
    // Es el caso que hace de esta regla algo más que burocracia: el título de un aviso
    // ("Salida SAL-000231 · Constructora Jumbo") YA es información del módulo. Si bastara la
    // suscripción, marcar una casilla sería repartir datos sin repartir permisos.
    expect(tiposVisiblesPara(['notificaciones.salidas'])).toEqual([]);
  });

  it('con el permiso de lectura pero sin suscripción, tampoco: ver salidas no es querer avisos', () => {
    expect(tiposVisiblesPara(['salidas.ver', 'ingresos.ver', 'inventario.ver'])).toEqual([]);
  });

  it('sin permisos, la bandeja está vacía — y eso NO es un error de acceso', () => {
    expect(tiposVisiblesPara([])).toEqual([]);
  });

  it('los tres grupos de suscripción cubren TODOS los tipos: ninguno queda sin casilla que lo active', () => {
    // Un tipo cuyo permiso de suscripción no estuviera en el catálogo de `/roles` sería un aviso
    // que nadie puede activar ni desactivar: existiría en la base y no llegaría jamás.
    const usados = new Set(Object.values(CATALOGO_NOTIFICACIONES).map((definicion) => definicion.permisoSuscripcion));

    expect([...usados].sort()).toEqual([...PERMISOS_DE_AVISOS].sort());
  });
});

describe('cruzaElUmbral — se avisa en el CRUCE, no en cada movimiento (FR-145)', () => {
  it('avisa cuando la operación deja el disponible en o por debajo del umbral viniendo de arriba', () => {
    // 15 disponibles, salen 7 → quedan 8, con umbral 10: cruzó.
    expect(cruzaElUmbral(8, 7, 10)).toBe(true);
  });

  it('NO vuelve a avisar si ya estaba bajo antes de la operación', () => {
    // 9 disponibles (ya bajo el umbral de 10), salen 3 → quedan 6. Sigue bajo, pero no cruzó.
    expect(cruzaElUmbral(6, 3, 10)).toBe(false);
  });

  it('el umbral EXACTO cuenta como bajo, igual que en el inventario (`esStockBajo`)', () => {
    expect(cruzaElUmbral(10, 5, 10)).toBe(true);
  });

  it('quedarse justo por encima no es cruzar', () => {
    expect(cruzaElUmbral(11, 4, 10)).toBe(false);
  });

  it('una operación que NO baja el disponible nunca cruza, aunque el producto esté bajo', () => {
    // Recibir mercancía o anular una salida SUBEN el disponible: avisar "stock bajo" ahí sería
    // exactamente el aviso que enseña a ignorar los avisos.
    expect(cruzaElUmbral(3, 0, 10)).toBe(false);
    expect(cruzaElUmbral(3, -5, 10)).toBe(false);
  });
});

describe('inicioDeLaBandeja — nadie hereda pendientes ajenos (FR-147)', () => {
  const AHORA = new Date('2026-08-20T12:00:00.000Z');

  it('para alguien dado de alta hoy, la bandeja empieza en su alta', () => {
    const alta = new Date('2026-08-19T09:00:00.000Z');

    expect(inicioDeLaBandeja(alta, AHORA)).toEqual(alta);
  });

  it('para alguien antiguo, manda la ventana de 30 días', () => {
    const alta = new Date('2020-01-01T00:00:00.000Z');
    const esperado = new Date(AHORA.getTime() - DIAS_DE_VENTANA * 24 * 60 * 60 * 1000);

    expect(inicioDeLaBandeja(alta, AHORA)).toEqual(esperado);
  });
});

describe('El catálogo de tipos no puede divergir entre dominio, contrato y base', () => {
  /**
   * Los mismos ocho nombres viven en tres sitios que nadie recompila juntos: el dominio, el
   * contrato compartido y el `CREATE TYPE` de la migración. Un tipo agregado en dos de los tres
   * falla en producción con un error de enum de PostgreSQL, cuando ya es tarde y caro.
   */
  it('el contrato compartido declara exactamente los tipos del catálogo del dominio', () => {
    const enElDominio = Object.keys(CATALOGO_NOTIFICACIONES).sort();

    expect([...TIPOS_NOTIFICACION].sort()).toEqual(enElDominio);
  });

  it('la migración crea el enum con esos mismos valores', () => {
    const enum_ = valoresDelEnumDeLaMigracion('tipo_notificacion');
    const enElDominio = Object.keys(CATALOGO_NOTIFICACIONES) as TipoNotificacion[];

    expect(enum_.sort()).toEqual([...enElDominio].sort());
  });

  it('cada tipo declara a qué clase de entidad lleva, para que el aviso tenga a dónde ir (FR-140)', () => {
    for (const [tipo, definicion] of Object.entries(CATALOGO_NOTIFICACIONES)) {
      expect({ tipo, entidad: definicion.entidad }).toEqual({
        tipo,
        entidad: expect.stringMatching(/^(INGRESO|SALIDA|PRODUCTO)$/),
      });
    }
  });
});

/** Valores de un `CREATE TYPE ... AS ENUM (...)` buscándolo en todas las migraciones. */
function valoresDelEnumDeLaMigracion(nombre: string): string[] {
  const directorio = join(__dirname, '..', '..', 'prisma', 'migrations');
  for (const carpeta of readdirSync(directorio)) {
    const archivo = join(directorio, carpeta, 'migration.sql');
    if (!existsSync(archivo)) continue;
    const sql = readFileSync(archivo, 'utf8');
    const bloque = new RegExp(`CREATE TYPE "${nombre}" AS ENUM \\(([^)]+)\\)`, 'i').exec(sql);
    if (bloque?.[1]) {
      return [...bloque[1].matchAll(/'([A-Z_]+)'/g)].map((coincidencia) => coincidencia[1] as string);
    }
  }
  throw new Error(`Ninguna migración crea el enum "${nombre}".`);
}
