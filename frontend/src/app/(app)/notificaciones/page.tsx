/**
 * `/notificaciones` — la bandeja completa de avisos (US35, FR-140/FR-144/FR-147).
 *
 * Server Component, igual que el resto de los listados: la página la trae el servidor con la
 * cookie de la sesión y el filtro es un enlace, no estado de navegador. Lo único que corre en el
 * cliente son las filas, porque abrir un aviso además lo marca leído
 * (`componentes/notificaciones/lista-notificaciones.tsx`).
 *
 * NO exige permiso, y es deliberado (mismo criterio que `/`): el recorte lo hace el servidor
 * dentro del endpoint, tipo por tipo. Una sesión sin suscripciones ve una bandeja vacía con una
 * explicación, no un `403` — "no te has suscrito a nada" no es "no tienes permiso", y confundirlos
 * mandaría a la gente a pedir un permiso que ya tiene.
 *
 * La bandeja es una VENTANA reciente, no un archivo (FR-147): lo que pasó de verdad vive en los
 * movimientos y en la auditoría de cada documento, y el pie de la pantalla lo dice.
 */
import Link from 'next/link';
import type { BandejaNotificaciones } from '@trazo/compartido';
import { apiServidor } from '@/lib/api/servidor';
import { BotonLeerTodas, ListaNotificaciones } from '@/componentes/notificaciones/lista-notificaciones';

const POR_PAGINA = 20;

interface ParametrosBusqueda {
  pagina?: string;
  soloNoLeidas?: string;
}

export default async function PaginaNotificaciones({
  searchParams,
}: {
  searchParams: Promise<ParametrosBusqueda>;
}) {
  const parametros = await searchParams;
  const pagina = Math.max(1, Number(parametros.pagina ?? '1') || 1);
  const soloNoLeidas = parametros.soloNoLeidas === 'true';

  const consulta = new URLSearchParams({ pagina: String(pagina), porPagina: String(POR_PAGINA) });
  if (soloNoLeidas) consulta.set('soloNoLeidas', 'true');
  const bandeja = await apiServidor<BandejaNotificaciones>(`/api/notificaciones?${consulta.toString()}`);

  const totalPaginas = Math.max(1, Math.ceil(bandeja.total / POR_PAGINA));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Actividad</h6>
          <h2 style={{ margin: 0 }}>Avisos</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={soloNoLeidas ? '/notificaciones' : '/notificaciones?soloNoLeidas=true'}
            className="btn btn-ghost"
          >
            {soloNoLeidas ? 'Ver todos' : `Ver solo no leídos${bandeja.noLeidas > 0 ? ` (${bandeja.noLeidas})` : ''}`}
          </Link>
          <BotonLeerTodas deshabilitado={bandeja.noLeidas === 0} />
        </div>
      </div>

      <div className="card flex flex-col gap-3">
        {bandeja.datos.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 14, margin: 0 }}>
            {soloNoLeidas
              ? 'No te queda ningún aviso sin leer.'
              : 'No tienes avisos todavía. Aquí aparecerán las entradas de mercancía, las salidas ' +
                'por aprobar, las anulaciones y los productos que se estén acabando — siempre que tu ' +
                'rol esté suscrito a ellos en Roles y permisos.'}
          </p>
        ) : (
          <ListaNotificaciones avisos={bandeja.datos} />
        )}
      </div>

      {bandeja.total > 0 && (
        <div className="flex items-center justify-between text-muted" style={{ fontSize: 13 }}>
          <span>
            Página {bandeja.pagina} de {totalPaginas} — {bandeja.total} aviso{bandeja.total === 1 ? '' : 's'}
          </span>
          <div className="flex gap-2">
            <EnlacePagina
              href={enlaceAPagina(Math.max(1, pagina - 1), soloNoLeidas)}
              deshabilitado={pagina <= 1}
            >
              Anterior
            </EnlacePagina>
            <EnlacePagina
              href={enlaceAPagina(Math.min(totalPaginas, pagina + 1), soloNoLeidas)}
              deshabilitado={pagina >= totalPaginas}
            >
              Siguiente
            </EnlacePagina>
          </div>
        </div>
      )}

      <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
        Los avisos cubren los últimos 30 días. El registro permanente de lo que pasó son los
        movimientos de cada producto y la auditoría de cada documento.
      </p>
    </div>
  );
}

function enlaceAPagina(pagina: number, soloNoLeidas: boolean): string {
  const consulta = new URLSearchParams({ pagina: String(pagina) });
  if (soloNoLeidas) consulta.set('soloNoLeidas', 'true');
  return `/notificaciones?${consulta.toString()}`;
}

function EnlacePagina({
  href,
  deshabilitado,
  children,
}: {
  href: string;
  deshabilitado: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="btn btn-secondary"
      aria-disabled={deshabilitado}
      style={deshabilitado ? { pointerEvents: 'none', opacity: 0.45 } : undefined}
    >
      {children}
    </Link>
  );
}
