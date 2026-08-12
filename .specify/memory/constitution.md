<!--
Sync Impact Report
==================
Version change: 1.0.0 → 1.1.0 (MINOR: nuevo Principio VI + ajuste material del Principio V)
Modified principles:
  - V. Simplicidad Primero → se reconcilia con la arquitectura mandatada: la simplicidad
    aplica DENTRO de la arquitectura hexagonal definida en el Principio VI (antes decía
    "monolito antes que microservicios, consultas directas antes que capas de abstracción")
Added principles:
  - VI. Arquitectura Hexagonal y Calidad de Código (decisión explícita del dueño del
    proyecto, 2026-08-10: backend NestJS + frontend Next.js, puertos y adaptadores,
    SOLID, clean code, comentarios de trazabilidad)
Added sections: ninguna
Removed sections: ninguna
Templates requiring updates:
  - .specify/templates/plan-template.md ✅ (lee la constitución en runtime, sin cambios necesarios)
  - specs/001-gestion-inventarios/plan.md ✅ actualizado en la misma operación (stack y estructura)
Follow-up TODOs: ninguno

Historial: v1.0.0 ratificada 2026-08-10 (5 principios iniciales).
-->

# Trazo Constitution

Sistema de gestión de inventarios con trazabilidad de consumo de material por cliente y
proyecto. Esta constitución gobierna todas las decisiones de especificación, diseño,
planeación e implementación del proyecto.

## Core Principles

### I. Integridad del Inventario (NO NEGOCIABLE)

El stock disponible es el invariante crítico del sistema y NUNCA puede ser negativo.

- Toda salida de mercancía DEBE validar disponibilidad antes de confirmarse; una salida
  con cantidad mayor a la disponible DEBE ser rechazada con un mensaje claro.
- La validación de disponibilidad DEBE ejecutarse en el servidor dentro de una operación
  atómica (transacción) que descuente el stock, para impedir condiciones de carrera entre
  usuarios concurrentes.
- El stock DEBE actualizarse en tiempo real al registrar entradas y salidas; no se
  permiten procesos de sincronización diferida que dejen ventanas de inconsistencia.
- Las cantidades y precios DEBEN ser números positivos; la capa de persistencia DEBE
  reforzar estas restricciones (constraints), no solo la interfaz.

**Racional**: el propósito del sistema es saber con certeza cuánto material hay y a dónde
se fue. Un solo registro inconsistente invalida los reportes y la confianza en el sistema.

### II. Trazabilidad Total

Todo movimiento de inventario DEBE quedar registrado de forma permanente y auditable.

- Cada entrada y salida DEBE registrar: usuario que la ejecuta, fecha y hora, documento
  asociado (factura o número de salida) y productos con cantidades.
- Cada salida de mercancía DEBE estar vinculada obligatoriamente a un cliente y a un
  proyecto específico; no existen salidas "sin destino".
- Todas las tablas DEBEN incluir campos de auditoría: `fecha_creacion`,
  `usuario_creacion`, `fecha_modificacion`, `usuario_modificacion`.
- Los movimientos confirmados NUNCA se eliminan físicamente; las correcciones se hacen
  mediante movimientos de ajuste que también quedan registrados.

**Racional**: la funcionalidad principal del negocio es responder "¿cuánto material
consumió el cliente X en el proyecto Y?"; sin trazabilidad completa esa pregunta no tiene
respuesta confiable.

### III. Control de Acceso por Roles

El acceso al sistema DEBE estar controlado por autenticación y roles.

- Roles del sistema: **Administrador** (gestión total, incluidos usuarios), **Gerente**
  (operación completa de inventario, clientes, proyectos y reportes) y **Operario**
  (registro de entradas/salidas y consultas básicas).
- Toda ruta/endpoint del sistema DEBE verificar autenticación y autorización en el
  servidor; ocultar botones en la interfaz no constituye control de acceso.
- Las contraseñas DEBEN almacenarse con hash criptográfico (nunca en texto plano).
- Los usuarios se desactivan, no se eliminan, para preservar la integridad referencial
  del historial de movimientos (Principio II).

**Racional**: el sistema registra operaciones con valor económico; cada acción debe poder
atribuirse a una persona con permisos verificados.

### IV. Validación Estricta de Datos

Ningún dato entra al sistema sin validación en ambas capas.

- Toda entrada de usuario DEBE validarse en el cliente (retroalimentación inmediata) Y en
  el servidor (fuente de verdad); la validación de servidor es la autoritativa.
- Los campos obligatorios definidos en la especificación (p. ej. cliente/proyecto en
  salidas, número de factura en ingresos) DEBEN rechazarse si están vacíos.
- Las reglas de unicidad (p. ej. número de factura único) DEBEN reforzarse con
  restricciones de base de datos, no solo con verificaciones de aplicación.
- Los mensajes de error DEBEN mostrarse en español, indicando el campo y la corrección
  esperada.

**Racional**: los reportes de consumo y de inventario solo son confiables si los datos de
origen son válidos desde su captura.

### V. Simplicidad Primero

Se construye el MVP funcional antes que cualquier optimización o generalización.

- Cada funcionalidad DEBE justificarse con un requisito explícito de la especificación;
  no se agrega infraestructura especulativa (YAGNI).
- La arquitectura del sistema es la definida en el Principio VI (backend + frontend con
  arquitectura hexagonal); DENTRO de ella se elige siempre la solución más simple que
  cumpla el requisito: sin microservicios, sin colas, sin servicios adicionales, sin
  patrones que ningún requisito exija.
