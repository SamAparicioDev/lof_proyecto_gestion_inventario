# Backlog — ideas registradas, todavía NO especificadas

Cosas que sabemos que faltan y que **no** están especificadas ni implementadas. No son historias:
no tienen US, ni FR, ni tareas. Están aquí para que la próxima vez no haya que redescubrirlas ni
reconstruir de memoria por qué importaban.

Cuando una de estas se decide hacer, se convierte en historia con `/speckit-specify` y se borra de
aquí — este archivo solo contiene lo que sigue pendiente.

> No confundir con [`borradores/`](./borradores/LEEME.md), que guarda SQL ya revisado y a punto de
> aplicarse. Aquí no hay nada escrito todavía.

---

## Devoluciones de cliente

**Estado**: anotada el 2026-08-21. Decisión del dueño del proyecto: **no se implementa aún.**

### El problema

Cuando un cliente devuelve material, el sistema no tiene forma de registrarlo como lo que es. El
material vuelve a la bodega por la única puerta que existe hoy —un **ajuste de entrada** (US29,
FR-126) o una **corrección de cantidad** (US31, FR-130)—, y ambas mienten sobre el origen: dicen
que apareció mercancía, no que un cliente devolvió lo que no usó.

No es una sospecha. El equipo ya se topó con el caso y dejó el rastro en dos sitios:

- `frontend/src/componentes/inventario/dialogo-corregir-cantidad.tsx` sugiere el motivo en su
  texto de ejemplo: *"Conteo físico de agosto, mercancía averiada, devolución del cliente…"*
- `backend/src/dominio/entidades/ingreso.ts` enumera "una devolución" entre las razones de un
  ajuste de entrada.

Y la spec ya lo declaró fuera de alcance de v1 (§ Assumptions, "Alcance v1").

### Por qué importa más de lo que parece

El consumo NO se calcula sobre los movimientos: se calcula **sumando las líneas de las salidas en
estado CONFIRMADA/COMPLETADA** (`RepositorioSalidas.listarParaConsumo`, FR-044; ver
`aplicacion/reportes/reporte-consumo-cliente.caso-uso.ts`). Un ajuste de entrada devuelve el stock
a la bodega pero **no resta absolutamente nada del consumo del cliente ni del proyecto**.

La consecuencia, con números:

> El reporte dice que el proyecto consumió 100 sacos de cemento. Devolvieron 30. El inventario
> queda correcto —los 30 sacos están físicamente ahí y el sistema los cuenta—, pero el reporte
> sigue diciendo 100, el valor consumido sigue inflado y el margen contra presupuesto de ese
> proyecto se ve peor de lo que realmente fue.

Eso no es una función que falta: es **la cifra principal del producto saliendo mal**. Todo Trazo
existe para responder "¿cuánto se llevó este cliente y cuánto costó" (SC-001, SC-003), y ese es
justamente el número que el atajo corrompe. Y lo corrompe **en silencio**: nadie ve un error, ve
una cifra plausible.

### Lo que habría que resolver al especificarla

- **Una devolución es una salida que vuelve**, así que debería nacer ENLAZADA a la salida original
  y heredar de ella cliente, proyecto y precio de referencia. Sin ese enlace no se sabe de qué
  consumo hay que restar.
- **¿Se puede devolver más de lo que se entregó?** No debería, y esa es una regla de negocio con
  su propio invariante, del mismo tipo que "el stock nunca es negativo".
- **El movimiento tiene que decir la verdad**: un tipo propio (o al menos un `documento_tipo`
  propio), nunca `AJUSTE_ENTRADA`, para que el reporte de movimientos distinga una devolución de
  una aparición de mercancía.
- **¿A qué costo vuelve a entrar?** Interactúa con FR-138 (el costo es SIEMPRE el último
  registrado): una devolución probablemente NO debe cambiar el costo del producto, porque no es
  una compra. Conviene decirlo explícitamente o alguien lo asumirá al revés.
- **Efecto en los reportes**: consumo por cliente y por proyecto tienen que restar lo devuelto, y
  el reporte debería poder mostrar entregado / devuelto / neto en vez de solo el neto — si solo se
  ve el neto, una devolución grande parece un error de captura.
- **¿Se puede devolver de una salida ya COMPLETADA?** Sí, casi seguro: la devolución ocurre
  justamente después de que la entrega se cerró.

### Lo que no sabemos

Con qué frecuencia ocurre en LOF. La inferencia de que ocurre viene del código, no de la
operación. Si en la práctica casi no se devuelve material, esto baja de prioridad —aunque el hueco
en las cifras sigue existiendo cuando pasa.
