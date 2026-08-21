/**
 * Pruebas del ASISTENTE DE CONSULTAS (T256, US33 — FR-133/FR-134/FR-135/FR-136).
 *
 * Van aquí y no en integración porque lo que se verifica no necesita base de datos: son las tres
 * garantías del asistente, y las tres se pueden atacar con un modelo falso que pida exactamente lo
 * que uno quiera que pida — algo imposible con el modelo real, que decide por su cuenta.
 *
 * 1. **Solo lectura** (FR-133): se comprueba sobre el REGISTRO de herramientas, no sobre una
 *    respuesta concreta. Es la única forma de que la prueba siga valiendo cuando alguien añada una
 *    herramienta dentro de un año.
 * 2. **Los permisos son los de quien pregunta** (FR-134): un Operario pide consumo y la
 *    herramienta ni se ejecuta.
 * 3. **Sin servicio no hay 500** (FR-136).
 */
import { ConsultarAsistenteCasoUso } from '../../src/aplicacion/asistente/consultar-asistente.caso-uso';
import { construirHerramientasConsulta, type DependenciasHerramientas } from '../../src/aplicacion/asistente/herramientas-consulta';
import {
  FalloDelProveedor,
  type CausaFalloProveedor,
  type EntradaPasoConversacion,
  type ModeloConversacional,
  type PasoConversacion,
} from '../../src/aplicacion/asistente/puertos/modelo-conversacional';
import type { Usuario } from '../../src/dominio/entidades/usuario';

/** Usuario de prueba con los permisos que se le pasen. */
function usuarioCon(permisos: string[]): Usuario {
  return {
    id: 1,
    nombreCompleto: 'Usuaria de Prueba',
    email: 'prueba@lof.local',
    login: 'usuaria',
    rolAsignado: {
      id: 3,
      nombre: 'Operario',
      descripcion: null,
      esSistema: true,
      esSuperAdmin: false,
      estado: 'ACTIVO',
      permisos,
    },
    estado: 'ACTIVO',
    debeCambiarPassword: false,
  };
}

/** Dependencias que registran si se las llamó — así se ve si una herramienta se ejecutó o no. */
function dependenciasEspia() {
  const llamadas: string[] = [];
  const registrar = (nombre: string) => async (): Promise<unknown> => {
    llamadas.push(nombre);
    return { ok: true };
  };
  const dependencias: DependenciasHerramientas = {
    listarInventario: { ejecutar: registrar('listarInventario') },
    historialProducto: { ejecutar: registrar('historialProducto') },
    consumoCliente: { ejecutar: registrar('consumoCliente') },
    resumenPanel: { ejecutar: registrar('resumenPanel') },
    repositorioClientes: { listar: registrar('repositorioClientes') },
    inventarioValorizado: {
      ejecutar: async () => {
        llamadas.push('inventarioValorizado');
        return { productos: [], valorTotalInventario: 0 };
      },
    },
    repositorioUsuarios: { listar: registrar('repositorioUsuarios') },
  };
  return { dependencias, llamadas };
}

/**
 * Modelo falso: devuelve los pasos que se le indiquen, en orden. Permite montar exactamente el
 * escenario a probar (pedir una herramienta concreta, luego responder) sin depender de lo que un
 * modelo real decida hacer ese día.
 */
function modeloQueDevuelve(pasos: PasoConversacion[]): ModeloConversacional & { entradas: EntradaPasoConversacion[] } {
  const entradas: EntradaPasoConversacion[] = [];
  let siguiente = 0;
  return {
    entradas,
    disponible: () => true,
    responder: async (entrada) => {
      entradas.push(entrada);
      return pasos[siguiente++] ?? { texto: 'Sin más pasos.', llamadas: [], turnoCrudo: [] };
    },
  };
}

const SIN_LLAMADAS = { llamadas: [], turnoCrudo: [] } as const;

