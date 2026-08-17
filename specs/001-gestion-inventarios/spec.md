# Feature Specification: Sistema de Gestión de Inventarios con Trazabilidad por Cliente/Proyecto (Trazo)

**Feature Branch**: `001-gestion-inventarios`

**Created**: 2026-08-10

**Status**: Draft

**Input**: User description: "Sistema de gestión de inventarios 'Trazo' con trazabilidad de consumo por cliente y proyecto: gestión de usuarios con roles (Administrador, Gerente, Operario), ingreso de mercancía mediante facturas de compra, gestión de stock con cantidades comprometidas y alertas, salidas de mercancía asignadas obligatoriamente a cliente/proyecto con validación de disponibilidad, gestión de clientes y proyectos, y reportes de consumo/inventario/movimientos exportables a PDF y Excel." — Documento fuente: `C:\Users\Samuel\Documents\DIANA\requisitos.txt` (Especificaciones Funcionales v1.0, Agosto 2026).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Registrar ingreso de mercancía mediante factura (Priority: P1)

Un operario o gerente recibe mercancía del proveedor y la registra en el sistema a partir de la factura de compra: captura número de factura, proveedor, fechas de factura y recepción, y la lista de productos con cantidades y precios unitarios. Al marcar el ingreso como "Recibido", el stock de cada producto aumenta de inmediato.

**Why this priority**: Sin entradas registradas no existe stock que controlar; es la puerta de entrada de todos los datos del inventario y la primera mitad de la trazabilidad (qué entró, cuándo y a qué costo).

**Independent Test**: Se prueba de forma independiente creando un ingreso con 2–3 productos y verificando que (a) el ingreso queda en el historial con todos sus datos y (b) el stock de cada producto refleja las cantidades ingresadas. Entrega valor por sí sola: control de compras recibidas.

**Acceptance Scenarios**:

1. **Given** un usuario autenticado con rol Operario y un formulario de nuevo ingreso, **When** registra la factura F-001 con proveedor, fechas y 3 productos con cantidades y precios positivos y guarda, **Then** el sistema crea el ingreso en estado "Pendiente", calcula el valor total por línea y el total de la factura, y lo muestra en el historial de ingresos.
2. **Given** un ingreso en estado "Pendiente", **When** el usuario lo marca como "Recibido", **Then** el stock de cada producto del ingreso aumenta en la cantidad registrada y el movimiento queda en el historial con usuario, fecha y hora, y documento asociado.
3. **Given** una factura ya registrada con número F-001, **When** un usuario intenta registrar otro ingreso con el mismo número de factura, **Then** el sistema rechaza la operación e indica que el número de factura ya existe.
4. **Given** un formulario de ingreso con campos obligatorios vacíos o cantidades/precios no positivos, **When** el usuario intenta guardar, **Then** el sistema rechaza la operación y señala en español cada campo con error.
5. **Given** un ingreso en estado "Pendiente", **When** el usuario lo edita (agrega o corrige líneas), **Then** los cambios se guardan; **Given** un ingreso "Recibido" o "Verificado", **When** intenta editarlo, **Then** el sistema no lo permite.

---

### User Story 2 - Administrar clientes y sus proyectos (Priority: P1)

Un gerente registra los clientes de la empresa (nombre, NIT, contacto, dirección, ciudad) y crea los proyectos de cada cliente (nombre, descripción, fechas, responsable, presupuesto estimado). Puede listarlos, editarlos y consultar el historial de salidas de cada uno.

**Why this priority**: Toda salida de mercancía debe asignarse obligatoriamente a un cliente y proyecto; sin este catálogo la funcionalidad central del sistema (trazabilidad de consumo) no puede operar.

**Independent Test**: Se prueba creando un cliente con dos proyectos, editándolos y verificando los listados y filtros por cliente. Entrega valor por sí sola: directorio comercial de clientes y proyectos con presupuestos.

**Acceptance Scenarios**:

1. **Given** un usuario con rol Gerente, **When** crea el cliente "Jumbo" con NIT, contacto, dirección y ciudad, **Then** el cliente aparece en el listado con estado "Activo" y fecha de registro.
2. **Given** un cliente activo, **When** el gerente crea el proyecto "Remodelación Bodega Norte" con fechas, responsable y presupuesto estimado, **Then** el proyecto queda asociado al cliente en estado "Activo" y aparece al listar los proyectos de ese cliente.
3. **Given** un cliente con proyectos y salidas registradas, **When** el usuario consulta su detalle, **Then** ve el historial de salidas por proyecto.
4. **Given** un proyecto en estado "Completado" o "Suspendido", **When** un usuario intenta asignarle una nueva salida, **Then** el sistema no lo ofrece como destino válido.

---

### User Story 3 - Registrar salida de mercancía asignada a cliente/proyecto (Priority: P1)

Un operario registra una salida de mercancía seleccionando obligatoriamente el cliente y proyecto de destino, agrega los productos con sus cantidades, y el sistema verifica la disponibilidad antes de permitir la confirmación. Al confirmarse, el stock se descuenta de inmediato y la salida queda vinculada al proyecto con número auto-correlativo y usuario que autoriza.

**Why this priority**: Es la funcionalidad principal del negocio: saber exactamente qué material se fue a qué proyecto de qué cliente. Además protege el invariante crítico del sistema (nunca sacar más de lo disponible).

**Independent Test**: Con productos, stock, clientes y proyectos precargados, se prueba creando una salida válida (descuenta stock) y una inválida por cantidad excesiva (rechazada). Entrega el valor central: consumo trazable por proyecto.

**Acceptance Scenarios**:

1. **Given** un producto con 100 unidades disponibles y un proyecto activo, **When** el operario crea una salida de 30 unidades asignada a ese cliente/proyecto y la confirma, **Then** el sistema genera el número de salida auto-correlativo, descuenta el stock (quedan 70 disponibles), registra el usuario que autoriza y guarda fecha y hora.
2. **Given** un producto con 70 unidades disponibles, **When** un usuario intenta confirmar una salida de 80 unidades, **Then** el sistema rechaza la operación indicando la cantidad disponible y no modifica el stock.
3. **Given** el formulario de nueva salida, **When** el usuario intenta guardar sin seleccionar cliente/proyecto, **Then** el sistema rechaza la operación indicando que el cliente/proyecto es obligatorio.
4. **Given** una salida en estado "Pendiente", **When** el usuario la edita o cancela, **Then** los cambios se aplican y la cantidad comprometida se recalcula; **Given** una salida "Confirmada", **When** intenta editarla, **Then** el sistema no lo permite.
5. **Given** dos usuarios que intentan confirmar simultáneamente salidas del mismo producto cuya suma excede el disponible, **When** ambos confirman, **Then** solo una salida se confirma y la otra es rechazada por disponibilidad insuficiente (el stock nunca queda negativo).

---

### User Story 4 - Consultar consumo por cliente y por proyecto (Priority: P2)

Un gerente consulta cuánto material ha consumido cada cliente en sus proyectos: selecciona cliente y período y obtiene el detalle de productos, cantidades y valores por proyecto, con totales por proyecto y por cliente. Para un proyecto específico ve además el margen entre consumo y presupuesto, con gráficos, y puede exportar cualquiera de los reportes a PDF o Excel.

**Why this priority**: Es la pregunta de negocio que motiva el sistema ("¿cuánto material consumió Jumbo en cada proyecto?"); depende de que existan salidas registradas (Historias 1–3).

**Independent Test**: Con salidas precargadas para dos clientes, se genera el reporte filtrado por cliente y período y se verifican los totales contra los datos conocidos; se exporta a PDF y Excel y se comprueba que conservan los filtros aplicados.

**Acceptance Scenarios**:

1. **Given** salidas confirmadas para los proyectos A y B del cliente "Jumbo", **When** el gerente genera el reporte de consumo por cliente con un rango de fechas, **Then** ve por cada proyecto el detalle de productos, cantidades y valores consumidos, el total por proyecto y el total del cliente, limitado al período seleccionado.
2. **Given** un proyecto con presupuesto estimado de $10.000.000 y consumo de $4.000.000, **When** el gerente genera el reporte de consumo por proyecto, **Then** ve el listado detallado de salidas (fecha, producto, cantidad, valor unitario y total), el valor total consumido y el margen consumo vs presupuesto (40% consumido), con un gráfico de consumo.
3. **Given** cualquier reporte generado con filtros, **When** el usuario lo exporta, **Then** obtiene un archivo PDF o Excel con los mismos datos y filtros del reporte en pantalla.
4. **Given** un cliente sin salidas en el período seleccionado, **When** se genera el reporte, **Then** el sistema muestra un estado vacío claro (sin errores) indicando que no hay consumo en el período.

---

### User Story 5 - Consultar inventario con disponibilidad y alertas (Priority: P1)

Cualquier usuario autenticado consulta el estado del inventario: por cada producto ve SKU, descripción, cantidad en stock, cantidad comprometida en salidas pendientes, cantidad disponible, ubicación en almacén y fecha del último movimiento. Puede buscar y filtrar productos, ver el historial de movimientos de cada uno y recibir alertas visuales cuando un producto cae bajo su umbral de stock mínimo.

**Why this priority**: Cierra el ciclo mínimo del negocio: sin consulta de inventario, las historias 1–3 registran datos que nadie puede ver (SC-005 y SC-006 exigen que el stock y sus movimientos sean consultables de inmediato). Es la pantalla de aterrizaje operativa diaria y evita compras o compromisos a ciegas; forma parte del MVP junto con las historias 1–3.

**Independent Test**: Con entradas y salidas precargadas, se verifica que las cantidades en stock/comprometida/disponible cuadran con los movimientos, que la búsqueda filtra correctamente y que un producto bajo umbral aparece marcado en alerta.

**Acceptance Scenarios**:

1. **Given** un producto con 100 unidades ingresadas y una salida pendiente de 20, **When** el usuario consulta el inventario, **Then** ve stock 100, comprometido 20 y disponible 80.
2. **Given** un producto con umbral de stock bajo configurado en 10 y disponible 8, **When** se consulta el inventario, **Then** el producto aparece destacado como stock bajo.
3. **Given** el listado de inventario, **When** el usuario busca por SKU o descripción, **Then** el listado se filtra a los productos coincidentes.
4. **Given** un producto con entradas y salidas, **When** el usuario abre su historial de movimientos, **Then** ve cada movimiento con fecha, tipo (entrada/salida), documento asociado, cantidad y usuario que lo registró.

---

### User Story 6 - Administrar usuarios y roles (Priority: P3)

Un administrador crea usuarios con nombre completo, email, usuario y contraseña, les asigna un rol (Administrador, Gerente u Operario), consulta el listado de usuarios activos, edita sus datos y los desactiva cuando dejan la empresa. Cada usuario inicia sesión con su usuario y contraseña y solo accede a las funciones de su rol.

**Why this priority**: La operación diaria puede arrancar con usuarios precargados; la administración autónoma de usuarios es necesaria pero no bloquea el valor central. (La autenticación y el control por roles son transversales y se exigen desde la primera historia.)

**Independent Test**: Se prueba creando un usuario por cada rol, verificando que cada uno ve solo sus funciones permitidas, editando datos y desactivando un usuario (que ya no puede iniciar sesión pero conserva su historial).

