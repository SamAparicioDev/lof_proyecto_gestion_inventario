# syntax=docker/dockerfile:1
#
# Imagen del BACKEND de Trazo (NestJS hexagonal).
#
# IMPORTANTE — el contexto de build es la RAÍZ del repositorio, no `backend/`:
#     docker build -f backend/Dockerfile -t trazo-backend .
# Es un monorepo de npm workspaces y el backend importa `@trazo/compartido`, así que la
# instalación necesita el `package-lock.json` de la raíz y los `package.json` de los tres
# workspaces. `docker-compose.yml` ya lo hace así (`context: .`).
#
# Base Debian (`slim`) y no Alpine a propósito: Prisma resuelve su motor nativo según la libc
# de la imagen, y con Alpine (musl) hay que declarar `binaryTargets` en `schema.prisma`. Con
# Debian el motor `native` que se genera dentro de la imagen es el correcto, sin tocar el
# esquema. El precio es una imagen algo mayor; la alternativa es una fuente conocida de fallos
# en despliegue del tipo "funciona en mi máquina".

# ---------------------------------------------------------------------------------------
FROM node:22-slim AS base
# OpenSSL es requisito del motor de Prisma; ca-certificates, para TLS contra la base gestionada.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production

# ---------------------------------------------------------------------------------------
# Etapa de compilación: instala TODAS las dependencias (incluidas las de desarrollo, que
# `nest build` y `tsc` necesitan) y compila `@trazo/compartido` y el backend.
FROM base AS build
ENV NODE_ENV=development

# Solo los manifiestos primero: mientras no cambien, Docker reutiliza la capa de `npm ci`
# aunque cambie el código fuente (que es lo que cambia en casi todos los builds).
COPY package.json package-lock.json ./
COPY packages/compartido/package.json packages/compartido/
COPY backend/package.json backend/
COPY frontend/package.json frontend/

# `--ignore-scripts`: el `postinstall` de la raíz compila `@trazo/compartido`, cuyas fuentes
# todavía no se han copiado en este punto. Se compila explícitamente más abajo.
RUN npm ci --ignore-scripts

COPY packages/compartido packages/compartido
RUN npm run build -w @trazo/compartido

COPY backend backend
RUN npx prisma generate --schema backend/prisma/schema.prisma \
  && npm run build -w backend

# La semilla se compila APARTE porque `nest build` solo emite `src/`, y en la imagen final no
# hay `ts-node` (es dependencia de desarrollo) ni el `package.json` raíz donde Prisma busca su
# comando `prisma.seed`. Sin este paso, `prisma db seed` dentro del contenedor no encontraba
# nada que ejecutar y terminaba en silencio SIN crear el administrador — el sistema quedaba
# levantado pero sin nadie que pudiera entrar. Solo depende de `@prisma/client` y `bcryptjs`,
# ambos en producción.
RUN npx tsc backend/prisma/seed.ts \
  --outDir backend/dist-seed --module commonjs --target es2022 \
  --esModuleInterop --skipLibCheck

# ---------------------------------------------------------------------------------------
# Dependencias de producción: árbol limpio sin nada de desarrollo. El cliente de Prisma se
# genera DESPUÉS de esta instalación a propósito — `prisma generate` escribe dentro de
# `node_modules`, así que hacerlo antes y reinstalar lo borraría.
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY packages/compartido/package.json packages/compartido/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev --ignore-scripts --workspace backend --include-workspace-root
COPY backend/prisma backend/prisma
RUN npx prisma generate --schema backend/prisma/schema.prisma

# ---------------------------------------------------------------------------------------
FROM base AS runtime

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/dist-seed ./backend/dist-seed
COPY --from=build /app/packages/compartido/dist ./packages/compartido/dist
COPY --from=build /app/packages/compartido/package.json ./packages/compartido/
COPY backend/package.json ./backend/
COPY backend/prisma ./backend/prisma
# El logotipo institucional (FR-067): `LogoInstitucional` lo lee de `assets/marca/` relativo al
# WORKDIR. Se copia entero y no solo el PNG para que agregar un archivo de marca no exija tocar
# este Dockerfile. Si la carpeta no trae la imagen, la app arranca igual y exporta sin logo.
COPY backend/assets ./assets

# Usuario sin privilegios (la imagen de Node ya trae `node`): un proceso que solo sirve HTTP
# no necesita root, y si algún día se explota una vulnerabilidad, el radio de daño es menor.
USER node

EXPOSE 4000
ENV PORT=4000

# `migrate deploy` aplica las migraciones PENDIENTES y nunca borra datos (a diferencia de
# `migrate dev`/`migrate reset`, que jamás deben ejecutarse contra un entorno real). Es
# idempotente: si no hay migraciones pendientes, no hace nada, así que reiniciar el contenedor
# es seguro. Si falla, el contenedor no arranca — preferible a servir tráfico contra un
# esquema que no corresponde al código.
CMD ["sh", "-c", "npx prisma migrate deploy --schema backend/prisma/schema.prisma && node backend/dist/main.js"]
