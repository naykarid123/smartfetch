import type { SmartFetchError } from '../errors';
import type { Aspect, RequestContext, SmartResponse } from '../types';

/**
 * Aspecto de LOGGING / observabilidad.
 *
 * Ejemplo canónico de "concern transversal": mide y registra cada petición sin
 * que el cliente HTTP sepa nada del logger. Sirve además como referencia de los
 * cinco advices disponibles.
 *
 * `order = 0` -> es el aspecto MÁS EXTERNO, por lo que mide el tiempo total,
 * reintentos incluidos.
 */
export class LoggingAspect implements Aspect {
  public readonly name = 'logging';
  public readonly order = 0;

  /** Marca el inicio de la petición. @param context - Contexto de la petición. */
  public before(context: RequestContext): void {
    context.meta.startedAt = Date.now();
    context.config.logger?.debug?.(
      `-> ${context.config.method} ${context.config.url}`,
    );
  }

  /**
   * Registra las peticiones exitosas.
   * @param context - Contexto de la petición.
   * @param response - Respuesta obtenida.
   */
  public afterReturning(context: RequestContext, response: SmartResponse<unknown>): void {
    context.config.logger?.info?.(
      `<- ${context.config.method} ${context.config.url} ${response.status} (${this.elapsed(context)}ms, ${response.attempts} intento/s)`,
    );
  }

  /**
   * Registra los fallos definitivos.
   * @param context - Contexto de la petición.
   * @param error - Error final.
   */
  public afterThrowing(context: RequestContext, error: SmartFetchError): void {
    context.config.logger?.error?.(
      `x! ${context.config.method} ${context.config.url} ${error.code} (${this.elapsed(context)}ms, ${error.attempts} intento/s)`,
      error.toJSON(),
    );
  }

  /** Calcula el tiempo transcurrido. @param context - Contexto de la petición. */
  private elapsed(context: RequestContext): number {
    return Date.now() - (context.meta.startedAt as number ?? context.startedAt);
  }
}