describe('Asistente de consultas (US33)', () => {
  describe('solo lectura por construcción (FR-133)', () => {
    it('ninguna herramienta del registro escribe: el catálogo entero es de consulta', () => {
      const { dependencias } = dependenciasEspia();
      const herramientas = construirHerramientasConsulta(dependencias);

      // La comprobación es sobre los NOMBRES y no sobre lo que hacen, a propósito: si alguien
      // añadiera "registrar_salida" o "corregir_cantidad" al registro, esta prueba lo detiene
      // aunque su implementación todavía no escribiera nada. El día que el asistente deba escribir
      // será una decisión discutida en una revisión, no un descuido que nadie note.
      const verbosDeEscritura = ['crear', 'registrar', 'confirmar', 'anular', 'corregir', 'eliminar', 'actualizar', 'cambiar'];
      for (const herramienta of herramientas) {
        for (const verbo of verbosDeEscritura) {
          expect(`${herramienta.nombre} no debería empezar por "${verbo}"`).not.toContain(`${verbo}_`);
          expect(herramienta.nombre.startsWith(verbo)).toBe(false);
        }
      }
      expect(herramientas.length).toBeGreaterThan(0);
    });

    it('cada herramienta declara el permiso que exige, o declara explícitamente que no exige ninguno', () => {
      const { dependencias } = dependenciasEspia();
      for (const herramienta of construirHerramientasConsulta(dependencias)) {
        // `null` es una declaración, no un olvido: `undefined` fallaría aquí.
        expect(['string', 'object']).toContain(typeof herramienta.permiso);
        expect(herramienta.permiso === null || typeof herramienta.permiso === 'string').toBe(true);
      }
    });
  });

  describe('lo que el modelo necesita para no tantear (FR-135)', () => {
    /** Ejecuta una herramienta por su nombre con permisos suficientes. */
    async function ejecutar(
      nombre: string,
      dependencias: DependenciasHerramientas,
      argumentos: Record<string, unknown> = {},
    ): Promise<Record<string, unknown>> {
      const herramienta = construirHerramientasConsulta(dependencias).find((h) => h.nombre === nombre);
      if (!herramienta) throw new Error(`No existe la herramienta ${nombre}`);
      return (await herramienta.ejecutar(argumentos, usuarioCon([]))) as Record<string, unknown>;
    }

    it('un listado recortado lo DICE, con el total y la instrucción de no presentarlo como todo', async () => {
      const { dependencias } = dependenciasEspia();
      // 300 productos cumplen el filtro; la herramienta devuelve una página.
      dependencias.listarInventario.ejecutar = async () => ({ datos: [{ sku: 'A' }, { sku: 'B' }], total: 300 });

      const resultado = await ejecutar('consultar_inventario', dependencias);

      expect(resultado.totalQueCumplenElFiltro).toBe(300);
      expect(resultado.devueltas).toBe(2);
      // Este aviso es la diferencia entre una respuesta honesta y seis búsquedas al azar: sin él,
      // el modelo no tiene forma de saber que le falta información (caso real de Samuel,
      // "¿cuál es el producto que vale más?", 2026-08-21).
      expect(String(resultado.aviso)).toContain('RECORTE');
      expect(String(resultado.aviso)).toContain('300');
    });

    it('un listado COMPLETO no lleva aviso: avisar siempre lo volvería ruido que se ignora', async () => {
      const { dependencias } = dependenciasEspia();
      dependencias.listarInventario.ejecutar = async () => ({ datos: [{ sku: 'A' }], total: 1 });

      const resultado = await ejecutar('consultar_inventario', dependencias);

      expect(resultado.aviso).toBeUndefined();
      expect(resultado.totalQueCumplenElFiltro).toBe(1);
    });

    it('"¿qué producto vale más?" se responde con UNA consulta, ordenada sobre todo el catálogo', async () => {
      const { dependencias } = dependenciasEspia();
      dependencias.inventarioValorizado.ejecutar = async () => ({
        productos: [
          { producto: { sku: 'BARATO', descripcion: 'Tornillo' }, valorLinea: 1_000, stock: 100 },
          { producto: { sku: 'CARO', descripcion: 'Compresor' }, valorLinea: 9_000_000, stock: 3 },
          { producto: { sku: 'MEDIO', descripcion: 'Válvula' }, valorLinea: 250_000, stock: 10 },
        ],
        valorTotalInventario: 9_251_000,
      });

      const resultado = await ejecutar('productos_por_valor', dependencias, { cuantos: 2 });

      const masValiosos = resultado.masValiosos as { producto: { sku: string } }[];
      expect(masValiosos.map((fila) => fila.producto.sku)).toEqual(['CARO', 'MEDIO']);
      expect(resultado.valorTotalInventario).toBe(9_251_000);
      // Que el orden abarca TODO el catálogo se dice explícitamente: es lo que convierte "el
      // primero de la lista" en "el que más vale" sin que el modelo tenga que suponerlo.
      expect(resultado.productosEvaluados).toBe(3);
      expect(String(resultado.criterio)).toContain('TODO');
    });
  });

  describe('los permisos son los de quien pregunta (FR-134)', () => {
    it('un Operario sin `reportes.ver` no obtiene el consumo: la herramienta NO se ejecuta', async () => {
      const { dependencias, llamadas } = dependenciasEspia();
      const modelo = modeloQueDevuelve([
        {
          texto: '',
          llamadas: [{ id: 'llamada-1', nombre: 'consumo_de_cliente', argumentos: { clienteId: 7 } }],
          turnoCrudo: [],
        },
        { texto: 'Esa información no está disponible para tu rol.', ...SIN_LLAMADAS },
      ]);
      const casoUso = new ConsultarAsistenteCasoUso(modelo, dependencias);

      const resultado = await casoUso.ejecutar({
        pregunta: '¿Cuánto consumió el cliente 7?',
        historial: [],
        usuario: usuarioCon(['inventario.ver']),
      });

      // Lo que importa: el caso de uso NO llegó a consultar el reporte.
      expect(llamadas).not.toContain('consumoCliente');
      expect(resultado.fuentes).toEqual([
        { herramienta: 'consumo_de_cliente', argumentos: { clienteId: 7 }, permitida: false },
      ]);
      // Y el modelo se enteró, para poder decirlo en vez de inventarse la cifra.
      const resultadoDevuelto = modelo.entradas[1]?.intercambio.at(-1) as { contenido: string }[];
      expect(resultadoDevuelto[0]?.contenido).toContain('Sin permiso');
    });

    it('con el permiso, la misma herramienta sí se ejecuta y queda citada como fuente (FR-135)', async () => {
      const { dependencias, llamadas } = dependenciasEspia();
      const modelo = modeloQueDevuelve([
        {
          texto: '',
          llamadas: [{ id: 'llamada-1', nombre: 'consumo_de_cliente', argumentos: { clienteId: 7 } }],
          turnoCrudo: [],
        },
        { texto: 'Consumió $1.000.000 este mes.', ...SIN_LLAMADAS },
      ]);
      const casoUso = new ConsultarAsistenteCasoUso(modelo, dependencias);

      const resultado = await casoUso.ejecutar({
        pregunta: '¿Cuánto consumió el cliente 7?',
        historial: [],
        usuario: usuarioCon(['reportes.ver']),
      });

      expect(llamadas).toContain('consumoCliente');
      expect(resultado.fuentes[0]).toMatchObject({ herramienta: 'consumo_de_cliente', permitida: true });
      expect(resultado.disponible).toBe(true);
    });

    it('una herramienta inventada por el modelo no rompe nada: vuelve como error y se sigue', async () => {
      const { dependencias, llamadas } = dependenciasEspia();
      const modelo = modeloQueDevuelve([
        { texto: '', llamadas: [{ id: 'x', nombre: 'borrar_todo', argumentos: {} }], turnoCrudo: [] },
        { texto: 'No puedo hacer eso.', ...SIN_LLAMADAS },
      ]);
      const casoUso = new ConsultarAsistenteCasoUso(modelo, dependencias);

      const resultado = await casoUso.ejecutar({
        pregunta: 'Borra el inventario',
        historial: [],
        usuario: usuarioCon(['inventario.ver']),
      });

      expect(llamadas).toHaveLength(0);
      expect(resultado.respuesta).toBe('No puedo hacer eso.');
    });
  });

  describe('degradación elegante (FR-136)', () => {
    it('sin servicio configurado responde un aviso, no un error', async () => {
      const { dependencias } = dependenciasEspia();
      const apagado: ModeloConversacional = {
        disponible: () => false,
        responder: async () => {
          throw new Error('no debería llamarse');
        },
      };
      const resultado = await new ConsultarAsistenteCasoUso(apagado, dependencias).ejecutar({
        pregunta: '¿Cuánto hay de cemento?',
        historial: [],
        usuario: usuarioCon(['inventario.ver']),
      });

      expect(resultado.disponible).toBe(false);
      expect(resultado.respuesta).toContain('no está disponible');
      // Señala dónde SÍ está el dato: un aviso que solo dice "no puedo" deja a la persona parada.
      expect(resultado.respuesta).toContain('Inventario');
    });

    it.each<[CausaFalloProveedor, string]>([
      ['credencial', 'rechazó la clave'],
      ['cuota', 'Se agotó'],
      ['saturado', 'saturado'],
      ['desconocido', 'falló'],
    ])('el aviso de la causa "%s" dice qué pasó, no solo que falló', async (causa, esperado) => {
      const { dependencias } = dependenciasEspia();
      const queFalla: ModeloConversacional = {
        disponible: () => true,
        responder: async () => {
          throw new FalloDelProveedor(causa, 'detalle técnico que no debe salir');
        },
      };

      const resultado = await new ConsultarAsistenteCasoUso(queFalla, dependencias).ejecutar({
        pregunta: '¿Cuánto hay de cemento?',
        historial: [],
        usuario: usuarioCon(['inventario.ver']),
      });

      expect(resultado.disponible).toBe(false);
      expect(resultado.respuesta).toContain(esperado);
      // El detalle técnico se queda en el log en todos los casos.
      expect(resultado.respuesta).not.toContain('detalle técnico');

      // El de credencial es el que más importa: reintentar NO lo arregla, y el mensaje tiene que
      // decirlo o la persona se pasa el día insistiendo mientras nadie revisa la clave.
      if (causa === 'credencial') {
        expect(resultado.respuesta).toContain('NO se arregla reintentando');
      }
    });

    it('si el proveedor falla a mitad, tampoco propaga la excepción', async () => {
      const { dependencias } = dependenciasEspia();
      const queFalla: ModeloConversacional = {
        disponible: () => true,
        responder: async () => {
          throw new Error('429 rate limit');
        },
      };
      const resultado = await new ConsultarAsistenteCasoUso(queFalla, dependencias).ejecutar({
        pregunta: '¿Cuánto hay de cemento?',
        historial: [],
        usuario: usuarioCon(['inventario.ver']),
      });

      expect(resultado.disponible).toBe(false);
      // El detalle técnico del proveedor no llega al usuario: no le dice nada y puede exponer
      // configuración. Al log sí va entero.
      expect(resultado.respuesta).not.toContain('429');
    });
  });
});