**Acceptance Scenarios**:

1. **Given** un usuario con rol Administrador, **When** crea un usuario con rol Operario, **Then** el nuevo usuario puede iniciar sesión y acceder solo a registro de entradas/salidas y consultas, sin acceso a gestión de usuarios.
2. **Given** un usuario desactivado, **When** intenta iniciar sesión, **Then** el sistema le niega el acceso; sus movimientos históricos siguen mostrando su nombre.
3. **Given** un usuario con rol Operario, **When** intenta acceder a la gestión de usuarios o eliminar registros, **Then** el sistema se lo impide indicando permisos insuficientes.
4. **Given** credenciales inválidas, **When** un usuario intenta iniciar sesión, **Then** el sistema rechaza el acceso sin revelar si el usuario existe.

---

### User Story 7 - Reportes de inventario actual y movimientos (Priority: P3)

Un gerente genera el reporte de inventario actual (stock, comprometido, disponible, valor total del inventario y productos bajo umbral) y el reporte histórico de movimientos (entradas y salidas) filtrable por fecha, tipo, usuario y cliente/proyecto; ambos exportables a PDF y Excel.

**Why this priority**: Complementa la auditoría y los cierres periódicos; el valor operativo inmediato ya lo cubren las historias 4 y 5.

**Independent Test**: Con datos precargados se genera cada reporte, se validan los totales contra los movimientos conocidos y se verifican los filtros y las exportaciones.

**Acceptance Scenarios**:

1. **Given** productos con stock y precios registrados, **When** se genera el reporte de inventario actual, **Then** muestra por producto stock/comprometido/disponible/ubicación, los productos bajo umbral y el valor total del inventario, con filtros por producto y rango de cantidad.
2. **Given** movimientos de entradas y salidas en un rango de fechas, **When** el gerente filtra el reporte de movimientos por tipo "Salida" y un usuario específico, **Then** ve solo las salidas registradas por ese usuario con fecha, documento, producto, cantidad y cliente/proyecto.
3. **Given** cualquiera de los dos reportes, **When** el usuario exporta, **Then** obtiene el archivo PDF o Excel con los datos y filtros aplicados.

---

### User Story 8 - Carga masiva de inventario desde plantilla Excel (Priority: P2)

Un Administrador o Gerente descarga una plantilla Excel del catálogo de productos, la llena (productos nuevos, actualizaciones de productos existentes, o ambos en el mismo archivo) y la sube al sistema. El sistema crea los productos nuevos y actualiza los existentes por SKU; si una fila trae una cantidad inicial, esa cantidad sube el stock del producto con la misma trazabilidad que un ingreso registrado a mano.

**Why this priority**: Acelera la carga inicial y las actualizaciones periódicas del catálogo (decenas o cientos de productos a la vez) sin capturarlos uno por uno; no bloquea el ciclo central del negocio (entra→se asigna→sale, historias 1-3-5), pero reduce fricción operativa real pedida directamente por el dueño del negocio — misma prioridad que la historia de reportes (P2).

**Independent Test**: Se prueba subiendo un archivo con productos nuevos (con cantidad inicial), un producto con SKU ya existente (debe actualizarse, no duplicarse) y una fila deliberadamente inválida; se verifica que el catálogo y el stock quedan correctos y que el resumen reporta la fila inválida sin haber bloqueado las demás. Entrega valor por sí sola: alta/actualización masiva de catálogo con stock inicial trazable.

**Acceptance Scenarios**:

1. **Given** una plantilla llena con 3 productos nuevos (SKU no existente en el catálogo), cada uno con cantidad inicial y valor unitario, **When** un Administrador la sube, **Then** el sistema crea los 3 productos, registra una entrada de inventario trazable por cada uno (mismo criterio de auditoría que un ingreso manual) y muestra un resumen con la cantidad de productos creados y con stock inicial aplicado.
2. **Given** una plantilla con una fila cuyo SKU ya existe en el catálogo, **When** se sube, **Then** el sistema ACTUALIZA ese producto (descripción/categoría/ubicación/umbral) en vez de crear un duplicado, y lo indica en el resumen como actualizado.
3. **Given** una plantilla con una fila inválida (SKU vacío, cantidad negativa, o cantidad inicial mayor a 0 sin valor unitario), **When** se sube, **Then** el sistema procesa el resto de filas válidas con normalidad y reporta esa fila con su error específico en español, sin bloquear el archivo completo.
4. **Given** un usuario con rol Operario, **When** intenta descargar la plantilla o subir un archivo de carga masiva, **Then** el sistema se lo impide (misma restricción que editar productos existentes, solo Administrador/Gerente).
5. **Given** una plantilla vacía (solo encabezados, sin filas de datos) o un archivo que no es un Excel válido, **When** se sube, **Then** el sistema lo rechaza con un mensaje claro en español, sin crear ni modificar ningún producto.
6. **Given** un catálogo con productos ya cargados, **When** el usuario descarga el catálogo actual (opción contigua a la plantilla vacía), **Then** obtiene un Excel con la misma estructura de columnas y una fila por producto existente; al editar descripciones/categorías/ubicaciones/umbrales y volver a subirlo, esos productos se actualizan por SKU y ninguno se duplica ni cambia su stock.

---

### User Story 9 - Administrar roles y permisos (Priority: P2)

Un Administrador define qué puede hacer cada tipo de usuario: consulta el catálogo de permisos del sistema agrupado por módulo, crea roles propios además de los tres iniciales (Administrador, Gerente, Operario), marca qué permisos tiene cada rol, y asigna ese rol a los usuarios. El control de acceso de toda la aplicación pasa a resolverse contra esos permisos.

**Why this priority**: hoy los tres roles y sus permisos están fijos en el código: cambiar qué puede hacer un Gerente exige tocar el código y volver a desplegar. Modelar permisos como datos le da al dueño del negocio autonomía real sobre su organización (por ejemplo, un rol "Bodeguero" que registra ingresos pero no despacha salidas) sin depender de un desarrollador. No es P1 porque el sistema ya opera correctamente con los tres roles fijos.

**Independent Test**: Se prueba creando un rol nuevo con un subconjunto de permisos, asignándoselo a un usuario, e iniciando sesión con él para verificar que solo puede hacer exactamente lo permitido (y que la API rechaza lo demás con 403, no solo la UI). Entrega valor por sí sola: control de acceso configurable sin tocar código.

**Acceptance Scenarios**:

1. **Given** un Administrador en la pantalla de roles, **When** crea el rol "Bodeguero" y le marca solo los permisos de inventario e ingresos, **Then** el rol queda disponible para asignar a usuarios y muestra exactamente esos permisos.
2. **Given** un usuario con el rol "Bodeguero", **When** inicia sesión, **Then** ve en la navegación únicamente los módulos permitidos, y si intenta llamar directamente a un endpoint no permitido (por ejemplo, confirmar una salida) el servidor responde 403.
3. **Given** un rol al que se le quita un permiso, **When** un usuario con ese rol hace su siguiente petición, **Then** el cambio ya está vigente sin que el usuario tenga que volver a iniciar sesión (los permisos se resuelven en el servidor en cada petición).
4. **Given** el rol Administrador (rol del sistema), **When** se intenta eliminarlo, o quitarle el permiso de gestionar roles siendo el último rol que lo tiene, **Then** el sistema lo impide con un mensaje claro en español y no aplica ningún cambio.
5. **Given** un rol con usuarios asignados, **When** se intenta eliminar, **Then** el sistema lo impide indicando cuántos usuarios lo tienen; el rol puede desactivarse, pero no eliminarse dejando usuarios sin rol.
6. **Given** los tres roles iniciales tras migrar a permisos, **When** los usuarios existentes operan normalmente, **Then** pueden hacer exactamente lo mismo que antes de la migración, sin ningún cambio de comportamiento perceptible.

---

### User Story 10 - Panel de control al iniciar sesión (Priority: P2)

Al entrar al sistema, el usuario aterriza en un panel que responde de un vistazo "¿cómo está el negocio hoy y qué me toca hacer?": cifras clave del inventario, pendientes que requieren su acción (salidas por confirmar, ingresos por recibir, productos bajo umbral) y actividad reciente. Cada cifra es un acceso directo a la pantalla que la resuelve.

**Why this priority**: hoy la ruta `/` solo redirige a `/inventario`, así que el ítem "Panel" del menú lleva al mismo sitio que "Inventario" — ocupa un lugar en la navegación sin aportar nada. El sistema ya acumula toda la información necesaria (stock, umbrales, documentos pendientes, consumo, movimientos) pero obliga a recorrer cinco pantallas para saber si algo requiere atención. No es P1 porque la operación diaria funciona sin él.

**Independent Test**: Con datos conocidos (productos bajo umbral, una salida pendiente, un ingreso pendiente), se abre el panel y se verifica que cada cifra coincide exactamente con lo que muestran las pantallas de detalle, y que cada tarjeta navega al listado ya filtrado por ese criterio. Entrega valor por sí sola: una portada operativa que dice qué atender.

**Acceptance Scenarios**:

1. **Given** un inventario con productos bajo su umbral, salidas en estado Pendiente e ingresos en estado Pendiente, **When** el usuario abre el panel, **Then** ve cada una de esas cifras y, al hacer clic en una, llega al listado correspondiente ya filtrado por ese criterio.
2. **Given** un usuario con rol Operario, **When** abre el panel, **Then** ve únicamente las tarjetas cuya información tiene permiso de consultar; las cifras de valorización y consumo (exclusivas de Administrador/Gerente, como los reportes) no se muestran ni viajan al navegador.
3. **Given** un sistema recién instalado sin movimientos, **When** se abre el panel, **Then** cada tarjeta muestra su estado vacío en español (por ejemplo "Sin movimientos registrados"), nunca cifras en blanco, "NaN" ni un error.
4. **Given** el panel abierto, **When** el usuario compara cualquier cifra con la pantalla de detalle correspondiente, **Then** ambas coinciden exactamente (el panel no recalcula por su cuenta: reutiliza los mismos casos de uso que ya alimentan inventario, salidas, ingresos y reportes).

---

### User Story 11 - Exportar cualquier proceso, con la identidad de LOF (Priority: P2)

Cualquier listado o documento del sistema —no solo los reportes— se exporta a PDF y Excel: el historial de ingresos, el de salidas, las órdenes de compra, y cada documento individual. Todos salen firmados con el logo de LOF, de modo que el archivo sirve para enviarlo tal cual a un cliente o a un proveedor.

**Why this priority**: hoy solo los 4 reportes se exportan; el resto de la operación (ingresos y salidas, que es donde vive el día a día) obliga a leerlo en pantalla o copiarlo a mano. Y un PDF sin identidad visual es un documento interno: con el logotipo pasa a ser algo entregable — un soporte que se adjunta en un correo o se imprime para firmar.

**Corrección del 2026-08-15 (decisión del dueño del proyecto)**: en su redacción original esta historia cargaba un logo POR CLIENTE y lo imprimía solo en los exports que correspondían a uno solo. Se retiró: un documento lo firma quien lo EMITE, no su destinatario, así que un logo por ficha era una imagen que mantener para decorar algo que igual identificaba a LOF. Ahora hay un único logotipo institucional y va en todos los exportables sin excepción — incluidos los que abarcan varios clientes o ninguno, que antes salían sin nada.

