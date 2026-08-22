/**
 * Pruebas del BUZÓN DE SOLICITUDES (T282, US36 — FR-151…FR-155).
 *
 * Van aquí y no en integración porque nada de lo que verifican necesita base de datos: son las
 * cuatro garantías del refinado, y las cuatro se atacan con un modelo falso que responde
 * exactamente lo que uno quiera —incluido texto vacío o un fallo de cuota—, algo imposible con el
 * modelo real, que decide por su cuenta.
 *
 * 1. **El texto del autor nunca se sobrescribe** (FR-152): el repositorio falso registra POR QUÉ
 *    método se escribió, así que la prueba falla si alguien un día hace que refinar toque la
 *    descripción.
 * 2. **La plantilla obliga a declarar los huecos** (FR-151): se comprueba sobre las
 *    INSTRUCCIONES, no sobre una respuesta concreta — es lo único que sigue valiendo cuando
 *    alguien reescriba el prompt dentro de un año.
 * 3. **Sin servicio no hay excepción** (FR-155): ni sin clave, ni con el proveedor caído.
 * 4. **Solo se refina lo pendiente**: refinar algo ya cerrado no gasta una llamada al modelo.
 */
import {
  admiteRefinado,
  estaPendiente,
  type EstadoSolicitudFuncionalidad,
  type SolicitudFuncionalidad,
} from '../../src/dominio/entidades/solicitud-funcionalidad';
import { INSTRUCCIONES_REFINADO, contextoDelPedido } from '../../src/aplicacion/solicitudes/instrucciones-refinado';
import { RefinarSolicitudCasoUso } from '../../src/aplicacion/solicitudes/refinar-solicitud.caso-uso';
import {
  FalloDelProveedor,
  type CausaFalloProveedor,
  type EntradaPasoConversacion,
  type ModeloConversacional,
  type PasoConversacion,
} from '../../src/aplicacion/asistente/puertos/modelo-conversacional';
import type {
  FiltrosSolicitudesFuncionalidad,
  PaginaSolicitudesFuncionalidad,
  RepositorioSolicitudes,
} from '../../src/dominio/puertos/repositorio-solicitudes';

const AUTOR = { id: 1, nombreCompleto: 'Samuel Aparicio' };

function solicitudCon(estado: EstadoSolicitudFuncionalidad): SolicitudFuncionalidad {
  return {
    id: 7,
    titulo: 'Filtrar el consumo por proveedor',
    descripcion: 'Quiero ver solo lo que vino de un proveedor cuando reviso el consumo de un cliente.',
    promptRefinado: null,
    refinadoEn: null,
    estado,
    creadaPor: AUTOR,
    creadaEn: new Date('2026-08-21T10:00:00.000Z'),
    estadoCambiadoPor: null,
    estadoCambiadoEn: null,
  };
}

/**
 * Repositorio falso que anota QUÉ método se llamó. La lista de escrituras es la prueba de
 * FR-152: si aparece `actualizar` durante un refinado, alguien tocó el texto del autor.
 */
function repositorioEspia(inicial: SolicitudFuncionalidad) {
  const escrituras: string[] = [];
  let actual = inicial;
  const repositorio: RepositorioSolicitudes = {
    async crear() {
      escrituras.push('crear');
      return actual;
    },
    async buscarPorId(id: number) {
      return id === actual.id ? actual : null;
    },
    async listar(_filtros: FiltrosSolicitudesFuncionalidad): Promise<PaginaSolicitudesFuncionalidad> {
      return { datos: [actual], total: 1, pendientes: estaPendiente(actual) ? 1 : 0 };
    },
    async actualizar(_id, datos) {
      escrituras.push('actualizar');
      actual = { ...actual, ...datos };
      return actual;
    },
    async guardarRefinado(_id, prompt, generadoEn) {
      escrituras.push('guardarRefinado');
      actual = { ...actual, promptRefinado: prompt, refinadoEn: generadoEn };
      return actual;
    },
    async cambiarEstado(_id, estado) {
      escrituras.push('cambiarEstado');
      actual = { ...actual, estado };
      return actual;
    },
  };
  return { repositorio, escrituras, leer: () => actual };
}

