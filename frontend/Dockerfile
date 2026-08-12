# syntax=docker/dockerfile:1
#
# Imagen del FRONTEND de Trazo (Next.js 15, App Router).
#
# IMPORTANTE — el contexto de build es la RAÍZ del repositorio, no `frontend/`:
#     docker build -f frontend/Dockerfile -t trazo-frontend .
# Monorepo de npm workspaces: el frontend importa `@trazo/compartido`, así que la instalación
# necesita el `package-lock.json` de la raíz y los `package.json` de los tres workspaces.
#
# La imagen final NO lleva `node_modules` completo: usa la salida `standalone` de Next
# (`frontend/next.config.ts`), que empaqueta un servidor con solo los módulos que el build
# demostró necesarios.

# ---------------------------------------------------------------------------------------
FROM node:22-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# ---------------------------------------------------------------------------------------
FROM base AS build
# OJO — `NODE_ENV` se queda en `production` (heredado de `base`) DURANTE EL BUILD.
# Ponerlo en `development` aquí, que fue el primer intento, rompía la compilación: `next build`
# en modo desarrollo intenta prerenderizar sus páginas de error del Pages Router y aborta con
# `<Html> should not be imported outside of pages/_document`. El fallo solo aparecía dentro de
# Docker —en local `npm run build` corre sin `NODE_ENV` y Next asume producción—, así que era
# invisible hasta construir la imagen.
# Las dependencias de desarrollo (typescript, tailwind…) que el build necesita se fuerzan con
# `--include=dev` más abajo, ya que con `NODE_ENV=production` npm las omitiría.
# Telemetría de Next desactivada: una imagen de despliegue no debe hacer llamadas de red
# que nadie pidió durante el build.
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
COPY packages/compartido/package.json packages/compartido/
COPY backend/package.json backend/
COPY frontend/package.json frontend/

# `--ignore-scripts`: el `postinstall` de la raíz compila `@trazo/compartido`, cuyas fuentes
# aún no se han copiado. Se compila explícitamente abajo.
# `--include=dev`: con `NODE_ENV=production` npm omitiría las dependencias de desarrollo, y sin
# ellas (typescript, tailwind, tipos) no hay build posible.
RUN npm ci --ignore-scripts --include=dev

COPY packages/compartido packages/compartido
RUN npm run build -w @trazo/compartido

COPY frontend frontend

# URL del backend, necesaria EN TIEMPO DE BUILD: Next serializa el destino de las reescrituras
# `/api/*` dentro de `routes-manifest.json`, así que pasarla como variable de entorno del
# contenedor no serviría de nada (ver el TSDoc de `frontend/next.config.ts`). El valor por
# defecto es el nombre del servicio en la red de Docker; `docker-compose.yml` lo pasa explícito.
ARG BACKEND_URL=http://backend:4000
ENV BACKEND_URL=${BACKEND_URL}

RUN npm run build -w frontend

# ---------------------------------------------------------------------------------------
FROM base AS runtime
ENV NEXT_TELEMETRY_DISABLED=1

# Las dos piezas de una salida `standalone`:
#   1. el servidor con sus dependencias ya rastreadas,
#   2. los assets estáticos, que el servidor NO empaqueta y sirve desde disco.
# (Este proyecto no tiene `frontend/public`, así que no hay un tercer COPY.)
#
# Rutas verificadas contra un `npm run build -w frontend` real (2026-08-12), no supuestas: el
# directorio se emite en `frontend/.next/standalone/` y, como `outputFileTracingRoot` es la
# raíz del repositorio, DENTRO reproduce la estructura del monorepo
# (`frontend/server.js`, `node_modules/`, `packages/`). Por eso se copia su contenido a `/app`
# y el servidor queda en `/app/frontend/server.js`.
COPY --from=build --chown=node:node /app/frontend/.next/standalone ./
COPY --from=build --chown=node:node /app/frontend/.next/static ./frontend/.next/static

USER node

EXPOSE 3000
ENV PORT=3000
# Sin esto Next escucha solo en localhost DENTRO del contenedor y ningún mapeo de puertos
# funcionaría desde fuera.
ENV HOSTNAME=0.0.0.0

CMD ["node", "frontend/server.js"]
