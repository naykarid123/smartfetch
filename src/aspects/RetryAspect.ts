import type { SmartFetchError } from '../errors';
import { computeRetryDelay } from '../retry/policy';
import { sleep } from '../utils/signal';
import type { Aspect, ProceedFn, RequestContext, SmartResponse } from '../types';

/**
 * Aspecto de REINTENTOS (requisito funcional 2).
 *
 * Repite la petición cuando falla por una causa transitoria (errores 5xx,
 * problemas de red o timeouts), hasta `config.retries` reintentos adicionales.
 *
 * Por defecto `retries = 0`, es decir: **un único intento**, tal y como exige
 * la especificación. La espera entre intentos la decide la estrategia de
 * backoff configurada, y puede respetar la cabecera `Retry-After`.
 *
 * `order = 20` -> envuelve al `TimeoutAspect`, así cada intento tiene su reloj.
 */
export class RetryAspect implements Aspect {
  public readonly name = 'retry';
  public readonly order = 20;

  /**
   * Advice envolvente que implementa el bucle de intentos.
   * @param context - Contexto de la petición.
   * @param proceed - Continuación de la cadena (un intento completo).
   * @returns La primera respuesta válida.
   * @throws {SmartFetchError} El último error, si se agotan los intentos.
   */
  public async around(context: RequestContext, proceed: ProceedFn): Promise<SmartResponse<any>> {
    const { retries, retryOn } = context.config;
    const maxAttempts = Math.max(1, Math.floor(retries) + 1);
    const delays: number[] = [];

    let lastError: SmartFetchError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      context.attempt = attempt;

      try {
        const response = await proceed();
        response.attempts = attempt;
        return response;
      } catch (error) {
        const smartError = error as SmartFetchError;
        smartError.attempts = attempt;
        lastError = smartError;

        const isLastAttempt = attempt === maxAttempts;
        if (isLastAttempt) break;

        const shouldRetry = await retryOn(smartError, attempt, context.config);
        if (!shouldRetry) break;

        const delay = computeRetryDelay(smartError, attempt, context.config);
        delays.push(delay);
        context.meta.retryDelays = [...delays];

        // La espera es interrumpible: si el usuario cancela, no seguimos reintentando.
        if (delay > 0) {
          await sleep(delay, context.config.signal, context.config);
        }
      }
    }

    throw lastError;
  }
}
