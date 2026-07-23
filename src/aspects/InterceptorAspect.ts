import { toSmartFetchError } from '../errors';
import type { InterceptorManager } from '../interceptors/InterceptorManager';
import type { Aspect, ProceedFn, RequestConfig, RequestContext, SmartResponse } from '../types';

/**
 * Aspecto que ejecuta los INTERCEPTORES registrados en el cliente.
 *
 * `order = 10` -> se sitúa por fuera del `RetryAspect`, de modo que los
 * interceptores se ejecutan UNA sola vez por petición lógica y no una vez por
 * reintento.
 */
export class InterceptorAspect implements Aspect {
  public readonly name = 'interceptors';
  public readonly order = 10;

  /**
   * @param requestInterceptors - Gestor de interceptores de petición.
   * @param responseInterceptors - Gestor de interceptores de respuesta.
   */
  constructor(
    private readonly requestInterceptors: InterceptorManager<RequestConfig>,
    private readonly responseInterceptors: InterceptorManager<SmartResponse<any>>,
  ) {}

  /**
   * Aplica los interceptores de petición, ejecuta la cadena y aplica los de respuesta.
   * @param context - Contexto de la petición.
   * @param proceed - Continuación de la cadena.
   */
  public async around(context: RequestContext, proceed: ProceedFn): Promise<SmartResponse<any>> {
    // 1. Interceptores de petición: pueden mutar o reemplazar la configuración.
    for (const handler of this.requestInterceptors.list()) {
      if (!handler.onFulfilled) continue;
      try {
        context.config = await handler.onFulfilled(context.config);
      } catch (error) {
        if (!handler.onRejected) throw toSmartFetchError(error, context.config);
        context.config = await handler.onRejected(error);
      }
    }

    try {
      // 2. Ejecución real (retry -> timeout -> fetch).
      let response = await proceed();

      // 3. Interceptores de respuesta.
      for (const handler of this.responseInterceptors.list()) {
        if (handler.onFulfilled) response = await handler.onFulfilled(response);
      }
      return response;
    } catch (error) {
      // 4. Interceptores de error: permiten recuperarse (p. ej., refrescar token).
      let current: unknown = error;
      for (const handler of this.responseInterceptors.list()) {
        if (!handler.onRejected) continue;
        try {
          const recovered = await handler.onRejected(current);
          if (recovered !== undefined) return recovered;
        } catch (nextError) {
          current = nextError;
        }
      }
      throw toSmartFetchError(current, context.config);
    }
  }
}
