import { TimeoutError } from '../errors';
import { composeSignals } from '../utils/signal';
import type { Aspect, ProceedFn, RequestContext, SmartResponse } from '../types';

/**
 * Aspecto de TIMEOUT (requisito funcional 1).
 *
 * Envuelve cada intento con un `AbortController` propio: si el servidor no
 * responde dentro de `config.timeout`, la petición se **cancela realmente**
 * (no se deja colgada) y se lanza un {@link TimeoutError} controlado.
 *
 * Se combina con la señal externa del usuario, de modo que una cancelación
 * manual sigue funcionando aunque haya timeout activo.
 *
 * `order = 30` -> queda por DENTRO del `RetryAspect` (order 20), de forma que
 * cada reintento arranca un temporizador nuevo.
 */
export class TimeoutAspect implements Aspect {
  public readonly name = 'timeout';
  public readonly order = 30;

  /**
   * Advice envolvente que aplica el límite de tiempo al intento en curso.
   * @param context - Contexto de la petición.
   * @param proceed - Continuación de la cadena.
   * @throws {TimeoutError} Si se agota el tiempo configurado.
   */
  public async around(context: RequestContext, proceed: ProceedFn): Promise<SmartResponse<any>> {
    const { timeout } = context.config;

    // `timeout: 0` (o negativo) desactiva la funcionalidad.
    if (!timeout || timeout <= 0) return proceed();

    const controller = new AbortController();
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout);

    const previousSignal = context.signal;
    context.signal = composeSignals(context.config.signal, controller.signal);

    try {
      return await proceed();
    } catch (error) {
      // Si el aborto lo provocó NUESTRO temporizador, lo traducimos a TimeoutError.
      // Si lo provocó el usuario, dejamos pasar el CanceledError original.
      if (timedOut) {
        throw new TimeoutError(timeout, context.config, context.attempt);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      context.signal = previousSignal;
    }
  }
}
