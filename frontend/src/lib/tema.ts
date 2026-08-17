/**
 * Tema claro/oscuro de la interfaz (US19, FR-108).
 *
 * El tema es del NAVEGADOR, no de la cuenta: se guarda en `localStorage` y no viaja al
 * servidor. Dos personas que comparten un usuario en dos equipos ven cada una el suyo, que es
 * lo correcto — quien mira la pantalla es quien decide cómo la quiere, y guardarlo en el perfil
 * habría significado una migración, un endpoint y una escritura en base de datos para una
 * preferencia visual.
 *
 * Mientras nadie ha elegido nada, manda el sistema operativo (`prefers-color-scheme`). Elegir
 * explícitamente el mismo tema que el del sistema SÍ deja marca: a partir de ahí la aplicación
 * respeta la elección aunque el sistema cambie de tema por la noche.
 */

/** Los dos temas, en el mismo español que el resto de la interfaz. */
export type Tema = 'claro' | 'oscuro';

/** Clave de `localStorage`. Prefijada porque el dominio puede alojar otras cosas. */
export const CLAVE_TEMA = 'lof.tema';

/** Atributo que llevan `<html>` y el selector CSS de `globals.css`. */
export const ATRIBUTO_TEMA = 'data-tema';

/**
 * Script que se inyecta en el `<head>` y corre ANTES de la primera pintura (FR-108, US19-AS4).
 *
 * Sin esto habría destello: React solo puede fijar el tema después de hidratar, así que el
 * navegador alcanzaría a pintar un frame con el tema por defecto y el usuario vería el flash
 * del tema contrario en cada carga. Por eso es una cadena de JavaScript plano y no un
 * componente — tiene que ejecutarse cuando todavía no hay React.
 *
 * Va envuelto en `try` porque `localStorage` lanza en navegación privada de algunos
 * navegadores y con cookies de terceros bloqueadas: si falla, el tema por defecto es el
 * oscuro de siempre y la aplicación sigue funcionando.
 */
export const SCRIPT_TEMA_INICIAL = `(function(){try{
  var t = localStorage.getItem('${CLAVE_TEMA}');
  if (t !== 'claro' && t !== 'oscuro') {
    t = window.matchMedia('(prefers-color-scheme: light)').matches ? 'claro' : 'oscuro';
  }
  document.documentElement.setAttribute('${ATRIBUTO_TEMA}', t);
}catch(e){}})();`;

/** Tema que debe mostrarse ahora: el elegido, o el del sistema si nadie eligió. */
export function temaInicial(): Tema {
  if (typeof window === 'undefined') return 'oscuro';
  const guardado = leerTemaGuardado();
  if (guardado) return guardado;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'claro' : 'oscuro';
}

/** Tema explícitamente elegido por el usuario, o `null` si nunca eligió. */
export function leerTemaGuardado(): Tema | null {
  try {
    const valor = window.localStorage.getItem(CLAVE_TEMA);
    return valor === 'claro' || valor === 'oscuro' ? valor : null;
  } catch {
    return null;
  }
}

/** Aplica el tema al documento y lo recuerda. Es la ÚNICA función que escribe el atributo, para
 *  que el script inicial y el botón no puedan discrepar sobre cómo se llama. */
export function aplicarTema(tema: Tema): void {
  document.documentElement.setAttribute(ATRIBUTO_TEMA, tema);
  try {
    window.localStorage.setItem(CLAVE_TEMA, tema);
  } catch {
    // Sin `localStorage` el tema dura lo que dure la pestaña: peor que recordarlo, mejor que
    // no dejar cambiarlo.
  }
}
