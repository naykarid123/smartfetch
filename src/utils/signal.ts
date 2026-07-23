import { CanceledError } from '../errors';
import type { RequestConfig } from '../types';

/**
 * Determina si un error corresponde a una cancelación (`AbortError`).
 * @param error - Error capturado.
 */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'AbortError'
  );
}

/**
 * Combina varias señales de cancelación en una sola.
 * La señal resultante se aborta en cuanto lo hace cualquiera de las de entrada.
 * @param signals - Señales (los `undefined` se ignoran).
 * @returns Señal combinada, o `undefined` si no había ninguna.
 */
export function composeSignals(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal | undefined {
  const list = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (list.length === 0) return undefined;
  if (list.length === 1) return list[0];

  // `AbortSignal.any` existe en Node >= 20 y navegadores modernos.
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === 'function') return anyFn(list);

  // Fallback manual para entornos antiguos.
  const controller = new AbortController();
  const cleanup = (): void => {
    for (const signal of list) signal.removeEventListener('abort', onAbort);
  };
  function onAbort(this: AbortSignal): void {
    controller.abort(this.reason);
    cleanup();
  }
  for (const signal of list) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      cleanup();
      return controller.signal;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }
  return controller.signal;
}

/**
 * Espera un número de milisegundos; se interrumpe si la señal se aborta.
 * @param ms - Milisegundos a esperar.
 * @param signal - Señal de cancelación opcional.
 * @param config - Configuración usada para enriquecer el error de cancelación.
 * @throws {CanceledError} Si la señal se aborta durante la espera.
 */
export function sleep(ms: number, signal?: AbortSignal, config?: RequestConfig): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CanceledError(config));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new CanceledError(config));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
