/**
 * Módulo `IaModule` — el único sitio donde el puerto `ModeloConversacional` se ata a un proveedor
 * concreto (hoy Google AI Studio, vía `AdaptadorGemini`).
 *
 * ## Por qué existe, desde US36
 *
 * Hasta ahora el cableado vivía dentro de `AsistenteModule`, y su TSDoc prometía que cambiar de
 * proveedor era "cambiar esta línea y nada más". Esa promesa dejó de ser cierta en cuanto un
 * segundo módulo necesitó hablar con un modelo: el buzón de solicitudes (US36) refina texto con el
 * mismo puerto y ninguna de las herramientas del asistente. Las dos salidas malas eran importar
 * `AsistenteModule` entero para tomar prestado un token —arrastrando sus casos de uso de consulta
 * a un módulo que no consulta nada— o registrar un segundo `AdaptadorGemini` aquí, que son dos
 * cableados que mantener y dos sitios donde olvidarse de cambiar el modelo.
 *
 * Así, quien quiera cambiar de proveedor —o poner un doble en pruebas— sigue teniendo UNA línea
 * que tocar, y los consumidores solo declaran que necesitan hablar con un modelo.
 *
 * No es `@Global` a propósito: quién puede hablar con un modelo debe verse en la lista de
 * `imports` de cada módulo, no estar disponible en todas partes por omisión.
 */
import { Module } from '@nestjs/common';
import { MODELO_CONVERSACIONAL } from '../../aplicacion/asistente/puertos/modelo-conversacional';
import { AdaptadorGemini } from './adaptador-gemini';

@Module({
  providers: [{ provide: MODELO_CONVERSACIONAL, useClass: AdaptadorGemini }],
  exports: [MODELO_CONVERSACIONAL],
})
export class IaModule {}