**Independent Test**: Se exporta un documento de salida a PDF y a Excel, y un listado que abarca varios clientes, y se verifica que los tres abren correctamente, contienen exactamente los datos de la pantalla y muestran el logo de LOF.

**Acceptance Scenarios**:

1. **Given** el historial de ingresos o de salidas con filtros aplicados, **When** el usuario exporta a PDF o Excel, **Then** obtiene un archivo con TODAS las filas que cumplen esos filtros (no solo la página visible) y con los filtros indicados en el encabezado.
2. **Given** una salida o un ingreso concreto, **When** el usuario lo exporta, **Then** obtiene el documento completo (cabecera, líneas, totales y datos de auditoría) en PDF o Excel.
3. **Given** CUALQUIER exportación del sistema —reporte, listado o documento individual, en PDF o en Excel—, **When** el usuario la descarga, **Then** el archivo lleva el logo de LOF, sin depender de a qué cliente o proveedor corresponda su contenido.
4. **Given** un despliegue donde el archivo del logotipo falta o está corrupto, **When** se exporta cualquier cosa, **Then** el archivo se genera IGUAL, sin logo y sin ningún hueco ni error: el contenido manda sobre la decoración (FR-068).

---

### User Story 13 - Filtrar cualquier listado por los campos que el trabajo diario usa (Priority: P2)

Cualquier usuario acota un listado por los campos con los que realmente piensa su trabajo: el inventario por categoría, ubicación, estado del producto y rango de disponible; los ingresos por proveedor; las salidas por número y por quien las autorizó; los clientes por ciudad; los usuarios por rol. Cuando hay filtros activos los ve escritos en pantalla y los quita todos con una sola acción, de modo que nunca queda mirando "pocos resultados" sin saber por qué.

**Why this priority**: los listados ya existen y ya paginan, pero filtran por muy poco: la categoría se captura desde US8 y no se puede usar para buscar, el estado del producto se ve en la tabla y no se puede filtrar, el proveedor solo se alcanza con la caja de búsqueda genérica, y el rol —que desde US9 es un dato administrable— no se puede usar para responder "¿quiénes son mis operarios?". El costo de esto es diario y silencioso: se pagina a mano. No es P1 porque el sistema opera sin ello.

**Independent Test**: Con datos conocidos, se filtra cada listado por uno de sus campos nuevos y se verifica que el conjunto devuelto es exactamente el esperado (ni una fila de más ni de menos), que los filtros aplicados se ven en pantalla, que "Limpiar filtros" devuelve el listado completo y que un filtro sin coincidencias muestra un estado vacío que dice que hay filtros activos. Entrega valor por sí sola: los listados dejan de recorrerse página por página.

**Acceptance Scenarios**:

1. **Given** un catálogo con productos de varias categorías y ubicaciones, **When** el usuario filtra el inventario por una categoría, **Then** ve únicamente los productos de esa categoría, y la lista de categorías que se le ofrece contiene exactamente las que existen en su catálogo (no una lista fija escrita en el código).
2. **Given** productos activos e inactivos en el catálogo, **When** el usuario filtra por estado "Inactivo", **Then** ve solo los dados de baja; sin filtro de estado sigue viendo ambos, como hasta ahora.
3. **Given** un inventario con disponibles muy distintos entre productos, **When** el usuario pide el rango "disponible hasta 10", **Then** ve solo los productos cuyo disponible (stock − comprometido, nunca el stock crudo) cae en ese rango.
4. **Given** salidas autorizadas por distintos usuarios, **When** el gerente filtra por el usuario que autoriza, **Then** ve solo las salidas que esa persona autorizó; las que aún no tienen autorizante (pendientes) no aparecen.
5. **Given** un listado con dos filtros activos, **When** el usuario lo mira, **Then** ve escritos ambos filtros con su valor y una acción para limpiarlos; **When** la usa, **Then** vuelve al listado completo en un solo paso.
6. **Given** un filtro que no coincide con ningún registro, **When** se muestra el listado vacío, **Then** el mensaje en español dice que no hay resultados **con los filtros aplicados** (y no el mismo texto que vería un sistema recién instalado, que debe decir que aún no hay registros).
7. **Given** un rol propio creado por el Administrador (US9), **When** se abre el filtro de rol del listado de usuarios, **Then** ese rol aparece entre las opciones sin haber tocado código.

---

### User Story 14 - Editar mis propios datos personales (Priority: P3)

Cualquier usuario con sesión iniciada abre su perfil y corrige su nombre completo y su correo electrónico, sin depender de que un Administrador lo haga por él. Desde la misma pantalla puede cambiar su contraseña, que ya era posible.

**Why this priority**: hoy un usuario que se casa, cambia de correo o al que escribieron mal el nombre al darlo de alta tiene que pedirle a un Administrador que lo corrija; y su nombre aparece en cada movimiento de inventario que registra, así que un dato mal escrito se propaga a toda la trazabilidad. No es P1 porque el sistema opera perfectamente sin ello y la corrección ya es posible por la vía administrativa (US6).

**Independent Test**: Se prueba entrando con un usuario cualquiera, cambiando su nombre y su correo, y verificando que el cambio se refleja de inmediato en la aplicación (por ejemplo, en el bloque de usuario de la navegación) y en los movimientos que ese usuario ya había registrado. Entrega valor por sí sola: autonomía sobre los datos propios.

**Acceptance Scenarios**:

1. **Given** un usuario con sesión iniciada en su perfil, **When** corrige su nombre completo y su correo y guarda, **Then** los cambios quedan aplicados, se ven de inmediato en la aplicación sin volver a iniciar sesión, y sus movimientos históricos pasan a mostrar el nombre corregido.
2. **Given** un usuario que escribe un correo ya usado por otra persona, **When** guarda, **Then** el sistema lo rechaza indicando el campo del error en español y no aplica ningún cambio.
3. **Given** un usuario en su perfil, **When** observa la pantalla, **Then** ve su usuario y su rol como datos de solo lectura: el nombre de usuario identifica sus registros históricos y el rol define lo que puede hacer, así que ninguno se cambia desde aquí.
4. **Given** un usuario que intenta modificar su propio rol o su estado enviando esos datos directamente a la API, **When** lo hace, **Then** el sistema los ignora por completo y solo aplica nombre y correo.
5. **Given** un usuario en su perfil, **When** cambia su contraseña, **Then** funciona igual que siempre (exige la contraseña actual) sin duplicar esa funcionalidad en otra pantalla.

---

### User Story 15 - Catálogos parametrizables: categorías y proveedores (Priority: P2)

La categoría que se pide al crear un producto, y el proveedor que se pide al registrar un ingreso, dejan de escribirse a mano y pasan a elegirse de catálogos que el negocio administra: se dan de alta, se renombran y se dan de baja desde su propia pantalla, y los filtros de búsqueda ofrecen exactamente esos valores.

**Why this priority**: hoy la categoría es texto libre (se introdujo así en US8), y eso produce "Ferretería", "ferreteria" y "FERRETERIA " como tres categorías distintas para el ojo del sistema. Un inventario clasificado con variantes tipográficas no se puede filtrar ni agrupar de forma fiable, que es justo para lo que sirve una categoría. No es P1 porque el inventario funciona sin ello, pero la clasificación se degrada con cada producto que se da de alta, así que cuanto más tarde se corrija, más datos hay que limpiar.

**Independent Test**: Se prueba dando de alta una categoría, creando un producto que la use, y comprobando que aparece como opción en el filtro del inventario y que filtrar por ella devuelve ese producto. Entrega valor por sí sola: clasificación consistente y filtrable.

**Acceptance Scenarios**:

1. **Given** un usuario con permiso para gestionar categorías, **When** crea una categoría, **Then** queda disponible de inmediato para clasificar productos y como opción del filtro de inventario.
2. **Given** el formulario de alta o edición de un producto, **When** el usuario indica la categoría, **Then** la elige de una lista del catálogo —no la escribe—, y la categoría sigue siendo opcional (un producto sin clasificar es válido).
3. **Given** dos categorías que solo se diferencian en mayúsculas o espacios ("Ferretería" y "ferretería "), **When** se intenta crear la segunda, **Then** el sistema la rechaza como duplicada, señalando el campo en español.
4. **Given** una categoría con productos asociados, **When** se intenta eliminarla, **Then** el sistema NO la elimina: se desactiva, de modo que deja de ofrecerse para clasificar productos nuevos pero los productos que ya la usan conservan su clasificación y su historial.
5. **Given** el catálogo de categorías, **When** un usuario sin permiso de gestión abre la aplicación, **Then** puede seguir viendo y filtrando por categorías (las necesita para trabajar), pero no puede crearlas ni modificarlas.
6. **Given** una carga masiva de productos desde Excel, **When** una fila trae una categoría que no existe en el catálogo, **Then** esa fila se rechaza con un mensaje que nombra la categoría desconocida, sin bloquear las demás filas del archivo.
7. **Given** el formulario de un ingreso de mercancía, **When** el usuario indica el proveedor, **Then** lo elige del catálogo de proveedores en vez de escribirlo, y el listado de ingresos permite filtrar por proveedor con esa misma lista.
8. **Given** un proveedor con ingresos registrados, **When** se intenta eliminarlo, **Then** el sistema lo desactiva en lugar de borrarlo, de modo que los ingresos históricos conservan a quién se le compró (Principio II).

---

### User Story 16 - Órdenes de compra al proveedor (Priority: P2)

Cuando falta mercancía, el negocio arma una ORDEN DE COMPRA dirigida a un proveedor: elige los productos y las cantidades, la exporta en PDF y se la envía. La orden queda registrada con su número, de modo que en cualquier momento se puede responder "¿qué le pedimos a Formex y qué falta por llegar?".

**Why this priority**: hoy el sistema solo sabe de mercancía que YA llegó. Todo lo que se pidió y todavía no ha llegado vive en el correo o en la cabeza de quien lo pidió, y por eso se pide dos veces lo mismo o no se reclama lo que nunca llegó. No es P1 porque el inventario funciona sin ello —el ingreso se puede registrar igual—, pero es la única parte del ciclo de compra que el sistema no cubre. Se apoya enteramente en el catálogo de proveedores de US15: sin él, una orden no tendría a quién dirigirse.

**Independent Test**: Se prueba creando una orden para un proveedor con dos productos, exportándola a PDF y comprobando que el documento trae el número de orden, el proveedor, las líneas y el total. Entrega valor por sí sola: un documento formal que enviarle al proveedor y un registro de lo pedido.

**Acceptance Scenarios**:

