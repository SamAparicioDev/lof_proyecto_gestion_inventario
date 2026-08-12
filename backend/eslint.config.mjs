// Configuración de ESLint del backend (flat config).
//
// Además de las reglas de calidad de TypeScript, este archivo hace cumplir la REGLA DE
// DEPENDENCIA de la arquitectura hexagonal (Constitución, Principio VI y
// docs/arquitectura.md): las dependencias solo apuntan hacia adentro.
//
//   interfaces ──▶ aplicacion ──▶ dominio ◀── infraestructura
//
// - `dominio` no puede importar NestJS, Prisma, ni ninguna otra capa.
// - `aplicacion` solo puede importar de `dominio` (y de @trazo/compartido para DTOs).
// - `infraestructura` e `interfaces` implementan/orquestan, nunca al revés.
//
// Si una importación viola la regla, el lint FALLA — es la barrera automática que impide
// que las reglas de negocio críticas (Principios I, II y IV) se acoplen a frameworks.
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Calidad mínima innegociable (docs/arquitectura.md — clean code):
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-member-accessibility': ['error', { accessibility: 'no-public' }],
    },
  },
  {
    // CAPA DOMINIO: TypeScript puro. Nada de frameworks, ORM, HTTP ni otras capas.
    files: ['src/dominio/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@nestjs/*'], message: 'El dominio no puede depender de NestJS (Principio VI).' },
            { group: ['@prisma/*', '.prisma/*'], message: 'El dominio no puede depender de Prisma; usa un puerto (Principio VI).' },
            { group: ['**/aplicacion/*', '**/infraestructura/*', '**/interfaces/*'], message: 'El dominio es el centro: no importa de capas externas.' },
          ],
        },
      ],
    },
  },
  {
    // CAPA APLICACIÓN: casos de uso. Solo puede importar del dominio (y esquemas compartidos).
    files: ['src/aplicacion/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@prisma/*', '.prisma/*'], message: 'La aplicación usa puertos del dominio, no Prisma directo (Principio VI).' },
            { group: ['**/infraestructura/*', '**/interfaces/*'], message: 'La aplicación no conoce adaptadores ni controladores (regla de dependencia).' },
          ],
        },
      ],
    },
  },
  {
    // CAPA INTERFACES/HTTP: controladores, guards, pipes. Habla con `aplicacion`/`dominio`
    // (tipos) vía puertos e inyección de NestJS; jamás con Prisma directo
    // (docs/arquitectura.md §2, fila `interfaces/http`: "PROHIBIDO importar Prisma directo").
    // Sin esta regla el lint no cerraba esa fila de la tabla (solo `dominio`/`aplicacion`
    // tenían `no-restricted-imports`) — hallazgo de auditoría T088, 2026-08-11: un import de
    // `@prisma/client` aquí pasaba el lint sin error de fronteras.
    files: ['src/interfaces/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@prisma/*', '.prisma/*'], message: 'interfaces/http no puede depender de Prisma directo; pasa por un caso de uso o un puerto (docs/arquitectura.md §2).' },
          ],
        },
      ],
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
);
