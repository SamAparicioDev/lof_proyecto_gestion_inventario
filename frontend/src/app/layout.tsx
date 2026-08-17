/**
 * Layout raíz del frontend de LOF.
 *
 * Define el idioma del documento (es-CO — toda la interfaz es en español, FR-047), fija el
 * tema claro/oscuro antes de la primera pintura (US19, FR-108 — ver `lib/tema.ts`), carga
 * Inter autohospedada con `next/font/google` (evita la llamada de red a Google Fonts en
 * tiempo de ejecución que traía el `@import` original del sistema de diseño Nocturne — ver
 * docs/diseno-nocturne.md) y los estilos globales. Los layouts específicos viven en los
 * grupos de rutas:
 *  - (auth)  → /login, sin navegación.
 *  - (app)   → resto de la aplicación, con navegación lateral filtrada por rol (T025).
 * El mapa completo de rutas y su acceso por rol está en
 * specs/001-gestion-inventarios/contracts/rutas-frontend.md.
 */
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { SCRIPT_TEMA_INICIAL } from '@/lib/tema';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'LOF — Gestión de Inventarios',
  description:
    'Sistema de gestión de inventarios con trazabilidad de consumo por cliente y proyecto.',
};

export default function LayoutRaiz({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CO" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* US19 (FR-108): fija `data-tema` en el `<html>` ANTES de la primera pintura. Va como
            script inline y no como efecto de React porque un efecto corre DESPUÉS de hidratar,
            y para entonces el navegador ya pintó un frame con el tema contrario — el destello
            que US19-AS4 prohíbe. `suppressHydrationWarning` en el `<html>` es la contrapartida
            necesaria: el atributo que este script escribe no está en el HTML del servidor. */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA_INICIAL }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
