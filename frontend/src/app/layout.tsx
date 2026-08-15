/**
 * Layout raíz del frontend de LOF.
 *
 * Define el idioma del documento (es-CO — toda la interfaz es en español, FR-047), carga
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
    <html lang="es-CO" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
