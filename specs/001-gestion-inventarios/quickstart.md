# Quickstart: validación end-to-end — Sistema de Gestión de Inventarios (Trazo)

**Fase 1** | [plan.md](./plan.md) | [data-model.md](./data-model.md) | [contracts/](./contracts/api-rest.md)

Guía para levantar el sistema (backend NestJS + frontend Next.js) y demostrar que la feature
funciona de punta a punta. No contiene código de implementación; los detalles viven en
`tasks.md` y el código fuente.

## Prerrequisitos

- Node.js 22 LTS y npm 10+
- Docker Desktop (para PostgreSQL 16 local) — alternativa: instancia PostgreSQL accesible
- Windows 11 / macOS / Linux

## Configuración inicial

Instala todas las dependencias del monorepo (workspaces: backend, frontend, compartido) y
compila el paquete compartido:

```bash
npm install
```

Copia las variables de entorno de cada aplicación:

```bash
copy backend\.env.example backend\.env
```

```bash
copy frontend\.env.example frontend\.env
```

Variables mínimas — backend: `DATABASE_URL`, `DATABASE_URL_TEST`, `JWT_SECRET`,
`SEED_ADMIN_LOGIN`, `SEED_ADMIN_PASSWORD`, `SEED_DEMO_PASSWORD`; frontend: `BACKEND_URL`
(por defecto `http://localhost:4000`).

Levanta la base de datos (crea `trazo` y `trazo_test`):

```bash
docker compose up -d db
```

Aplica migraciones y datos semilla:

```bash
npm run prisma:migrate -w backend
```

```bash
npm run seed -w backend
```

El seed crea el usuario Administrador (credenciales del `.env`, con cambio de contraseña
forzado al primer login). Para la demo completa con los tres roles y datos de ejemplo
(usuarios `gerente.demo`/`operario.demo`, productos, cliente "Jumbo" con 2 proyectos,
ingresos y salidas con totales conocidos):

```bash
npm run seed:demo -w backend
```

## Ejecutar en desarrollo

Backend (API en `http://localhost:4000/api`):

```bash
npm run start:dev -w backend
```

Frontend (en otra terminal — `http://localhost:3000`, con proxy `/api/*` al backend):

```bash
npm run dev -w frontend
```

Abrir `http://localhost:3000` → redirige a `/login`.

## Escenarios de validación (mapa spec → verificación manual)

Ejecutarlos en orden con el seed demo cargado; cada uno referencia la historia de usuario de
[spec.md](./spec.md) que valida.

1. **Autenticación y roles (US6 + transversal)**: entrar como admin semilla → obliga cambio
   de contraseña. Entrar como `operario.demo` en otra ventana → el menú no muestra Reportes
   ni Usuarios, y navegar directo a `/usuarios` o llamar `GET /api/usuarios` devuelve
   denegado (la autoridad es el backend). Desactivar un usuario (como admin, desde
   `/usuarios`) → su login es rechazado con el mismo mensaje genérico que una contraseña
   incorrecta (US6-AS4).
2. **Ingreso de mercancía (US1)**: como Operario crear un ingreso con 3 productos (uno con
   "alta rápida" de producto). Verificar: estado PENDIENTE, totales por línea y total
   factura calculados. Intentar repetir el mismo número de factura → rechazo con mensaje en
   español. Marcar "Recibido" → en `/inventario` el stock subió exactamente las cantidades y
   el historial del producto muestra el movimiento ENTRADA con usuario, fecha y factura.
3. **Clientes y proyectos (US2)**: crear cliente con NIT duplicado → rechazo. Crear proyecto
   para el cliente con presupuesto. Suspender un proyecto → deja de aparecer en el combobox
   de nueva salida (`proyectos-destino`).
4. **Salida trazable (US3)**: crear salida seleccionando cliente → proyecto activo, 2
   productos. Verificar: sin proyecto no deja guardar; número correlativo asignado; en
   PENDIENTE el inventario muestra la cantidad comprometida y el disponible reducido.
   Confirmar la salida → stock descontado de inmediato, movimiento SALIDA con proyecto y
   usuario autorizante. Intentar una salida con cantidad > disponible → rechazo indicando el
   disponible real.
5. **Carrera de stock (US3-AS5 / SC-002)**: correr la prueba de integración de concurrencia
   (ver abajo) — dos confirmaciones simultáneas sobre el mismo producto: exactamente una
   gana; el stock nunca queda negativo.
6. **Inventario y alertas (US5)**: bajar el umbral de un producto por encima de su
   disponible → aparece destacado como stock bajo en `/inventario`. Buscar por SKU y por
   descripción. Abrir la ficha del producto → historial de movimientos completo.
7. **Reportes de consumo (US4)**: en `/reportes/consumo-cliente` filtrar por "Jumbo" y el
   período de los datos demo → los totales por proyecto y cliente cuadran con las salidas
   confirmadas (las PENDIENTES/ANULADAS no aparecen). En `/reportes/consumo-proyecto`
   verificar margen consumo vs presupuesto y el gráfico. Exportar ambos a PDF y Excel → los
   archivos conservan filtros y totales idénticos a pantalla.
8. **Auditoría (US7 / Principio II)**: en `/reportes/movimientos` filtrar por tipo, usuario
   y cliente/proyecto; todo movimiento muestra usuario, fecha/hora y documento. Anular la
   salida confirmada (como Gerente, con motivo) → aparece el movimiento AJUSTE_ENTRADA
   inverso y el stock vuelve; el consumo del reporte se actualiza.

## Pruebas automatizadas

Backend — unitarias de dominio/aplicación (sin BD) e integración de API contra
PostgreSQL real (`trazo_test`):

```bash
npm run test -w backend
```

```bash
npm run test:integracion -w backend
```

Las de integración cubren los invariantes de [data-model.md](./data-model.md): salida >
disponible rechazada, carrera de confirmaciones, unicidad de factura concurrente,
correlativo sin duplicados, inmutabilidad de `movimientos_inventario` (trigger), anulaciones
con movimiento inverso y guards 401/403.

E2E — Playwright levanta backend + frontend y recorre el flujo núcleo y la matriz de roles:

```bash
npm run test:e2e
```

## Resultado esperado

Los 8 escenarios manuales pasan, las tres suites en verde, y los criterios SC-001…SC-011 de
la spec quedan demostrables con los datos de demo.
