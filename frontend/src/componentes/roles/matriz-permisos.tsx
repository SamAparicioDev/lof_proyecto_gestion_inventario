'use client';

/**
 * Matriz de permisos de un rol (T107, FR-055/FR-056) — el catálogo completo agrupado por
 * módulo, una casilla por permiso, dentro del diálogo de alta/edición de rol.
 *
 * ## Qué se marca y qué no
 *
 * El catálogo es de SOLO LECTURA (FR-056): esta pantalla no crea ni borra permisos, solo marca
 * cuáles tiene el rol. Cada casilla corresponde a UNA verificación real del backend
 * (`@RequierePermiso('modulo.accion')`), y por eso su `descripcion` —el texto que el
 * Administrador lee— viaja desde el catálogo sembrado y no se escribe aquí: si un permiso se
 * agrega o cambia de significado con un despliegue, esta pantalla lo refleja sola.
 *
 * Cada módulo trae una casilla "Todos" en su encabezado, que es lo que realmente se usa al
 * armar un rol ("que pueda todo lo de ingresos"); marca/desmarca los permisos de ESE módulo y
 * queda indeterminada (`indeterminate`) cuando hay algunos sí y otros no — un tercer estado
 * visual que HTML solo expone por DOM, de ahí el `ref` (no hay atributo JSX equivalente).
 *
 * ## Cascada Nocturne ↔ Tailwind (docs/diseno-nocturne.md)
 *
 * `.card` declara `display/flex-direction/gap/padding` sin capa CSS y gana siempre sobre las
 * utilidades de Tailwind del MISMO elemento. Por eso la tarjeta de cada módulo es un `.card`
 * "pelado" y la rejilla de casillas vive en un `<div>` interno sin clases de Nocturne — el
 * mismo patrón contenedor/layout de `componentes/comunes/barra-filtros.tsx`.
 */
import { useRef, type ChangeEvent } from 'react';
import type { ModuloPermisos } from '@trazo/compartido';

/** Etiqueta legible de cada módulo del catálogo (`permisos.modulo` viene en minúsculas). */
const ETIQUETA_MODULO: Record<string, string> = {
  inventario: 'Inventario',
  productos: 'Productos',
  clientes: 'Clientes',
  proyectos: 'Proyectos',
  ingresos: 'Ingresos',
  salidas: 'Salidas',
  reportes: 'Reportes',
  usuarios: 'Usuarios',
  roles: 'Roles y permisos',
  categorias: 'Categorías',
  proveedores: 'Proveedores',
  unidades_medida: 'Unidades de medida',
  ordenes_compra: 'Órdenes de compra',
  cotizaciones: 'Cotizaciones',
  asistente: 'Asistente',
  notificaciones: 'Avisos',
};

interface PropiedadesMatrizPermisos {
  catalogo: ModuloPermisos[];
  /** Ids del catálogo marcados hoy — el estado lo posee el formulario que la monta. */
  seleccionados: number[];
  onCambiar: (seleccionados: number[]) => void;
  /** Deshabilita toda la matriz mientras el diálogo está enviando. */
  deshabilitada?: boolean;
  /**
   * Claves de permiso RESERVADAS que esta sesión no puede mover (US31, FR-131). Se pintan igual
   * que las demás — con su estado real — pero bloqueadas y con la razón al lado: esconderlas
   * dejaría al Administrador sin entender por qué un rol concede algo que él no ve en la lista.
   *
   * Vacío para un super administrador, que sí puede moverlas. Esto es UX: el servidor rechaza el
   * cambio igual aunque alguien fuerce la casilla (FR-003).
   */
  reservadas?: readonly string[];
}

