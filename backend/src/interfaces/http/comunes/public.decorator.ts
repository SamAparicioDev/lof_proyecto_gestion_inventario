/**
 * Decorador `@Public()` — marca una ruta como exenta del `JwtAuthGuard` global. Uso
 * mínimo intencional: solo `POST /api/auth/login` y `GET /api/salud` lo necesitan
 * (contracts/api-rest.md); el resto de la API exige sesión (FR-001).
 */
import { CustomDecorator, SetMetadata } from '@nestjs/common';

export const CLAVE_METADATA_PUBLICA = 'esPublica';

export const Public = (): CustomDecorator => SetMetadata(CLAVE_METADATA_PUBLICA, true);
