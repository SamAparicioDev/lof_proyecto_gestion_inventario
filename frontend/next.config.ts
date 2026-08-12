/**
 * Configuración de Next.js del frontend de Trazo.
 *
 * La pieza clave es `rewrites`: el navegador NUNCA habla directo con el backend — todas
 * las llamadas van a `/api/*` del propio frontend y Next las reenvía al backend NestJS
 * (research R14). Beneficios:
 *  - La cookie de sesión httpOnly es first-party (mismo origen) → sin problemas de
 *    SameSite y sin exponer el token a JavaScript.
 *  - Cero configuración de CORS en ningún entorno.
 *
 * `BACKEND_URL` se define en frontend/.env (por defecto el backend local en :4000).
 *
 * ⚠️ Se lee en TIEMPO DE COMPILACIÓN, no de ejecución. Las reescrituras se serializan en
 * `routes-manifest.json` durante `next build`, así que el destino queda CONGELADO en la imagen:
 * definir `BACKEND_URL` como variable de entorno del contenedor no tiene ningún efecto. Este
 * comentario afirmaba lo contrario y era falso; se descubrió al levantar la aplicación en
 * Docker, donde el frontend seguía llamando a `localhost:4000` y toda la API respondía 500. Por
 * eso `frontend/Dockerfile` la recibe como `ARG` y `docker-compose.yml` se la pasa como
 * argumento de build (`http://backend:4000`), no como variable de entorno.
 *
 * Consecuencia práctica: la imagen del frontend queda atada a la URL del backend con la que se
 * construyó. Si algún día se necesita una sola imagen para varios entornos, hay que sustituir
 * esta reescritura por un manejador de ruta (`app/api/[...ruta]/route.ts`) que sí lea la
 * variable en cada petición.
 *
 * OJO: esto vale SOLO para esta reescritura, que es el camino del NAVEGADOR. Los Server
 * Components llaman al backend por su cuenta desde `lib/api/servidor.ts`, y ahí `BACKEND_URL`
 * SÍ se lee en cada petición — así que la variable debe existir también como entorno del
 * contenedor, no solo como argumento de build. Darla por prescindible en ejecución dejaba el
 * inicio de sesión aparentemente roto: la API respondía 204 y aun así la aplicación devolvía a
 * `/login`.
 */
import path from 'node:path';
import type { NextConfig } from 'next';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  /**
   * Salida autocontenida para la imagen Docker (`frontend/Dockerfile`): Next emite en
   * `.next/standalone` un servidor con SOLO los módulos que el build demostró necesarios, en
   * vez de exigir el `node_modules` completo en tiempo de ejecución. No afecta a `next dev`.
   */
  output: 'standalone',

  /**
   * Quita el indicador flotante de Next (el círculo con la "N" abajo a la izquierda en
   * desarrollo). Solo aparece en `next dev` —nunca en producción—, pero tapa la esquina de la
   * pantalla y estorba al revisar la interfaz. Soportado como booleano desde Next 15.2
   * (aquí: 15.5).
   */
  devIndicators: false,

  /**
   * Raíz del rastreo de dependencias. Sin esto, en un monorepo de workspaces Next infiere mal
   * la raíz (las dependencias reales viven en el `node_modules` de la RAÍZ, no en el de
   * `frontend/`) y el servidor autocontenido arranca sin módulos. Apunta al directorio padre,
   * que es la raíz del repositorio.
   */
  outputFileTracingRoot: path.join(__dirname, '..'),

  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
};

export default config;
