import { toSmartFetchError } from '../errors';
import type { Aspect, ProceedFn, RequestContext, SmartResponse } from '../types';

/** Orden por defecto de un aspecto que no declara `order`. */
export const DEFAULT_ASPECT_ORDER = 100;

/**
 * Teje (weaving) una lista de aspectos alrededor del núcleo de ejecución.
 *
 * El aspecto con `order` MENOR queda en la capa MÁS EXTERNA. Así, por ejemplo,
 * el aspecto de reintentos (order 20) envuelve al de timeout (order 30), lo que
 * garantiza que **cada intento disponga de su propio reloj de timeout**.
 *
 * Cada aspecto puede usar cinco advices:
 * `before` -> `around` (que controla el `proceed`) -> `afterReturning` / `afterThrowing` -> `after`.
 *
 * @param aspects - Aspectos a aplicar.
 * @param core - Función núcleo (la petición HTTP real).
 * @param context - Contexto compartido de la petición.
 * @returns Función que, al invocarse, ejecuta toda la cadena.
 *
 * @example
 * const pipeline = weave([new RetryAspect(), new TimeoutAspect()], core, ctx);
 * const response = await pipeline();
 */
export function weave(aspects: Aspect[], core: ProceedFn, context: RequestContext): ProceedFn {
  const ordered = [...aspects].sort(
    (a, b) => (a.order ?? DEFAULT_ASPECT_ORDER) - (b.order ?? DEFAULT_ASPECT_ORDER),
  );

  return ordered.reduceRight<ProceedFn>((next, aspect) => {
    return async (): Promise<SmartResponse<any>> => {
      try {
        if (aspect.before) await aspect.before(context);

        const response = aspect.around
          ? await aspect.around(context, next)
          : await next();

        if (aspect.afterReturning) await aspect.afterReturning(context, response);
        return response;
      } catch (rawError) {
        // Todo error que cruce la cadena se normaliza: la librería nunca
        // propaga excepciones desconocidas hacia el consumidor.
        const error = toSmartFetchError(rawError, context.config);
        if (aspect.afterThrowing) await aspect.afterThrowing(context, error);
        throw error;
      } finally {
        if (aspect.after) await aspect.after(context);
      }
    };
  }, core);
}