/** Modelo falso: responde el texto que se le pase, o lanza la causa que se le pida. */
function modeloQueResponde(texto: string, disponible = true): ModeloConversacional {
  return {
    disponible: () => disponible,
    responder: async (_entrada: EntradaPasoConversacion): Promise<PasoConversacion> => ({
      texto,
      llamadas: [],
      turnoCrudo: null,
    }),
  };
}

function modeloQueFalla(causa: CausaFalloProveedor): ModeloConversacional {
  return {
    disponible: () => true,
    responder: async (): Promise<PasoConversacion> => {
      throw new FalloDelProveedor(causa, 'detalle técnico que NO debe llegar al usuario');
    },
  };
}

describe('Buzón de solicitudes — reglas de la entidad (US36, FR-154)', () => {
  it('solo lo PENDIENTE cuenta como trabajo esperando', () => {
    expect(estaPendiente(solicitudCon('PENDIENTE'))).toBe(true);
    expect(estaPendiente(solicitudCon('COMPLETADA'))).toBe(false);
    expect(estaPendiente(solicitudCon('DESCARTADA'))).toBe(false);
  });

  it('solo lo PENDIENTE admite refinado — refinar lo cerrado no tiene destinatario', () => {
    expect(admiteRefinado(solicitudCon('PENDIENTE'))).toBe(true);
    expect(admiteRefinado(solicitudCon('COMPLETADA'))).toBe(false);
    expect(admiteRefinado(solicitudCon('DESCARTADA'))).toBe(false);
  });
});

describe('Plantilla del refinado — US36, FR-151', () => {
  it('exige las cinco secciones, y la de huecos como OBLIGATORIA', () => {
    for (const seccion of [
      '## Qué se pide',
      '## Para quién y por qué',
      '## Qué pasa hoy sin esto',
      '## Criterios de aceptación',
      '## Lo que quedó sin definir',
    ]) {
      expect(INSTRUCCIONES_REFINADO).toContain(seccion);
    }
    // La sección de huecos es la única defensa contra el modo de fallo caro de un modelo rápido:
    // un prompt que suena completo y no lo está. Si alguien la vuelve opcional, esto falla.
    expect(INSTRUCCIONES_REFINADO).toContain('OBLIGATORIA y NUNCA puede ir vacía');
  });

  it('le prohíbe inventar requisitos y proponer arquitectura', () => {
    expect(INSTRUCCIONES_REFINADO).toContain('No inventes requisitos');
    expect(INSTRUCCIONES_REFINADO).toContain('No hables de código');
  });

  it('el pedido concreto va FUERA de las instrucciones, para no invalidar la caché de prefijo', () => {
    const contexto = contextoDelPedido('Un título', 'Una descripción cualquiera');
    expect(contexto).toContain('Un título');
    expect(contexto).toContain('Una descripción cualquiera');
    expect(INSTRUCCIONES_REFINADO).not.toContain('Un título');
  });
});

