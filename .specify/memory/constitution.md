<!--
Sync Impact Report
==================
Version change: 1.1.0 → 2.0.0 (MAJOR: el Principio II deja de exigir proyecto en toda salida)
Modified principles (v2.0.0, 2026-08-18 — decisión explícita del dueño del proyecto):
  - II. Trazabilidad Total → el destino obligatorio de una salida es el CLIENTE; el proyecto
    pasa a ser opcional (antes: "vinculada obligatoriamente a un cliente y a un proyecto
    específico"). Racional: forzar un proyecto donde no lo hay producía proyectos inventados
    ("General", "Varios") y desde ahí el reporte de consumo por proyecto —la pregunta que
    justifica el sistema— respondía algo que no ocurrió. Una regla que se cumple mintiendo no
    protege la trazabilidad, la disuelve. El consumo sin proyecto se agrupa aparte y sigue
    sumando en el total del cliente (FR-124/FR-125), así que nada sale del rastro.
  - II. Trazabilidad Total → el "documento asociado" de una entrada admite ahora el correlativo
    de un AJUSTE DE INVENTARIO además del número de factura (FR-126): lo que la trazabilidad
    exige es un identificador propio, no que exista una compra detrás.
  - IV. Validación Estricta de Datos → se actualizan los EJEMPLOS de campos obligatorios, que
    citaban justo las dos reglas que cambian (proyecto en salidas, factura en ingresos). La
    regla en sí —"lo que la spec declara obligatorio se rechaza si viene vacío"— no cambia.
  - I. Integridad del Inventario → las cantidades, además de positivas, son ENTERAS (FR-122).
Added principles: ninguno
Added sections: ninguna
Removed sections: ninguna
Templates requiring updates:
  - .specify/templates/plan-template.md ✅ (lee la constitución en runtime, sin cambios necesarios)
  - specs/001-gestion-inventarios/spec.md ✅ US26–US29 y FR-122…FR-126 en la misma operación
  - specs/001-gestion-inventarios/data-model.md ✅ salidas.cliente_id, ingresos.tipo, CHECKs
  - specs/001-gestion-inventarios/contracts/api-rest.md ✅ salidas, ingresos y export de salida
Follow-up TODOs: ninguno

Historial: v1.0.0 ratificada 2026-08-10 (5 principios iniciales); v1.1.0 el 2026-08-10
(Principio VI, arquitectura hexagonal); v2.0.0 el 2026-08-18 (proyecto opcional en salidas).
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
- Las cantidades y precios DEBEN ser números positivos, y las CANTIDADES además ENTERAS
  (FR-122: no se entrega medio compresor); la capa de persistencia DEBE reforzar estas
  restricciones (constraints), no solo la interfaz. Al endurecer una restricción sobre datos
  que ya existen, se aplica hacia adelante sin invalidar el histórico: la trazabilidad
  (Principio II) prohíbe reescribir movimientos ya registrados para que encajen en una regla
  posterior.

**Racional**: el propósito del sistema es saber con certeza cuánto material hay y a dónde
se fue. Un solo registro inconsistente invalida los reportes y la confianza en el sistema.

### II. Trazabilidad Total

Todo movimiento de inventario DEBE quedar registrado de forma permanente y auditable.

- Cada entrada y salida DEBE registrar: usuario que la ejecuta, fecha y hora, documento
  asociado (número de factura, correlativo de ajuste de inventario o número de salida) y
  productos con cantidades. Lo que se exige es un identificador propio del documento, no que
  exista una compra detrás de él (FR-126).
- Cada salida de mercancía DEBE estar vinculada obligatoriamente a un CLIENTE; el PROYECTO es
  opcional (FR-124). No existen salidas "sin destino", pero sí entregas que son del cliente y
  no de una obra concreta — forzarles un proyecto inventado no añade trazabilidad, la
  falsifica. Lo entregado sin proyecto se agrupa aparte en el reporte de consumo del cliente y
  suma en su total (FR-125): no desaparece ni se reparte entre proyectos.
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
- Los campos obligatorios definidos en la especificación (p. ej. el cliente en las salidas,
  el número de factura en los ingresos de tipo FACTURA y el motivo en los de tipo AJUSTE)
  DEBEN rechazarse si están vacíos. Qué es obligatorio lo decide la spec y puede depender del
  TIPO de documento; lo que no admite excepción es que lo declarado obligatorio se valide.
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
  salidas sin CLIENTE (el proyecto es opcional desde v2.0.0) y unicidad de facturas.
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

**Version**: 2.0.0 | **Ratified**: 2026-08-10 | **Last Amended**: 2026-08-18