1. **Given** un usuario con permiso para crear órdenes, **When** elige un proveedor, **Then** el sistema le sugiere los productos bajo umbral que ESE proveedor ya le ha suministrado, con una cantidad sugerida que él puede cambiar o descartar.
2. **Given** una orden en BORRADOR, **When** el usuario la edita, **Then** puede agregar, quitar y modificar líneas; el total se recalcula solo.
3. **Given** una orden en BORRADOR, **When** un Administrador o Gerente la marca como ENVIADA, **Then** deja de ser editable, porque a partir de ahí el proveedor ya tiene un compromiso en la mano.
4. **Given** una orden ENVIADA, **When** el usuario exporta su PDF, **Then** obtiene un documento con el número de orden, los datos del proveedor, las líneas con cantidades y precios, el total y quién la generó.
5. **Given** una orden ENVIADA cuya mercancía llega, **When** el usuario registra el ingreso desde la propia orden, **Then** el formulario llega precargado con su proveedor y sus líneas, el ingreso queda vinculado a la orden, y al recibirlo la orden pasa a RECIBIDA.
6. **Given** una orden ENVIADA que el proveedor no va a atender, **When** un Administrador o Gerente la anula indicando el motivo, **Then** queda ANULADA con ese motivo y deja de contarse como pendiente de llegar.
7. **Given** cualquier orden de compra, **When** se consulta el inventario, **Then** el stock NO ha cambiado: una orden es un compromiso de compra, no un movimiento de mercancía.

---

### User Story 17 - Unidad de medida de los productos (Priority: P2)

Cada producto se mide en algo —kilogramos, metros, unidades, cajas— y hoy el sistema no lo sabe: una cantidad de "12" no dice si son 12 sacos o 12 toneladas. La unidad pasa a ser un catálogo administrable, obligatorio al dar de alta un producto y visible allí donde se muestran cantidades.

**Why this priority**: no bloquea ninguna operación —el inventario lleva meses funcionando sin ello— pero cada número que sale del sistema es ambiguo, y esa ambigüedad viaja a los documentos que se le envían a clientes y proveedores. Cuanto más tarde se corrija, más productos hay que completar a mano.

**El inventario que ya existe NO se rompe**: los productos cargados hasta hoy se quedan sin unidad, y así siguen hasta que alguien los edite. Exigirla retroactivamente habría dejado el catálogo entero en estado inválido de un día para otro.

**Independent Test**: Se prueba dando de alta una unidad ("Kilogramo / kg"), creando un producto que la use y comprobando que la cantidad se muestra acompañada de su unidad en el inventario. Entrega valor por sí sola: cantidades que se leen sin adivinar.

**Acceptance Scenarios**:

1. **Given** un usuario con permiso para gestionar unidades, **When** crea una ("Kilogramo", abreviatura "kg"), **Then** queda disponible de inmediato para los productos y como opción del formulario.
2. **Given** el formulario de alta de un producto, **When** el usuario intenta guardarlo sin unidad, **Then** el sistema lo rechaza señalando el campo: desde ahora la unidad es obligatoria.
3. **Given** un producto ANTIGUO sin unidad, **When** alguien lo edita, **Then** se le exige completarla para poder guardar — así el inventario se limpia con el uso, sin una tarea aparte.
4. **Given** una carga masiva desde Excel, **When** una fila crea un producto NUEVO sin unidad, **Then** esa fila se rechaza con un mensaje que lo explica, sin bloquear las demás (misma regla de proceso parcial de FR-051).
5. **Given** una carga masiva que ACTUALIZA un producto que ya tenía unidad, **When** la celda de unidad viene vacía, **Then** el producto CONSERVA su unidad — una celda en blanco no puede devolver un producto al estado que las reglas de arriba prohíben.
6. **Given** una unidad usada por algún producto, **When** se intenta eliminarla, **Then** el sistema NO la elimina: se desactiva, y los productos que la usan la conservan (mismo criterio que categorías).

---

### User Story 18 - Alta de producto con existencias iniciales (Priority: P2)

Dar de alta un producto que YA está físicamente en la bodega son hoy dos gestiones: crearlo en el catálogo —donde nace en cero— y después registrar un ingreso para darle stock. El Excel de carga masiva sí lo hace de una vez ("Cantidad inicial" y "Valor unitario"), así que quien da de alta uno a uno hace más trabajo que quien carga cien.

**Why this priority**: no bloquea nada —el camino de dos pasos existe y funciona— pero es el hueco que más se nota al usar el sistema a diario, y nació de una asimetría que no decidió nadie: la carga masiva ganó esas dos columnas en US8 y el formulario nunca las tuvo.

**El stock sigue sin escribirse a mano**: la cantidad inicial NO se guarda en el producto; genera un INGRESO real, con su proveedor, su línea y su movimiento de entrada, igual que si se hubiera registrado a mano (misma regla que FR-050 aplica a la carga masiva). Por eso el alta pregunta el proveedor: un ingreso sin él no existe, y atribuirlo a un proveedor sintético haría que el movimiento mintiera sobre de dónde vino la mercancía.

**Independent Test**: Se prueba dando de alta un producto con proveedor, cantidad y valor unitario, y comprobando que aparece en el inventario con ese stock Y que existe un ingreso recibido que lo respalda. Entrega valor por sí sola: una gestión en vez de dos.

**Acceptance Scenarios**:

1. **Given** el formulario de alta desde el catálogo, **When** el usuario informa proveedor, cantidad inicial y valor unitario, **Then** el producto queda creado con ese stock y con un ingreso RECIBIDO que lo respalda, con su movimiento de entrada y su registro en el historial de costos.
2. **Given** el mismo formulario, **When** el usuario deja la cantidad inicial vacía o en cero, **Then** el producto se crea en cero y NO se genera ningún ingreso — el alta se comporta como antes de esta historia.
3. **Given** una cantidad inicial mayor que cero, **When** falta el proveedor o el valor unitario, **Then** el sistema lo rechaza señalando el campo que falta: sin ellos el ingreso no se puede registrar.
4. **Given** el alta rápida DENTRO del formulario de ingresos, **When** se crea un producto desde ahí, **Then** NO se piden cantidad ni proveedor: los pone la línea del ingreso que se está registrando, y pedirlos dos veces registraría el stock por duplicado.
5. **Given** un alta con existencias, **When** se consulta el producto recién creado, **Then** su costo unitario es el informado y el historial de costos muestra ese primer valor con su origen.

---

### User Story 19 - Modo claro (Priority: P3)

Nocturne es un sistema de diseño oscuro y la aplicación se ve así desde el primer día. Quien trabaja junto a una ventana, imprime desde pantalla o simplemente lee mejor sobre blanco no tiene alternativa. Un control siempre visible alterna entre claro y oscuro.

**Why this priority**: no cambia lo que el sistema hace, solo cómo se ve. Va al final de la cola por eso mismo, pero es de las cosas que se miran todos los días.

**Los tokens vendorizados NO se editan**: `globals.css` advierte que la paleta de Nocturne viene del proyecto de diseño y que tocarla a mano desincroniza el origen. El modo claro se añade como una capa propia que REDEFINE esos tokens cuando el tema claro está activo, sin alterar el bloque vendorizado — así un `DesignSync` futuro sigue entrando limpio.

**Independent Test**: Se prueba pulsando el control, viendo la interfaz completa en claro, recargando y comprobando que sigue en claro. Entrega valor por sí sola.

**Acceptance Scenarios**:

1. **Given** la aplicación en oscuro, **When** el usuario pulsa el control de tema, **Then** toda la interfaz pasa a claro sin recargar la página.
2. **Given** un usuario que ya eligió claro, **When** vuelve a entrar más tarde, **Then** la aplicación abre en claro: la elección se recuerda en su navegador.
3. **Given** un usuario que nunca ha elegido tema, **When** entra por primera vez, **Then** la aplicación respeta la preferencia de su sistema operativo.
4. **Given** cualquier tema guardado, **When** se carga una página, **Then** NO se ve un destello del tema contrario antes de pintar el elegido.

---

### User Story 20 - IVA en las líneas de los documentos (Priority: P2)

Los documentos del sistema mueven dinero sin decir nada del impuesto: una factura de compra por $1.000.000 no distingue base de IVA, y el total que se le muestra a un proveedor o a un cliente no es el que se va a pagar. Cada línea gana su tasa de IVA y cada documento muestra base, IVA y total.

**Why this priority**: es lo que separa un total informativo de uno que se puede poner en un documento y enviar. Y hace falta ANTES que las cotizaciones (US21), que nacen ya con impuesto.

**Los documentos que ya existen no cambian de valor**: la tasa nace en 0% para todo lo registrado hasta hoy, así que ningún total histórico se mueve. El IVA aparece a partir de que alguien lo elija.

**La valorización del inventario NO lleva IVA**: el costo del producto y el valor del inventario siguen siendo la base gravable. El IVA es un impuesto que se recupera, no lo que vale la mercancía en la bodega — meterlo en el costo inflaría un 19% todos los reportes de valorización frente a la contabilidad.

**Independent Test**: Se prueba registrando un ingreso con una línea al 19% y comprobando que el documento muestra base, IVA y total, y que el costo con el que queda el producto es la base, no el total.

**Acceptance Scenarios**:

1. **Given** una línea de cualquier documento con cantidad y precio, **When** el usuario elige 19% en el cuadro de IVA, **Then** la línea muestra su IVA calculado y el total del documento lo suma, sin teclear nada más.
2. **Given** un documento con líneas a distintas tasas, **When** se consulta su total, **Then** el IVA se calcula línea a línea sobre su propia base y se totaliza — nunca aplicando una tasa única al total.
3. **Given** una línea al 0%, **When** se guarda, **Then** el documento se comporta exactamente como antes de esta historia: base igual a total.
4. **Given** un ingreso recibido con IVA, **When** se consulta el costo del producto, **Then** el costo registrado es el precio SIN IVA, y el historial de costos guarda ese mismo valor.
5. **Given** un documento con IVA, **When** se exporta a PDF o Excel, **Then** el documento exportado muestra las tres cifras: base gravable, IVA y total.

---

### User Story 21 - Cotizaciones a clientes (Priority: P2)

Antes de que exista una salida hay una oferta: al cliente se le pasa un documento con productos, cantidades, precios e impuestos, y él decide. Hoy eso se hace fuera del sistema, así que el precio ofrecido no queda registrado en ninguna parte y, cuando el cliente acepta, la salida se teclea otra vez desde cero.

**Why this priority**: cierra el ciclo comercial por el lado de la venta, igual que US16 lo cerró por el de la compra. Es el mismo documento-compromiso que una orden de compra, mirando hacia el otro lado.

**Una cotización NO es una salida**: no mueve inventario ni compromete stock en ninguno de sus estados. Es una oferta; la mercancía se compromete cuando la salida que nace de ella se confirma, con el flujo de stock que ya existe (FR-025).

**Independent Test**: Se prueba creando una cotización para un cliente, exportándola a PDF y aceptándola, y comprobando que aparece una salida pendiente con las mismas líneas. Entrega valor por sí sola: la oferta queda registrada aunque nunca se acepte.

**Acceptance Scenarios**:

