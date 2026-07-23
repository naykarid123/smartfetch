import { isHttpResponseError, SmartFetchErrorCode, type SmartFetchError } from '../errors';
import type { RequestConfig, RetryPredicate } from '../types';

/**
 * Códigos de estado que se consideran transitorios y, por tanto, reintentables.
 * - 408: Request Timeout
 * - 425: Too Early
 * - 429: Too Many Requests
 * - 5xx: errores del servidor
 */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 425 || status === 429;
}

/**
 * Política de reintento por defecto.
 *
 * Se reintenta ante:
 * - Fallos de red.
 * - Timeouts.
 * - Respuestas con estado transitorio (5xx, 408, 425, 429).
 *
 * NO se reintenta ante:
 * - Cancelaciones explícitas del usuario.
 * - Errores 4xx del cliente (salvo los transitorios): reintentar no cambiaría el resultado.
 * - Errores de parseo o de configuración.
 *
 * @param error - Error normalizado de SmartFetch.
 * @returns `true` si conviene reintentar.
 */
export const defaultRetryPredicate: RetryPredicate = (error: SmartFetchError): boolean => {
  switch (error.code) {
    case SmartFetchErrorCode.CANCELED:
      return false;
    case SmartFetchErrorCode.TIMEOUT:
    case SmartFetchErrorCode.NETWORK:
      return true;
    case SmartFetchErrorCode.BAD_RESPONSE:
      return isHttpResponseError(error) ? isRetryableStatus(error.status) : false;
    default:
      return false;
  }
};

/**
 * Interpreta la cabecera `Retry-After` (segundos o fecha HTTP).
 * @param value - Valor crudo de la cabecera.
 * @returns Milisegundos a esperar, o `null` si no es interpretable.
 */
export function parseRetryAfter(value: string | undefined): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - Date.now());
}

/**
 * Calcula la espera antes del siguiente intento.
 * Da prioridad a `Retry-After` (si el servidor la envía y está habilitado);
 * en caso contrario aplica la estrategia de backoff configurada.
 *
 * @param error - Error del intento que acaba de fallar.
 * @param attempt - Número de intento fallido (1-based).
 * @param config - Configuración resuelta de la petición.
 * @returns Milisegundos de espera.
 */
export function computeRetryDelay(
  error: SmartFetchError,
  attempt: number,
  config: RequestConfig,
): number {
  if (config.respectRetryAfter && isHttpResponseError(error)) {
    const retryAfter = parseRetryAfter(error.response.headers['retry-after']);
    if (retryAfter !== null) return retryAfter;
  }
  return config.backoff.delay(attempt, config.retryDelay);
}