export function MatrizPermisos({
  catalogo,
  seleccionados,
  onCambiar,
  deshabilitada = false,
  reservadas = [],
}: PropiedadesMatrizPermisos) {
  const marcados = new Set(seleccionados);

  function alternarPermiso(id: number, marcado: boolean): void {
    const siguiente = new Set(marcados);
    if (marcado) {
      siguiente.add(id);
    } else {
      siguiente.delete(id);
    }
    onCambiar([...siguiente]);
  }

  function alternarModulo(grupo: ModuloPermisos, marcado: boolean): void {
    const siguiente = new Set(marcados);
    for (const permiso of grupo.permisos) {
      if (marcado) {
        siguiente.add(permiso.id);
      } else {
        siguiente.delete(permiso.id);
      }
    }
    onCambiar([...siguiente]);
  }

  if (catalogo.length === 0) {
    return (
      <div role="alert" className="card" style={{ fontSize: 13, color: 'var(--color-accent-300)' }}>
        No fue posible cargar el catálogo de permisos. Vuelve a abrir la pantalla de roles.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      {catalogo.map((grupo) => (
        <GrupoModulo
          key={grupo.modulo}
          grupo={grupo}
          marcados={marcados}
          deshabilitada={deshabilitada}
          reservadas={reservadas}
          onAlternarPermiso={alternarPermiso}
          onAlternarModulo={alternarModulo}
        />
      ))}
    </div>
  );
}

function GrupoModulo({
  grupo,
  marcados,
  deshabilitada,
  reservadas,
  onAlternarPermiso,
  onAlternarModulo,
}: {
  grupo: ModuloPermisos;
  marcados: Set<number>;
  deshabilitada: boolean;
  reservadas: readonly string[];
  onAlternarPermiso: (id: number, marcado: boolean) => void;
  onAlternarModulo: (grupo: ModuloPermisos, marcado: boolean) => void;
}) {
  const casillaModulo = useRef<HTMLInputElement>(null);
  const cuantosMarcados = grupo.permisos.filter((permiso) => marcados.has(permiso.id)).length;
  const todos = cuantosMarcados === grupo.permisos.length;
  const algunos = cuantosMarcados > 0 && !todos;

  // `indeterminate` no existe como atributo HTML: solo como propiedad del nodo. Se fija en cada
  // render para que el tercer estado siga el conteo real del módulo (marcar una casilla suelta
  // debe pasar el encabezado de "vacío" a "parcial" sin que el usuario lo toque).
  if (casillaModulo.current) {
    casillaModulo.current.indeterminate = algunos;
  }

  return (
    // Contenedor: SOLO Nocturne (`.card` pone su superficie, relleno y separación).
    <div className="card">
      <label className="flex items-center gap-[var(--space-2)]" style={{ cursor: deshabilitada ? 'not-allowed' : 'pointer' }}>
        <input
          ref={casillaModulo}
          type="checkbox"
          checked={todos}
          disabled={deshabilitada}
          onChange={(evento: ChangeEvent<HTMLInputElement>) => onAlternarModulo(grupo, evento.target.checked)}
        />
        <span style={{ fontFamily: 'var(--font-heading)', fontSize: 15 }}>
          {ETIQUETA_MODULO[grupo.modulo] ?? grupo.modulo}
        </span>
        <span className="text-muted" style={{ fontSize: 12 }}>
          {cuantosMarcados} de {grupo.permisos.length}
        </span>
      </label>

      {/* Layout: SOLO utilidades de Tailwind, en un elemento sin clases de Nocturne. */}
      <div className="grid gap-[var(--space-2)] sm:grid-cols-2">
        {grupo.permisos.map((permiso) => (
          <label
            key={permiso.id}
            className="flex items-start gap-[var(--space-2)]"
            style={{ cursor: deshabilitada ? 'not-allowed' : 'pointer' }}
          >
            <input
              type="checkbox"
              checked={marcados.has(permiso.id)}
              disabled={deshabilitada || reservadas.includes(permiso.clave)}
              onChange={(evento: ChangeEvent<HTMLInputElement>) => onAlternarPermiso(permiso.id, evento.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span className="min-w-0">
              <span className="block" style={{ fontSize: 13 }}>
                {permiso.descripcion}
              </span>
              <code className="text-muted block" style={{ fontSize: 11 }}>
                {permiso.clave}
              </code>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
