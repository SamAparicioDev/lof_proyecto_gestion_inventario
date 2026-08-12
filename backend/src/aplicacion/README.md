# Capa `aplicacion` — casos de uso

Cada **operación de negocio de la spec es una clase** que implementa
`comunes/caso-de-uso.ts` (patrón Use Case / Command — SOLID: una responsabilidad por
clase). ¿Buscas dónde se confirma una salida? → `salidas/confirmar-salida.caso-uso.ts`.
Esa correspondencia 1:1 operación↔archivo es deliberada: los procesos se encuentran por
su nombre.

## Reglas de la capa

- Solo puede importar de `dominio` (y esquemas/tipos de `@trazo/compartido` para DTOs).
  Nunca de `infraestructura` ni `interfaces` — el lint lo hace cumplir.
- Las dependencias llegan por **constructor** como puertos del dominio (DIP). El cableado
  concreto (qué adaptador implementa cada puerto) lo hace el módulo NestJS en
  `interfaces`.
- La entrada llega **ya validada** en forma por el esquema Zod compartido (el pipe HTTP la
  validó); aquí se aplican las reglas de NEGOCIO: disponibilidad, estados, unicidad,
  destino válido…
- El `usuarioId` del ejecutor SIEMPRE forma parte de la entrada — la auditoría (FR-045)
  se puebla en cada mutación.
- Las operaciones que tocan stock se ejecutan a través de la `UnidadDeTrabajo`
  (transacción atómica con bloqueo de fila — research R4). Nunca "a mano".

## Organización

```text
aplicacion/
├── comunes/        # Interfaz CasoDeUso + utilidades de la capa
├── ingresos/       # crear-, actualizar-, recibir-, verificar-, anular-ingreso (US1)
├── salidas/        # crear-, actualizar-, confirmar-, completar-, cancelar-, anular-salida (US3)
├── clientes/       # CRUD y estados de clientes y proyectos (US2)
├── inventario/     # consultas: listar-inventario, ficha-producto, historial (US5)
├── productos/      # crear-producto (alta rápida), actualizar, estado (US1/US5)
├── usuarios/       # gestión de usuarios (US6) + cambiar-mi-password (Foundational)
├── roles/          # CRUD de roles y su matriz de permisos + invariantes FR-057 (US9)
└── reportes/       # consumo, inventario, movimientos + puerto ExportadorReporte (US4/US7)
```

Cada caso de uso lleva TSDoc con el `FR-###` que implementa. Las tareas exactas están en
`specs/001-gestion-inventarios/tasks.md`.