- Las optimizaciones de rendimiento (caché de reportes, índices adicionales) se aplican
  solo cuando la especificación las exige o cuando hay evidencia medida de necesidad.
- La complejidad agregada DEBE documentarse y justificarse en el plan de implementación
  (sección Complexity Tracking).

**Racional**: el equipo es pequeño y el valor está en entregar trazabilidad funcionando;
la estructura arquitectónica del Principio VI es el marco acordado, no una licencia para
sofisticación adicional.

### VI. Arquitectura Hexagonal y Calidad de Código

Decisión explícita del dueño del proyecto (2026-08-10): el sistema se implementa como
**backend NestJS** y **frontend Next.js** separados, con **arquitectura hexagonal
(puertos y adaptadores)** en el backend y estándares de código de primera calidad.

- **Regla de dependencia (NO NEGOCIABLE)**: las dependencias apuntan hacia adentro.
  `dominio` no importa de ninguna otra capa; `aplicacion` solo importa de `dominio`;
  `infraestructura` e `interfaces` implementan puertos definidos por las capas internas.
  El dominio NUNCA importa NestJS, Prisma ni ningún framework.
- **Puertos y adaptadores**: todo acceso a tecnología externa (base de datos, hashing,
  generación de archivos, reloj) se define como puerto (interfaz) en el dominio o la
  aplicación y se implementa como adaptador en infraestructura.
- **SOLID aplicado**: una responsabilidad por clase (un caso de uso por operación de
  negocio); extensión sin modificación en variantes (p. ej. exportadores PDF/Excel vía
  patrón Strategy); interfaces segregadas y específicas; inversión de dependencias vía
  los puertos e inyección de NestJS.
- **Clean code**: nombres del dominio en español consistentes con la spec (spec.md es el
  glosario); funciones cortas con un nivel de abstracción; sin `any` ni supresiones de
  tipos; errores de dominio tipados — nunca strings mágicos ni códigos sueltos.
- **Comentarios de trazabilidad (requisito del dueño)**: todo caso de uso, puerto,
  controlador y proceso de negocio DEBE llevar un bloque TSDoc que explique qué hace,
  por qué existe y qué requisito implementa (referencia `FR-###` de la spec), para que
  cualquier proceso sea fácil de encontrar en el futuro.
- **Frontend**: Next.js consume el backend exclusivamente a través del contrato REST
  (`contracts/api-rest.md`); la lógica de negocio vive en el backend — el frontend
  valida para UX (Zod compartido) pero nunca es la autoridad.
- Las reglas operativas detalladas (estructura de carpetas, convenciones, patrones por
  capa) viven en `docs/arquitectura.md` y son vinculantes para toda implementación.

**Racional**: el dueño del proyecto exige código mantenible y de primera calidad; la
arquitectura hexagonal aísla las reglas de negocio críticas (Principios I, II y IV) de
los frameworks, haciéndolas testeables en aislamiento y protegidas de cambios de
tecnología.

## Restricciones Adicionales y Seguridad

- **Idioma**: toda la interfaz de usuario, mensajes de error, reportes y documentación
  funcional DEBEN estar en español.
- **Auditoría**: toda operación de creación/edición/anulación DEBE registrar usuario y
  fecha/hora (Principio II). El registro de auditoría debe poder consultarse en el
  reporte de movimientos.
- **Sesiones**: la autenticación DEBE expirar sesiones inactivas y proteger los endpoints
  contra acceso anónimo.
- **Exportación**: los reportes DEBEN poder exportarse a PDF y Excel conservando los
  filtros aplicados.
- **Rendimiento**: los listados DEBEN paginarse; los campos de búsqueda frecuente DEBEN
  tener índices en base de datos.

## Flujo de Desarrollo y Puertas de Calidad

- El proyecto sigue Spec-Driven Development con Spec Kit: `constitution → specify →
  clarify (opcional) → plan → tasks → analyze → implement`.
- Ninguna funcionalidad se implementa sin especificación (`spec.md`) y plan (`plan.md`)
  aprobados para su feature.
- Toda regla de negocio crítica (Principios I, II y IV) DEBE tener pruebas automatizadas
  antes de considerarse completa; en particular: rechazo de salidas sin stock, rechazo de
  salidas sin cliente/proyecto y unicidad de facturas.
- El chequeo "Constitution Check" del plan de implementación DEBE evaluarse antes de la
  fase de diseño y re-evaluarse después; toda violación DEBE justificarse en Complexity
  Tracking o corregirse.
- Los reportes generados DEBEN validarse contra datos de prueba conocidos antes de
  considerarse completos.

## Governance

- Esta constitución prevalece sobre cualquier otra práctica o preferencia del equipo; en
  caso de conflicto entre un artefacto (spec, plan, tasks) y la constitución, la
  constitución gana y el artefacto se corrige.
- **Enmiendas**: cualquier cambio requiere (1) descripción del cambio y su racional,
  (2) actualización del número de versión según versionado semántico y (3) verificación
  de que las plantillas y artefactos dependientes siguen alineados.
- **Versionado**: MAJOR para eliminaciones o redefiniciones incompatibles de principios;
  MINOR para principios o secciones nuevas o guía materialmente ampliada; PATCH para
  aclaraciones y correcciones de redacción.
- **Revisión de cumplimiento**: cada `plan.md` debe pasar el Constitution Check; cada
  revisión de código debe verificar los principios I–IV en el código tocado.

**Version**: 1.1.0 | **Ratified**: 2026-08-10 | **Last Amended**: 2026-08-10
