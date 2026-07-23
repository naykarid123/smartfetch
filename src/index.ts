/**
 * SmartFetch — wrapper avanzado sobre la API nativa `fetch`.
 *
 * Punto de entrada público de la librería. Exporta:
 * - La clase {@link SmartFetch} (cliente configurable).
 * - Una instancia por defecto lista para usar.
 * - Errores tipados, aspectos, interceptores y estrategias de backoff.
 *
 * @packageDocumentation
 */

import { SmartFetch } from './core/SmartFetch';

// --- Cliente ---
export { SmartFetch } from './core/SmartFetch';
export { RequestConfigBuilder, DEFAULT_CONFIG, defaultFetch } from './core/ConfigBuilder';
export { FetchAdapter } from './core/FetchAdapter';

// --- Errores ---
export {
  SmartFetchError,
  SmartFetchErrorCode,
  TimeoutError,
  NetworkError,
  CanceledError,
  ParseError,
  ConfigurationError,
  HttpResponseError,
  isSmartFetchError,
  isTimeoutError,
  isNetworkError,
  isHttpResponseError,
  isCanceledError,
  toSmartFetchError,
} from './errors';

// --- Programación Orientada a Aspectos ---
export {
  weave,
  DEFAULT_ASPECT_ORDER,
  TimeoutAspect,
  RetryAspect,
  LoggingAspect,
  InterceptorAspect,
} from './aspects';

// --- Interceptores ---
export { InterceptorManager } from './interceptors/InterceptorManager';
export type {
  FulfilledHandler,
  RejectedHandler,
  InterceptorHandler,
} from './interceptors/InterceptorManager';

// --- Reintentos ---
export {
  fixedBackoff,
  linearBackoff,
  exponentialBackoff,
  noBackoff,
  createBackoff,
} from './retry/backoff';
export type { BackoffName, BackoffOptions } from './retry/backoff';
export {
  defaultRetryPredicate,
  isRetryableStatus,
  parseRetryAfter,
  computeRetryDelay,
} from './retry/policy';

// --- Tipos públicos ---
export type {
  Aspect,
  BackoffStrategy,
  FetchLike,
  FullRequestOptions,
  HttpMethod,
  Logger,
  ProceedFn,
  QueryParams,
  RequestConfig,
  RequestContext,
  RequestOptions,
  ResponseType,
  RetryPredicate,
  SmartFetchOptions,
  SmartResponse,
} from './types';

/**
 * Instancia por defecto de SmartFetch, lista para usar sin configuración previa.
 * Equivale a `new SmartFetch()`.
 *
 * @example
 * ```ts
 * import smartfetch from 'smartfetch';
 * const { data } = await smartfetch.get('https://api.ejemplo.com/usuarios');
 * ```
 */
export const smartfetch: SmartFetch = SmartFetch.create();

export default smartfetch;
