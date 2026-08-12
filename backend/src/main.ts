/**
 * Punto de arranque del backend Trazo (NestJS).
 *
 * Aquí se configura TODO lo transversal a la API — cada línea corresponde a una regla del
 * contrato (specs/001-gestion-inventarios/contracts/api-rest.md) o de la constitución:
 *
 * 1. Prefijo global `/api`         → todas las rutas del contrato cuelgan de /api/*.
 * 2. cookie-parser                 → la sesión viaja en la cookie httpOnly `trazo_sesion`
 *                                    (FR-001; research R6). El token JWT nunca es visible
 *                                    para JavaScript del navegador.
 * 3. FiltroErroresDominio global   → convierte los errores tipados del dominio al formato
 *                                    único { error: { mensaje, campos } } en español
 *                                    (FR-016/FR-047).
 * 4. Shutdown hooks                → cierre limpio de la conexión Prisma al detener el
 *                                    proceso.
 *
 * La validación de entrada NO es global: cada endpoint declara su esquema Zod compartido
 * con el PipeValidacionZod (Principio IV — ver interfaces/http/comunes).
 */
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { FiltroErroresDominio } from './interfaces/http/comunes/filtro-errores-dominio';

async function iniciar(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalFilters(new FiltroErroresDominio());
  app.enableShutdownHooks();

  // Sin CORS: el navegador siempre entra por el proxy del frontend (mismo origen).
  // Ver frontend/next.config.ts y research R14.

  const puerto = Number(process.env.PORT ?? 4000);
  await app.listen(puerto);
  console.log(`API de Trazo escuchando en http://localhost:${puerto}/api`);
}

void iniciar();