1. **Given** un usuario con permiso para cotizar, **When** crea una cotización con cliente, proyecto y líneas, **Then** el sistema le asigna un número correlativo propio y la deja en BORRADOR.
2. **Given** una cotización en BORRADOR, **When** el usuario la exporta, **Then** obtiene un PDF con el logo institucional, sus líneas y las tres cifras del documento, listo para enviárselo al cliente.
3. **Given** una cotización ENVIADA, **When** el cliente la acepta y el usuario la marca como aceptada, **Then** el sistema genera una SALIDA pendiente con las mismas líneas, enlazada a la cotización, y no mueve stock todavía.
4. **Given** una cotización ENVIADA, **When** el cliente la rechaza, **Then** queda RECHAZADA y no genera nada.
5. **Given** una cotización que ya no está en BORRADOR, **When** alguien intenta editar sus líneas, **Then** el sistema lo impide: lo que se le mostró al cliente no se reescribe.
6. **Given** una cotización cuya fecha de validez ya pasó, **When** se consulta el listado, **Then** se muestra como vencida sin que nadie tenga que marcarla a mano.

---

### User Story 22 - Buscadores que encuentran (Priority: P2)

Todos los listados tienen su caja de búsqueda, pero escribir en ella lo que uno diría en voz alta no funciona: "cemento gris" no encuentra el "Cemento gris 50 kg" porque hasta ahora la frase entera viajaba como una sola subcadena, y solo coincidía si esas dos palabras aparecían juntas, en ese orden y con ese espacio exacto. El resultado práctico es que la gente escribe una palabra, no encuentra, y deja de usar el buscador.

**Why this priority**: no falta ninguna funcionalidad —los datos están y los filtros funcionan— pero la vía más rápida para llegar a ellos está rota, y se usa decenas de veces al día.

**Independent Test**: Se prueba escribiendo dos palabras que están en campos distintos del mismo registro y comprobando que lo encuentra. Entrega valor por sí sola.

**Acceptance Scenarios**:

1. **Given** un producto "Cemento gris 50 kg", **When** el usuario busca `cemento gris`, **Then** lo encuentra; y también buscando `gris cemento`, porque el orden de las palabras no importa.
2. **Given** varios productos que contienen "cemento", **When** el usuario añade una palabra más, **Then** el resultado se ESTRECHA — cada término que se escribe filtra más, nunca menos.
3. **Given** un producto cuyo SKU es "CEM-001", **When** el usuario busca `cem 001` sin el guion, **Then** lo encuentra.
4. **Given** una cotización N.º 42 del cliente Jumbo, **When** el usuario busca `42 jumbo`, `COT-000042` o `jumbo`, **Then** las tres formas llegan al mismo documento.
5. **Given** una consulta con palabras que no están en ningún campo, **When** se busca, **Then** el listado sale vacío: el buscador sigue siendo preciso, no devuelve "lo más parecido".

---

### Edge Cases

- **Salida mayor al disponible**: debe rechazarse siempre, incluida la carrera entre dos usuarios simultáneos sobre el mismo producto (solo una confirmación puede ganar).
- **Número de factura duplicado**: rechazado con mensaje claro; la unicidad se garantiza aunque dos usuarios registren a la vez.
- **Edición de documentos que ya afectaron stock**: los ingresos "Recibido/Verificado" y las salidas "Confirmada/Completada" no son editables; las correcciones se hacen mediante anulación con movimiento inverso registrado (auditado), nunca borrando el documento.
- **Cliente o proyecto inactivo/suspendido/completado**: no puede recibir nuevas salidas, pero su historial sigue consultable en reportes.
- **Usuario desactivado**: no puede iniciar sesión; su nombre permanece en los movimientos históricos que registró.
- **Producto sin movimientos vs. con movimientos**: un producto con movimientos no puede eliminarse; solo marcarse inactivo.
- **Reporte sin datos en el período**: muestra estado vacío claro, sin errores; la exportación produce un archivo válido con encabezados y sin filas.
- **Cantidades con decimales**: se aceptan hasta 2 decimales (materiales medidos en metros/kg); nunca cantidades cero o negativas.
- **Sesión expirada a mitad de un formulario**: al reintentar guardar, el sistema pide autenticarse de nuevo sin perder la información capturada o indicando claramente que debe recapturarse.
- **Salida pendiente cuya disponibilidad desaparece** (otro usuario consumió el stock): al intentar confirmarla, se rechaza indicando el disponible actual.
- **SKU repetido dentro del mismo archivo de carga masiva**: la primera ocurrencia se procesa; las repeticiones posteriores del mismo SKU en el archivo se reportan como fila inválida (evita aplicar dos altas/actualizaciones contradictorias del mismo producto en una sola corrida).
- **Carga masiva con cantidad inicial pero el catálogo sí se actualizó**: si registrar el stock inicial falla por una causa ajena a los datos del archivo (ej. corte de conexión), los productos quedan creados/actualizados igual; el archivo se puede volver a subir para aplicar el stock pendiente sin duplicar el producto (ver data-model.md § Carga masiva de inventario).

## Requirements *(mandatory)*

### Functional Requirements

**Autenticación y control de acceso**

- **FR-001**: El sistema DEBE exigir autenticación con usuario y contraseña para acceder a cualquier función.
- **FR-002**: El sistema DEBE restringir las funciones según el rol del usuario: Administrador (todo, incluida gestión de usuarios), Gerente (operación completa de inventario, clientes, proyectos y reportes), Operario (registro de entradas/salidas y consultas).
- **FR-003**: El sistema DEBE verificar los permisos en el servidor para cada operación; la ocultación de opciones en pantalla no sustituye esta verificación.
- **FR-004**: El sistema DEBE cerrar sesiones inactivas tras un período de expiración y rechazar accesos anónimos.

**Gestión de usuarios**

- **FR-005**: Los administradores DEBEN poder crear usuarios con nombre completo, email, usuario (login), contraseña y rol; el sistema registra fecha de creación y estado.
- **FR-006**: Los administradores DEBEN poder listar usuarios (con filtro por estado), editar sus datos, restablecer contraseñas y activar/desactivar usuarios.
- **FR-007**: El sistema DEBE almacenar contraseñas de forma irrecuperable (hash criptográfico) y NUNCA mostrarlas.
- **FR-008**: El sistema DEBE impedir la eliminación física de usuarios con actividad registrada; la baja es siempre desactivación.
- **FR-009**: El sistema DEBE rechazar usuarios (login) y emails duplicados.

**Catálogo de productos**

- **FR-010**: El sistema DEBE mantener un catálogo de productos con SKU/código único, descripción, ubicación en almacén y umbral de stock bajo configurable por producto.
- **FR-011**: Los usuarios DEBEN poder crear productos nuevos al registrar un ingreso (alta rápida) o desde el catálogo, y editar su descripción, ubicación y umbral.
- **FR-012**: El sistema DEBE impedir eliminar productos con movimientos; solo pueden marcarse inactivos.

**Ingreso de mercancía (facturas)**

- **FR-013**: Los usuarios (Operario, Gerente, Administrador) DEBEN poder crear ingresos de mercancía con: número de factura, fecha de factura, proveedor, fecha de recepción, observaciones y una o más líneas de producto (producto, cantidad, precio unitario).
- **FR-014**: El sistema DEBE calcular automáticamente el valor total por línea (cantidad × precio unitario) y el valor total del ingreso.
- **FR-015**: El sistema DEBE garantizar que el número de factura sea único, incluso ante registros simultáneos.
- **FR-016**: El sistema DEBE validar que cantidades y precios sean números positivos (cantidades con hasta 2 decimales) y que los campos obligatorios no estén vacíos, con mensajes de error en español que indiquen el campo y la corrección esperada.
- **FR-017**: El sistema DEBE manejar los estados de ingreso Pendiente → Recibido → Verificado: "Pendiente" no afecta stock y es editable; al pasar a "Recibido" el stock de cada producto aumenta de inmediato; "Verificado" marca la revisión final y no permite más cambios.
- **FR-018**: El sistema DEBE registrar en cada ingreso el usuario que lo registra, y mostrar el historial de ingresos con búsqueda y paginación.
- **FR-019**: El sistema DEBE permitir anular un ingreso "Recibido" solo a Gerente/Administrador, generando el movimiento inverso de stock (si hay disponibilidad suficiente) y dejando rastro auditado del motivo.

**Inventario / stock**

- **FR-020**: El sistema DEBE mostrar por producto: SKU, descripción, cantidad en stock, cantidad comprometida (salidas en estado Pendiente), cantidad disponible (stock − comprometida), ubicación y fecha del último movimiento.
- **FR-021**: El sistema DEBE actualizar el stock en tiempo real al registrar entradas ("Recibido") y salidas ("Confirmada"); toda consulta posterior a la operación refleja el nuevo valor.
- **FR-022**: El sistema DEBE destacar visualmente los productos cuya cantidad disponible esté en o por debajo de su umbral de stock bajo.
- **FR-023**: Los usuarios DEBEN poder buscar y filtrar productos por SKU y descripción, con listados paginados.
- **FR-024**: El sistema DEBE mostrar el historial de movimientos por producto (fecha, tipo entrada/salida, documento asociado, cantidad, usuario, cliente/proyecto si aplica).

**Salida de mercancía**

- **FR-025**: Los usuarios DEBEN poder crear salidas de mercancía con: cliente y proyecto de destino (obligatorio, seleccionable de una lista de proyectos activos), una o más líneas de producto (producto, cantidad, precio unitario de referencia), observaciones y fecha de salida.
- **FR-026**: El sistema DEBE asignar a cada salida un número auto-correlativo único.
- **FR-027**: El sistema DEBE rechazar cualquier salida sin cliente/proyecto asignado.
- **FR-028**: El sistema DEBE impedir confirmar salidas con cantidad mayor a la disponible; la validación se ejecuta en el servidor de forma atómica, de modo que el stock nunca quede negativo ni ante operaciones simultáneas.
- **FR-029**: El sistema DEBE manejar los estados de salida Pendiente → Confirmada → Completada: "Pendiente" compromete la cantidad (reduce el disponible, no el stock) y es editable o cancelable; al pasar a "Confirmada" el stock se descuenta de inmediato y la salida deja de ser editable; "Completada" marca la entrega física final.
- **FR-030**: El sistema DEBE registrar en cada salida el usuario que la autoriza, con fecha y hora.
- **FR-031**: El sistema DEBE calcular el valor total de la salida a partir de las líneas (cantidad × precio unitario de referencia).
- **FR-032**: El sistema DEBE permitir anular una salida "Confirmada" solo a Gerente/Administrador, devolviendo las cantidades al stock mediante movimiento inverso auditado con motivo.
- **FR-033**: El sistema DEBE listar todas las salidas con filtros por cliente, proyecto, estado y fecha, con paginación.

**Clientes y proyectos**

- **FR-034**: Los usuarios (Gerente, Administrador) DEBEN poder crear y editar clientes con: nombre, NIT/identificación, teléfono, email, dirección, ciudad; el sistema registra fecha de registro y estado (Activo/Inactivo).
- **FR-035**: El sistema DEBE rechazar clientes con NIT duplicado.
- **FR-036**: Los usuarios (Gerente, Administrador) DEBEN poder crear y editar proyectos asociados a un cliente con: nombre, descripción, fecha de inicio, fecha de cierre estimada, responsable y presupuesto estimado; con estados Activo/Completado/Suspendido.
- **FR-037**: El sistema DEBE listar clientes y, por cada cliente, sus proyectos; y mostrar el historial de salidas por cliente y por proyecto.
- **FR-038**: El sistema DEBE ofrecer como destino de nuevas salidas únicamente proyectos en estado "Activo" de clientes "Activos".

