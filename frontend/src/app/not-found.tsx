/**
 * Página 404 de toda la aplicación (App Router: `app/not-found.tsx`).
 *
 * Existe por DOS motivos, y el segundo no es cosmético:
 *
 * 1. **FR-047 — todo en español.** Sin esta página, una URL inexistente mostraba la pantalla
 *    por defecto de Next, en inglés y sin ninguna relación visual con el resto del sistema.
 *
 * 2. **Desbloquea la compilación de producción.** Sin un `not-found` propio, Next recurre a su
 *    página de error interna del Pages Router y, al prerenderizarla en un entorno limpio,
 *    aborta el build con `<Html> should not be imported outside of pages/_document`. Se
 *    manifestó al construir la imagen Docker (build desde cero) mientras que en local pasaba
 *    inadvertido porque la caché de `.next` ya tenía esas páginas generadas. Es decir: el build
 *    de producción estaba roto y solo se veía al compilar limpio.
 *
 * Sin `'use client'` y sin datos: se prerenderiza como estática. No usa el shell autenticado
 * (`(app)/layout.tsx`) a propósito — un 404 puede ocurrir sin sesión, y pedir el perfil aquí
 * llevaría a un redirect a `/login` en vez de decir la verdad, que la ruta no existe.
 */
import Link from 'next/link';

export default function NoEncontrado() {
  return (
    <main
      className="grid min-h-screen place-items-center p-6"
      style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}
    >
      {/* Contenedor Nocturne por fuera y layout por dentro: nunca en el mismo elemento
          (docs/diseno-nocturne.md — el CSS sin capa de Nocturne gana a las utilidades de
          Tailwind, así que combinarlos en un mismo nodo silencia al segundo). */}
      <div className="card" style={{ maxWidth: 460, textAlign: 'center' }}>
        <div className="flex flex-col items-center gap-3 p-2">
          <h6 style={{ color: 'var(--color-accent)', margin: 0 }}>Error 404</h6>
          <h2 style={{ margin: 0 }}>Esta página no existe</h2>
          <p className="text-muted" style={{ margin: 0 }}>
            Es posible que la dirección esté mal escrita o que el contenido se haya movido.
          </p>
          <Link href="/" className="btn btn-primary" style={{ marginTop: 'var(--space-2)' }}>
            Volver al inicio
          </Link>
        </div>
      </div>
    </main>
  );
}