describe('RefinarSolicitudCasoUso — US36, FR-152/FR-153/FR-155', () => {
  it('guarda el prompt SIN tocar la descripción del autor (FR-152)', async () => {
    const espia = repositorioEspia(solicitudCon('PENDIENTE'));
    const descripcionOriginal = espia.leer().descripcion;
    const caso = new RefinarSolicitudCasoUso(espia.repositorio, modeloQueResponde('## Qué se pide\nUn filtro.'));

    const resultado = await caso.ejecutar({ id: 7 });

    expect(resultado.disponible).toBe(true);
    expect(resultado.prompt).toContain('Un filtro.');
    expect(espia.escrituras).toEqual(['guardarRefinado']);
    expect(espia.leer().descripcion).toBe(descripcionOriginal);
  });

  it('sin el servicio configurado responde con aviso, no con excepción (FR-155)', async () => {
    const espia = repositorioEspia(solicitudCon('PENDIENTE'));
    const caso = new RefinarSolicitudCasoUso(espia.repositorio, modeloQueResponde('', false));

    const resultado = await caso.ejecutar({ id: 7 });

    expect(resultado.disponible).toBe(false);
    expect(resultado.prompt).toBeNull();
    expect(resultado.aviso).toContain('no está configurado');
    // Nada se escribió: la solicitud queda exactamente como estaba.
    expect(espia.escrituras).toEqual([]);
  });

  it('un fallo del proveedor da un aviso POR CAUSA y nunca el detalle técnico (FR-155)', async () => {
    const causas: CausaFalloProveedor[] = ['credencial', 'cuota', 'saturado', 'desconocido'];
    for (const causa of causas) {
      const espia = repositorioEspia(solicitudCon('PENDIENTE'));
      const caso = new RefinarSolicitudCasoUso(espia.repositorio, modeloQueFalla(causa));

      const resultado = await caso.ejecutar({ id: 7 });

      expect(resultado.disponible).toBe(false);
      expect(resultado.aviso).toBeTruthy();
      expect(resultado.aviso).not.toContain('detalle técnico');
      expect(espia.escrituras).toEqual([]);
    }
    // Una clave rechazada NO se arregla reintentando: decírselo sería mandar a perder el rato.
    const espiaCredencial = repositorioEspia(solicitudCon('PENDIENTE'));
    const conCredencial = await new RefinarSolicitudCasoUso(
      espiaCredencial.repositorio,
      modeloQueFalla('credencial'),
    ).ejecutar({ id: 7 });
    expect(conCredencial.aviso).toContain('NO se arregla');
  });

  it('una respuesta vacía del modelo no se guarda como prompt', async () => {
    const espia = repositorioEspia(solicitudCon('PENDIENTE'));
    const caso = new RefinarSolicitudCasoUso(espia.repositorio, modeloQueResponde('   \n  '));

    const resultado = await caso.ejecutar({ id: 7 });

    expect(resultado.disponible).toBe(false);
    expect(resultado.prompt).toBeNull();
    expect(espia.escrituras).toEqual([]);
  });

  it('no gasta una llamada al modelo en una solicitud ya cerrada', async () => {
    const espia = repositorioEspia(solicitudCon('COMPLETADA'));
    let llamado = false;
    const modelo: ModeloConversacional = {
      disponible: () => true,
      responder: async () => {
        llamado = true;
        return { texto: 'no debería llegar aquí', llamadas: [], turnoCrudo: null };
      },
    };

    const resultado = await new RefinarSolicitudCasoUso(espia.repositorio, modelo).ejecutar({ id: 7 });

    expect(llamado).toBe(false);
    expect(resultado.disponible).toBe(false);
    expect(resultado.aviso).toContain('pendientes');
  });

  it('el modelo recibe la plantilla como sistema y el pedido como contexto, sin herramientas', async () => {
    const espia = repositorioEspia(solicitudCon('PENDIENTE'));
    let entradaVista: EntradaPasoConversacion | null = null;
    const modelo: ModeloConversacional = {
      disponible: () => true,
      responder: async (entrada) => {
        entradaVista = entrada;
        return { texto: 'prompt', llamadas: [], turnoCrudo: null };
      },
    };

    await new RefinarSolicitudCasoUso(espia.repositorio, modelo).ejecutar({ id: 7 });

    expect(entradaVista).not.toBeNull();
    const entrada = entradaVista as unknown as EntradaPasoConversacion;
    expect(entrada.sistema).toBe(INSTRUCCIONES_REFINADO);
    expect(entrada.contexto).toContain('Filtrar el consumo por proveedor');
    // Sin herramientas: este caso de uso no consulta nada del inventario, a diferencia del
    // asistente. Si algún día alguien le pasa una, esta prueba lo dice.
    expect(entrada.herramientas).toEqual([]);
  });
});