**Reportes**

- **FR-039**: El sistema DEBE generar el reporte de consumo por cliente: proyectos del cliente, detalle de productos y cantidades consumidas por proyecto, valor total por proyecto y por cliente, filtrable por cliente y rango de fechas de salida.
- **FR-040**: El sistema DEBE generar el reporte de consumo por proyecto: datos del proyecto y cliente, listado detallado de salidas (fecha, producto, cantidad, valor unitario, valor total), valor total consumido, margen consumo vs presupuesto y un gráfico de consumo, filtrable por proyecto y fechas.
- **FR-041**: El sistema DEBE generar el reporte de inventario actual: productos con stock/comprometido/disponible, ubicación, valor total del inventario y productos bajo umbral, filtrable por producto y rango de cantidad.
- **FR-042**: El sistema DEBE generar el reporte de movimientos: fecha, tipo (entrada/salida), documento asociado, producto, cantidad, usuario y cliente/proyecto cuando aplique, filtrable por fecha, tipo, usuario y cliente/proyecto.
- **FR-043**: Todos los reportes DEBEN poder exportarse a PDF y a Excel conservando los filtros aplicados, y poder imprimirse desde la vista del reporte.
- **FR-044**: En los reportes, el consumo DEBE calcularse sobre salidas en estado "Confirmada" o "Completada" (las pendientes y anuladas no cuentan como consumo).

**Carga masiva de inventario (US8)**

- **FR-048**: El sistema DEBE ofrecer una plantilla Excel descargable con las columnas del catálogo de productos (SKU, descripción, categoría, ubicación, umbral de stock bajo, cantidad inicial, valor unitario).
- **FR-049**: El sistema DEBE permitir subir un archivo Excel con esa plantilla llena; por cada fila válida, DEBE crear el producto si su SKU no existe en el catálogo, o actualizarlo si ya existe (nunca duplicarlo).
- **FR-050**: Si una fila trae una cantidad inicial mayor a cero, el sistema DEBE registrar esa cantidad como una entrada de inventario con la misma trazabilidad (usuario, fecha, documento asociado) que un ingreso registrado manualmente, exigiendo el valor unitario en ese caso.
- **FR-051**: El sistema DEBE procesar el archivo de forma parcial: las filas inválidas se reportan de forma individual con su error específico en español, sin bloquear la creación/actualización de las filas válidas del mismo archivo.
- **FR-052**: El catálogo de productos DEBE incluir un campo de categoría (texto libre, opcional), editable tanto desde la carga masiva como desde el alta/edición manual de un producto (FR-010).
- **FR-053**: Junto a la plantilla vacía (FR-048), el sistema DEBE ofrecer la descarga del catálogo actual completo en esa MISMA estructura de columnas, para que el usuario edite los productos existentes y vuelva a subir el archivo como actualización masiva (FR-049 ya resuelve la actualización por SKU). La descarga del catálogo NO incluye cantidad inicial ni valor unitario con valores (esas columnas viajan vacías): re-subir el archivo sin tocarlas actualiza solo datos de catálogo, nunca vuelve a sumar stock.

**Gestión de roles y permisos (US9)**

- **FR-054**: El sistema DEBE modelar los permisos como datos: un catálogo de permisos por módulo y acción, y roles a los que se les asignan permisos, en lugar de una lista de roles fija en el código.
- **FR-055**: Un Administrador DEBE poder crear, editar, activar/desactivar y consultar roles, y asignar o quitar permisos a cada rol.
- **FR-056**: El catálogo de permisos es de SOLO LECTURA desde la interfaz: cada permiso corresponde a una verificación real en el código, por lo que se define en el sistema (semilla) y no se crea desde la aplicación — lo que el Administrador gestiona es qué permisos tiene cada rol (ver research.md R16).
- **FR-057**: El sistema DEBE impedir cualquier operación que deje a la organización sin capacidad de administrar roles o usuarios: no se puede eliminar un rol del sistema, ni eliminar un rol que tenga usuarios asignados, ni quitar el permiso de gestión de roles del último rol que lo tiene.
- **FR-057b**: Nadie DEBE poder conceder —ni asignando un rol a un usuario, ni creando o editando un rol— permisos que su propio rol no tenga. Sin esta regla, el permiso de gestión de roles sería auto-escalable: quien lo tuviera podría concederse todos los demás en una sola operación, y marcar esa casilla equivaldría a conceder administración total de forma silenciosa.
- **FR-058**: La autorización de cada endpoint DEBE verificarse contra los permisos efectivos del rol del usuario autenticado, resueltos en el servidor en cada petición (nunca contra un nombre de rol fijo en el código, ni contra un dato del cliente).
- **FR-059**: Los tres roles iniciales (Administrador, Gerente, Operario) DEBEN existir como roles del sistema con exactamente los permisos que ya tenían, de modo que la migración a permisos no cambie el comportamiento observable de ningún usuario existente.

**Panel de control (US10)**

- **FR-060**: La ruta de inicio DEBE mostrar un panel con las cifras operativas del negocio, no una redirección a otro módulo: valor del inventario, productos bajo umbral, salidas pendientes de confirmar, ingresos pendientes de recibir, consumo del período en curso y actividad reciente.
- **FR-061**: Cada cifra del panel DEBE ser accionable: al seleccionarla, el sistema navega al listado correspondiente ya filtrado por ese criterio (por ejemplo, "productos bajo umbral" abre el inventario con ese filtro activo).
- **FR-062**: El panel DEBE respetar los permisos del usuario: el servidor incluye únicamente las cifras que ese usuario puede consultar, y las que no puede no se envían al navegador (ocultarlas en el cliente no es control de acceso).
- **FR-063**: Las cifras del panel DEBEN provenir de los mismos casos de uso que alimentan las pantallas de detalle, nunca de un cálculo paralelo propio del panel, de modo que jamás puedan discrepar entre sí.

**Exportación universal e identidad del cliente (US11)**

- **FR-064**: Los listados de ingresos y de salidas DEBEN poder exportarse a PDF y Excel con los mismos filtros aplicados en pantalla, incluyendo TODAS las filas que cumplen el filtro (no solo la página visible) — la paginación es una comodidad de lectura, no un recorte de los datos.
- **FR-065**: Un ingreso y una salida individuales DEBEN poder exportarse como documento completo (cabecera, líneas, totales y datos de auditoría) a PDF y Excel.
- **FR-066**: ~~Cargar, reemplazar y quitar el logo de cada cliente.~~ **RETIRADO (2026-08-15, decisión del dueño del proyecto)**: los documentos que salen del sistema los firma LOF, no el cliente al que van dirigidos. Un logo por cliente obligaba a mantener una imagen por ficha para decorar un documento que igual identifica a quien lo emite. La capacidad, sus tres endpoints y las columnas que la sostenían se eliminaron; el logo institucional de FR-067 la sustituye por completo.
- **FR-067**: TODO archivo exportado —sin excepción, sea reporte, listado o documento individual— DEBE llevar el logo institucional de LOF. No depende del contenido del archivo ni de a quién vaya dirigido: es la identidad de quien lo emite, así que el logo se aplica en el punto por el que pasan todas las exportaciones y no en cada una por separado. Así ninguna exportación futura puede nacer sin él por olvido.
- **FR-068**: El logo DEBE aplicarse tanto al PDF como al Excel, y su ausencia o su fallo de lectura NUNCA puede impedir que el archivo se genere: el contenido de datos manda sobre la decoración. Un archivo sin logotipo sirve; un `500` no.
- **FR-069**: Los proyectos NO tienen logo propio: un export de un proyecto muestra el logo del cliente al que pertenece (la identidad visual es de la empresa, no del trabajo puntual).

**Costo del producto y su historial (US12)**

- **FR-070**: La descarga del catálogo (FR-053) DEBE incluir el costo actual de cada producto en la columna de valor unitario. Dejarla vacía ocultaba información que el usuario ya posee y que necesita para revisar su catálogo.
- **FR-071**: El usuario (Administrador/Gerente) DEBE poder actualizar el costo de un producto, tanto en la carga masiva como en la edición manual. Un cambio de costo altera la valorización del inventario y de los reportes, por lo que NUNCA puede ocurrir de forma anónima.
- **FR-072**: Todo cambio de costo DEBE quedar registrado de forma permanente e inmutable con: costo anterior, costo nuevo, usuario, fecha/hora y origen del cambio (carga masiva, edición manual o recepción de mercancía), y DEBE ser consultable desde la ficha del producto.
- **FR-073**: Un cambio de costo NO es un movimiento de inventario: no altera cantidades y no DEBE registrarse en el historial de movimientos, para no romper la correspondencia entre el stock y la suma de sus movimientos.
- **FR-074**: En la carga masiva, un costo se considera cambiado solo si difiere del actual; las filas cuyo valor unitario llega igual (o vacío) NO generan un registro de cambio de costo.

**Filtrado de listados (US13)**

- **FR-075**: Cada listado DEBE poder filtrarse por los campos con los que se consulta en la operación diaria, además de los que ya ofrece: **inventario** por categoría, ubicación, estado del producto y rango de cantidad disponible; **ingresos** por proveedor; **salidas** por número de salida y por usuario que autoriza; **clientes** por ciudad; **usuarios** por rol. Todos los filtros son opcionales y se combinan entre sí (Y lógico) y con la paginación ya existente.
- **FR-076**: Los filtros cuyo dominio de valores es texto libre capturado por el propio usuario (categoría y ubicación de producto, ciudad de cliente) DEBEN ofrecerse como selección de los valores que EXISTEN hoy en los datos, no como una caja de texto que el usuario deba adivinar ni como una lista fija escrita en el código. El filtro por rol (FR-054) se alimenta igual: del catálogo de roles vigente.
- **FR-077**: El rango de cantidad del inventario DEBE aplicarse sobre la cantidad **disponible** (stock − comprometido), nunca sobre el stock crudo — mismo criterio que la alerta de stock bajo (FR-022) y que el reporte de inventario actual (FR-041).
- **FR-078**: Cuando un listado tiene al menos un filtro activo, DEBE mostrarlos en pantalla con su valor legible y ofrecer una acción única para limpiarlos todos: el usuario nunca debe quedarse mirando pocos resultados sin saber por qué.
- **FR-079**: El estado vacío de un listado DEBE distinguir "no hay registros todavía" de "no hay registros que cumplan los filtros aplicados"; ambos textos en español.

**Datos personales del propio usuario (US14)**

- **FR-080**: Todo usuario autenticado DEBE poder consultar y editar sus propios datos personales —nombre completo y correo electrónico— sin necesidad de un permiso especial ni de intervención de un Administrador.
- **FR-081**: El usuario sobre el que se aplica el cambio DEBE resolverse SIEMPRE desde la sesión, nunca desde un dato enviado por el cliente: nadie puede editar a otro por esta vía (para eso existe la gestión de usuarios, que sí exige permiso).
- **FR-082**: Por esta vía NO se pueden modificar el nombre de usuario (identifica los registros históricos), el rol (definiría los propios permisos) ni el estado (nadie se da de baja a sí mismo); enviarlos no DEBE tener ningún efecto.
- **FR-083**: El correo DEBE seguir siendo único entre usuarios; un correo ya usado se rechaza señalando el campo, sin aplicar ningún cambio.

