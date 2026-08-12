/**
 * Adaptador `AdaptadorHashBcrypt` — implementa el puerto `Hasheador` del dominio con
 * `bcryptjs` (JS puro, sin compilación nativa — decisión research R6, evita fricción de
 * `node-gyp` en Windows).
 *
 * Implementa: FR-007 (hash criptográfico de contraseñas con un costo de trabajo fijo y
 * nombrado — nunca un número mágico repetido en el código; mismo costo que
 * `backend/prisma/seed.ts`).
 */
import { Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import type { Hasheador } from '../../dominio/puertos/hasheador';

/** Costo de trabajo de bcrypt (factor de iteraciones). Balance seguridad/latencia acordado. */
const SALT_ROUNDS = 12;

@Injectable()
export class AdaptadorHashBcrypt implements Hasheador {
  async hash(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  async comparar(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}
