/**
 * Guarda de despliegue: TODO permiso del catálogo debe insertarlo también una MIGRACIÓN, no
 * solo `prisma/seed.ts`.
 *
 * Por qué existe (incidente del 2026-08-15): `categorias.ver`/`categorias.gestionar` se
 * agregaron únicamente al seed. En desarrollo todo funcionaba —la semilla se ejecuta en cada
 * base recreada—, pero en producción la semilla NO se ejecuta: correrla crearía un usuario con
 * contraseña conocida, así que solo corren las migraciones (`preDeployCommand`). Resultado: en
 * Railway nadie tenía esos permisos, la entrada "Administración" no aparecía en el menú y el
 * selector de categoría del formulario de producto salía vacío por un `403`. El código estaba
 * bien y la función estaba rota igual.
 *
 * Es una prueba UNITARIA que lee archivos, no de integración a propósito: comprueba una
 * relación entre dos ARTEFACTOS del repositorio (el seed y las migraciones), no un
 * comportamiento contra la base de datos. Así falla en `npm run verificar`, antes de desplegar,
 * que es cuando todavía es barato arreglarlo.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ_BACKEND = join(__dirname, '..', '..');
const RUTA_SEED = join(RAIZ_BACKEND, 'prisma', 'seed.ts');
const DIRECTORIO_MIGRACIONES = join(RAIZ_BACKEND, 'prisma', 'migrations');

/** Claves declaradas en `PERMISOS_DEL_SISTEMA` del seed — la lista autoritativa del catálogo. */
function permisosDelSeed(): string[] {
  const contenido = readFileSync(RUTA_SEED, 'utf8');
  const bloque = contenido.split('const PERMISOS_DEL_SISTEMA = [')[1]?.split('] as const;')[0];
  if (!bloque) {
    throw new Error(
      'No se encontró el bloque PERMISOS_DEL_SISTEMA en prisma/seed.ts — si se renombró, actualiza esta prueba.',
    );
  }
  return [...bloque.matchAll(/clave: '([^']+)'/g)].map((coincidencia) => coincidencia[1] as string);
}

/** Claves que alguna migración inserta en `permisos` (`('modulo.accion', 'modulo', '...')`). */
function permisosDeLasMigraciones(): Set<string> {
  const claves = new Set<string>();
  for (const carpeta of readdirSync(DIRECTORIO_MIGRACIONES)) {
    const archivo = join(DIRECTORIO_MIGRACIONES, carpeta, 'migration.sql');
    if (!existsSync(archivo)) continue;
    const sql = readFileSync(archivo, 'utf8');
    for (const coincidencia of sql.matchAll(/\('([a-z_]+\.[a-z_]+)',\s*'[a-z_]+',/g)) {
      claves.add(coincidencia[1] as string);
    }
  }
  return claves;
}

describe('Catálogo de permisos — seed y migraciones no pueden divergir', () => {
  it('todo permiso del seed lo inserta también alguna migración (si no, en producción da 403)', () => {
    const enMigraciones = permisosDeLasMigraciones();
    const sinMigracion = permisosDelSeed().filter((clave) => !enMigraciones.has(clave));

    expect({
      sinMigracion,
      ayuda:
        'Agrega estos permisos en una migración NUEVA (nunca editando una ya aplicada: Prisma ' +
        'valida su checksum), con INSERT ... ON CONFLICT DO NOTHING y su matriz rol → permiso.',
    }).toEqual({ sinMigracion: [], ayuda: expect.any(String) });
  });

  it('el seed declara al menos los permisos que las migraciones crean (nadie sobra en la BD)', () => {
    const delSeed = new Set(permisosDelSeed());
    // Al revés también importa: un permiso que exista en la base pero que el seed no declare
    // sería una casilla de la pantalla de roles que nadie mantiene, y que una base recreada
    // desde cero no tendría — dos entornos con catálogos distintos.
    const soloEnMigraciones = [...permisosDeLasMigraciones()].filter((clave) => !delSeed.has(clave));
    expect(soloEnMigraciones).toEqual([]);
  });
});