**User Story 15 - Catálogos parametrizables (categorías y proveedores)**

Las reglas FR-084…FR-090 están escritas para categorías; **FR-091 las extiende íntegras a
proveedores**, porque son el mismo problema (un dato de negocio que se escribía a mano en cada
documento) y merecen la misma solución, no dos comportamientos distintos que el usuario tenga
que recordar por separado.

- **FR-084**: Las categorías de producto DEBEN vivir en un catálogo propio, administrable (alta, edición, activación/desactivación); dejan de ser texto libre escrito en cada producto.
- **FR-085**: El nombre de una categoría DEBE ser único ignorando mayúsculas y espacios sobrantes, de modo que "Ferretería", "ferretería " y "FERRETERÍA" no puedan coexistir como categorías distintas. **Las tildes SÍ distinguen**: "Ferreteria" y "Ferretería" son, para el sistema, dos categorías diferentes. Ignorarlas exigiría la extensión `unaccent` de PostgreSQL y se dejó fuera a propósito; si el negocio lo pide, es un cambio de una línea en el índice funcional y en `normalizarNombreCategoria`.
- **FR-086**: La categoría de un producto DEBE seguir siendo OPCIONAL y elegirse del catálogo; un producto sin categoría es válido. Al clasificar solo DEBEN ofrecerse categorías activas; un producto ya clasificado con una categoría desactivada conserva su clasificación.
- **FR-087**: Una categoría en uso NO DEBE poder eliminarse: la baja es lógica (desactivación), para que los productos y el historial que la referencian no pierdan su clasificación (Principio II).
- **FR-088**: Los filtros por categoría (inventario y reportes) DEBEN alimentarse del catálogo, no de los valores presentes en los productos; y consultar o filtrar por categoría NO DEBE exigir permiso de gestión — verla es parte del trabajo diario, administrarla no.
- **FR-089**: La migración a catálogo NO DEBE perder la clasificación existente: cada valor de texto ya presente en los productos se convierte en una categoría del catálogo y los productos quedan apuntando a ella.
- **FR-090**: En la carga masiva desde Excel la categoría DEBE seguir escribiéndose por NOMBRE y resolverse contra el catálogo ignorando mayúsculas y espacios; una categoría inexistente invalida ESA fila, con un mensaje que la nombra, sin bloquear el resto del archivo (misma regla de proceso parcial de FR-051).
- **FR-091**: El proveedor de un ingreso DEBE vivir en su propio catálogo administrable con las MISMAS reglas que las categorías (FR-084…FR-088): unicidad ignorando mayúsculas y espacios, baja lógica cuando está en uso, y filtros alimentados del catálogo. A diferencia de la categoría, el proveedor es OBLIGATORIO en un ingreso: una factura sin saber a quién se le compró no es trazable.
- **FR-092**: La migración a catálogo de proveedores NO DEBE perder ningún dato: cada proveedor ya escrito en un ingreso se convierte en una fila del catálogo y el ingreso queda apuntando a ella (mismo criterio que FR-089).
- **FR-093**: El proveedor sintético que la carga masiva usa para su ingreso automático ("Carga masiva de inventario", FR-050) DEBE existir en el catálogo y NO DEBE poder eliminarse ni renombrarse, porque el proceso automático depende de él — misma protección que los roles del sistema (FR-059).

**Órdenes de compra (US16)**

- **FR-094**: Una orden de compra DEBE dirigirse a UN proveedor ACTIVO del catálogo (US15) y llevar al menos una línea con producto, cantidad y precio unitario estimado; su valor total se calcula a partir de las líneas, nunca se teclea.
- **FR-095**: Cada orden DEBE recibir un número correlativo único y consecutivo al crearse, con la misma garantía que el de las salidas (FR-026): asignado dentro de la transacción que la crea, sin duplicados bajo concurrencia y sin huecos por transacciones revertidas.
- **FR-096**: Una orden DEBE recorrer los estados BORRADOR → ENVIADA → RECIBIDA, y poder ANULARSE con motivo desde BORRADOR o ENVIADA. Solo es editable en BORRADOR: una vez enviada, el proveedor tiene un compromiso en la mano y cambiarlo en silencio sería falsear lo que se pidió. Una orden NO mueve stock en ningún estado.
- **FR-097**: Toda orden DEBE poder exportarse como documento completo en PDF y Excel —número, proveedor con sus datos de contacto, líneas, total y auditoría— porque ese documento ES lo que se le envía al proveedor (mismo alcance que FR-065 para ingresos y salidas).
- **FR-098**: Al elegir el proveedor, el sistema DEBE sugerir los productos BAJO UMBRAL que ese proveedor ya ha suministrado en ingresos anteriores, con una cantidad sugerida. La sugerencia es una ayuda editable, nunca una imposición: el usuario puede cambiar las cantidades, quitar líneas y agregar productos que el proveedor no le haya vendido antes.
- **FR-099**: Una orden ENVIADA DEBE poder convertirse en ingreso: el registro del ingreso parte precargado con el proveedor y las líneas de la orden, el ingreso queda VINCULADO a ella, y cuando ese ingreso se recibe (FR-017) la orden pasa a RECIBIDA sola. El vínculo es opcional en el otro sentido: un ingreso puede seguir registrándose sin orden previa.
- **FR-100**: Crear y editar borradores lo DEBEN poder hacer los tres roles —quien ve faltar la mercancía es quien arma el pedido—, pero ENVIAR y ANULAR una orden DEBEN quedar restringidos: son las dos acciones que comprometen o liberan un gasto frente a un tercero.

**Unidad de medida (US17)**

- **FR-101**: Las unidades de medida DEBEN vivir en un catálogo propio y administrable, con las MISMAS reglas que categorías y proveedores (FR-084…FR-088): unicidad ignorando mayúsculas y espacios, baja lógica cuando están en uso, y selectores alimentados del catálogo. Cada unidad tiene un NOMBRE ("Kilogramo") y una ABREVIATURA ("kg"), y ambos son únicos entre sí: dos unidades que se abrevien igual serían indistinguibles justo donde más importa, en una tabla de cantidades.
- **FR-102**: La unidad de un producto DEBE ser OBLIGATORIA al darlo de alta, por cualquier vía (formulario o carga masiva). Un producto nuevo sin unidad es una cantidad que nadie podrá interpretar después.
- **FR-103**: Los productos que existían ANTES de esta historia quedan sin unidad y el sistema DEBE seguir operando con ellos con normalidad —consultarlos, moverlos, exportarlos y actualizarlos por carga masiva—; lo que NO se admite es guardarlos tras editarlos EN SU FICHA sin completarla. La limpieza ocurre con el uso, de uno en uno y con criterio, no con una migración que invente datos ni exigiéndola a la carga masiva: eso convertiría cualquier corrección de precios a escala en una clasificación previa de todo el catálogo.
- **FR-104**: En la carga masiva la unidad DEBE escribirse por NOMBRE o por ABREVIATURA —quien llena un Excel escribe "kg", no "Kilogramo"— y resolverse contra el catálogo ignorando mayúsculas y espacios. Una unidad desconocida invalida ESA fila con un mensaje que la nombra, sin bloquear el resto del archivo (FR-051). Una celda vacía que ACTUALIZA un producto conserva su unidad actual, a diferencia de las demás columnas opcionales: dejarla en blanco no puede ser una forma de quitarle la unidad a un producto que ya la tenía (y si ese producto todavía no tiene ninguna, la fila se procesa igual y lo deja sin ella — FR-103). Una unidad INACTIVA escrita en la hoja invalida la fila igual que una desconocida: escribirla es asignarla.
- **FR-105**: La unidad DEBE mostrarse junto a las cantidades del producto (inventario y ficha) — es la razón de ser de la historia: que un "12" se lea como "12 kg".
- **FR-106**: El alta de un producto desde el catálogo DEBE aceptar existencias iniciales (proveedor, cantidad y valor unitario) y registrarlas como un INGRESO real con la misma trazabilidad que uno manual (usuario, fecha, documento, movimiento de entrada) — nunca como una escritura directa de stock. Los tres campos son opcionales en conjunto y obligatorios entre sí: sin cantidad no se genera nada; con cantidad, el proveedor y el valor unitario son exigibles.
- **FR-107**: El alta rápida invocada DESDE un ingreso NO DEBE pedir existencias iniciales: la cantidad y el precio los aporta la línea del ingreso que se está registrando, y pedirlos también en el alta duplicaría la entrada de stock.

- **FR-108**: La interfaz DEBE ofrecer modo CLARO y OSCURO alternables desde un control siempre visible. La elección DEBE recordarse en el navegador del usuario; mientras nadie elija, DEBE respetarse la preferencia del sistema operativo. Al cargar una página NO DEBE verse un destello del tema contrario. La paleta clara DEBE añadirse como una capa que redefine los tokens, sin editar el bloque vendorizado de Nocturne.
- **FR-109**: Cada línea de ingreso, orden de compra, salida y cotización DEBE llevar su propia TASA DE IVA, elegible entre las vigentes en Colombia (0%, 5% y 19%). Las líneas nuevas se proponen al 19% —la tasa general, y la que aplica a la mayoría de la mercancía— y las ya registradas conservan el 0% con el que se capturaron, para que ningún documento histórico cambie de valor.
- **FR-110**: El IVA DEBE calcularse LÍNEA A LÍNEA sobre su propia base (cantidad × precio unitario) y totalizarse en el documento, que DEBE exponer y mostrar tres cifras: base gravable, IVA y total. Aplicar una tasa única sobre el total del documento daría un número distinto en cuanto conviven dos tasas.
- **FR-111**: El IVA NO DEBE entrar en el costo del producto ni en la valorización del inventario: el costo que se registra al recibir un ingreso, el historial de costos y los reportes de valorización siguen siendo la BASE GRAVABLE. El IVA es un impuesto recuperable, no lo que vale la mercancía.
- **FR-112**: El sistema DEBE permitir registrar COTIZACIONES a un cliente y proyecto del catálogo, con número correlativo propio, fecha, fecha de validez, líneas de producto (cantidad, precio unitario y tasa de IVA) y estado BORRADOR/ENVIADA/ACEPTADA/RECHAZADA/ANULADA.
- **FR-113**: Una cotización NO DEBE mover inventario ni comprometer stock en ninguno de sus estados: es una oferta, no una entrega. El stock se compromete cuando la salida que nace de ella se confirma (FR-025).
- **FR-114**: Solo las cotizaciones en BORRADOR DEBEN ser editables. Una vez enviada, lo que se le mostró al cliente no se reescribe; para cambiarla se anula y se hace otra.
- **FR-115**: Al marcar una cotización como ACEPTADA, el sistema DEBE generar una SALIDA pendiente con las mismas líneas —producto, cantidad, precio e IVA— enlazada a la cotización que la originó, sin mover stock en ese momento. Es el espejo de la relación orden de compra → ingreso (FR-099).
- **FR-116**: Las cotizaciones DEBEN poder exportarse a PDF con el logo institucional y las tres cifras del documento, en el formato que se le envía al cliente.
- **FR-117**: Ver, crear y editar borradores de cotización DEBEN estar disponibles para los tres roles; enviarla, cerrarla (aceptar/rechazar) y anularla DEBEN quedar restringidos, porque comprometen un precio frente a un tercero o generan una salida.

- **FR-118**: Los buscadores de texto de los listados DEBEN partir lo escrito en TÉRMINOS y exigir que CADA término aparezca en ALGUNO de los campos buscables de la fila (Y entre términos, O entre campos). El orden de las palabras NO DEBE importar, y cada término añadido DEBE estrechar el resultado. Los campos buscables de cada listado DEBEN incluir aquello por lo que se pregunta de verdad un registro —descripción, ubicación y categoría de un producto; NIT y ciudad de un cliente; nombre del proyecto de una cotización—, no solo su identificador. En los documentos con correlativo, los DÍGITOS de un término DEBEN cruzarse con el número, de modo que `COT-000042`, `000042` y `42` lleguen al mismo documento.

**Auditoría y trazabilidad (transversal)**

- **FR-045**: Toda operación de creación, edición, cambio de estado o anulación DEBE registrar usuario y fecha/hora; los registros con relevancia de inventario DEBEN conservar además el documento asociado.
- **FR-046**: Todo movimiento de inventario DEBE quedar en un historial permanente e inmutable; las correcciones generan movimientos de ajuste, nunca borrado de historia.
- **FR-047**: Toda la interfaz, mensajes, validaciones y reportes DEBEN presentarse en español.

### Key Entities

- **Usuario**: persona que opera el sistema; nombre completo, email, login, rol (Administrador/Gerente/Operario), estado activo/inactivo, fecha de creación. Referenciado por todos los registros que crea o autoriza.
- **Producto**: artículo almacenable; SKU único, descripción, categoría (referencia OPCIONAL al catálogo de categorías, US15), ubicación en almacén, umbral de stock bajo, estado. Su stock se deriva de los movimientos.
- **Categoría**: clasificación de productos administrada como catálogo (US15); nombre único ignorando mayúsculas y espacios, descripción opcional, estado activa/inactiva. Nunca se elimina si está en uso: se desactiva, para no despojar de su clasificación a los productos que la referencian.
- **Proveedor**: empresa o persona a la que se compra la mercancía, administrada como catálogo (US15, FR-091); nombre único ignorando mayúsculas y espacios, datos de contacto opcionales (NIT, teléfono, email), estado activo/inactivo, y una marca de "del sistema" para el proveedor que usa la carga masiva (FR-093). Referenciado de forma OBLIGATORIA por cada ingreso.
- **Unidad de medida**: en qué se mide un producto (US17, FR-101); nombre y abreviatura únicos ignorando mayúsculas y espacios, estado activa/inactiva. Referenciada de forma OBLIGATORIA por todo producto creado desde US17, y OPCIONAL en los anteriores (FR-103).
- **Orden de compra**: pedido formal de mercancía a un proveedor (US16, FR-094); número correlativo propio, proveedor obligatorio, fecha, líneas con producto/cantidad/precio estimado, valor total calculado, estado (borrador, enviada, recibida, anulada) y motivo de anulación. NO mueve inventario: es un compromiso de compra, y el stock solo se mueve cuando el ingreso correspondiente se recibe.
- **Cotización**: oferta formal de mercancía a un cliente (US21, FR-112); número correlativo propio, cliente y proyecto obligatorios, fecha y fecha de validez, líneas con producto/cantidad/precio/tasa de IVA, las tres cifras del documento (base, IVA y total) y estado (borrador, enviada, aceptada, rechazada, anulada). NO mueve inventario: al aceptarse genera una salida pendiente enlazada, y el stock se compromete cuando esa salida se confirma.
- **Cliente**: empresa o persona a la que se destinan salidas; nombre, NIT único, contacto (teléfono, email), dirección, ciudad, estado, fecha de registro. Tiene uno o más proyectos.
- **Proyecto**: trabajo específico de un cliente; nombre, descripción, fechas de inicio y cierre estimada, responsable, presupuesto estimado, estado (Activo/Completado/Suspendido). Destino obligatorio de las salidas.
- **Ingreso (factura)**: documento de entrada de mercancía; número de factura único, proveedor (texto), fechas de factura y recepción, observaciones, estado (Pendiente/Recibido/Verificado), usuario que registra, valor total. Compuesto por líneas de detalle.
- **Detalle de ingreso**: línea de un ingreso; producto, cantidad, precio unitario, valor total de la línea.
- **Salida**: documento de egreso de mercancía; número auto-correlativo, fecha, cliente y proyecto de destino (obligatorios), observaciones, estado (Pendiente/Confirmada/Completada, más Anulada como resultado de anulación), usuario que autoriza, valor total. Compuesta por líneas de detalle.
- **Detalle de salida**: línea de una salida; producto, cantidad, precio unitario de referencia, valor total de la línea.
- **Movimiento de inventario**: registro inmutable de cada afectación de stock; fecha/hora, tipo (entrada/salida/ajuste), producto, cantidad con signo, documento asociado, usuario, cliente/proyecto cuando aplica.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las salidas confirmadas quedan vinculadas a un cliente y proyecto; no existe forma de registrar consumo "sin destino".
- **SC-002**: En pruebas con operaciones simultáneas sobre el mismo producto, el stock nunca queda negativo y el sistema rechaza el 100% de las salidas que exceden la disponibilidad.
- **SC-003**: Un gerente responde "¿cuánto material consumió el cliente X en cada uno de sus proyectos?" en menos de 1 minuto desde que abre el módulo de reportes (seleccionar filtros + generar + leer totales).
- **SC-004**: Un operario registra un ingreso típico (factura con 10 productos) en menos de 5 minutos, y una salida típica (5 productos) en menos de 3 minutos.
- **SC-005**: Tras confirmar una entrada o salida, cualquier consulta de inventario refleja el stock actualizado de inmediato (sin pasos manuales de sincronización).
- **SC-006**: El 100% de los movimientos de inventario consultables muestran usuario, fecha/hora y documento asociado.
- **SC-007**: Los 4 reportes se exportan a PDF y Excel conservando los filtros aplicados, y un archivo exportado con datos conocidos cuadra al 100% con los totales en pantalla.
- **SC-008**: Con 20 usuarios trabajando a la vez, los listados y reportes habituales cargan en menos de 2 segundos y ninguna operación de stock produce datos inconsistentes.
- **SC-009**: Un usuario nuevo (Operario) completa su primera salida sin ayuda externa en el primer intento en al menos 9 de cada 10 casos de prueba de usabilidad.
- **SC-010**: Los productos bajo umbral de stock aparecen destacados en el inventario y en el reporte de inventario actual el mismo día en que caen bajo el umbral.
- **SC-011**: Con un archivo de carga masiva de N filas válidas y M filas inválidas a propósito, el sistema crea/actualiza exactamente las N filas válidas (ni una de más ni de menos) y reporta las M filas inválidas con su error específico, sin duplicar productos ya existentes.
- **SC-012**: Un Administrador crea un rol nuevo con un subconjunto de permisos y se lo asigna a un usuario en menos de 2 minutos, sin tocar código ni reiniciar el sistema; ese usuario puede ejecutar el 100% de las acciones concedidas y la API rechaza con 403 el 100% de las no concedidas.
- **SC-013**: Tras migrar el control de acceso a permisos, los tres roles iniciales conservan exactamente sus capacidades previas: la suite completa de pruebas de autorización (401/403 por endpoint y por rol) pasa sin modificar una sola aserción de permisos existente.
- **SC-014**: Al iniciar sesión, el usuario identifica en menos de 10 segundos y sin navegar a otra pantalla si hay algo pendiente de su atención (stock bajo, documentos por confirmar o recibir); el 100% de las cifras del panel coincide exactamente con las de su pantalla de detalle.
- **SC-015**: El 100% de los listados y documentos operativos del sistema (ingresos, salidas y los 4 reportes) se exporta a PDF y Excel conservando filtros y cuadrando con la pantalla; un documento de un cliente con logo cargado sale listo para enviárselo a ese cliente sin edición posterior.
- **SC-016**: El 100% de los cambios de costo de producto —vengan de carga masiva, edición manual o recepción de mercancía— queda registrado con costo anterior, costo nuevo, usuario y fecha, y es consultable desde la ficha del producto; el stock de un producto sigue siendo exactamente igual a la suma de sus movimientos después de cualquier cambio de costo.
- **SC-017**: Cada uno de los 5 listados (inventario, ingresos, salidas, clientes, usuarios) se acota por cualquiera de sus campos filtrables sin recorrer páginas a mano: un filtro devuelve EXACTAMENTE el conjunto esperado (verificado con datos conocidos contra la base real), los filtros activos son visibles y se limpian en un solo paso, y ningún filtro nuevo degrada el tiempo de respuesta por debajo del umbral de SC-008.
- **SC-018**: Un usuario corrige su propio nombre y correo desde su perfil sin intervención de un Administrador, el cambio se refleja de inmediato en la aplicación sin volver a iniciar sesión, y por esa misma vía le resulta imposible alterar su rol, su estado o su nombre de usuario.

## Assumptions

- **Alcance v1**: aplicación web multiusuario para un solo almacén/bodega; la "ubicación" es un texto descriptivo por producto. Multi-almacén, códigos de barras, órdenes de compra, facturación a clientes, devoluciones de clientes, notificaciones por email y app móvil quedan fuera de alcance.
- **Escala esperada**: hasta ~50 usuarios registrados (≤20 concurrentes), miles de productos y decenas de miles de movimientos por año.
- **Moneda y localización**: valores en pesos colombianos (COP) sin manejo de impuestos ni multi-moneda en v1; zona horaria America/Bogota; interfaz 100% en español.
- **Semántica de estados (ingreso)**: Pendiente = borrador editable sin efecto en stock; Recibido = mercancía física recibida, suma stock; Verificado = conteo revisado, inmutable.
- **Semántica de estados (salida)**: Pendiente = borrador que compromete disponibilidad (stock físico intacto); Confirmada = stock descontado, inmutable salvo anulación por Gerente/Administrador; Completada = entrega física cerrada. "Cantidad comprometida" = suma de líneas de salidas Pendientes.
- **Cantidades**: se permiten decimales (hasta 2) para materiales medidos en unidades continuas; la unidad de medida va implícita en la descripción del producto.
- **Proveedores**: campo de texto libre en el ingreso; no hay catálogo de proveedores en v1.
- **Usuarios iniciales**: el sistema arranca con un usuario Administrador semilla; el restablecimiento de contraseñas lo hace el Administrador (sin flujo de recuperación por email en v1).
- **Precios**: el precio unitario en salidas es de referencia (último costo registrado del producto, editable al capturar); la valoración de consumo usa ese precio de referencia.
- **Gráficos**: el reporte de consumo por proyecto incluye al menos un gráfico de consumo (por producto o en el tiempo); los demás reportes no requieren gráficos en v1.
- **Carga masiva (US8)**: un archivo por corrida, máximo 2.000 filas de datos y 5 MB — coherente con la escala esperada (miles de productos, no cientos de miles) sin necesidad de una cola de procesamiento en background; sin catálogo propio de categorías en v1 (texto libre, igual que "ubicación").
