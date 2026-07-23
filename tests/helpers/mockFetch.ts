import type { FetchLike } from '../../src';

/** Opciones para construir una respuesta simulada. */
export interface MockResponseInit {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * Crea un `Response` nativo simulado con cuerpo JSON.
 * @param init - Estado, cabeceras y cuerpo deseados.
 */
export function jsonResponse(init: MockResponseInit = {}): Response {
  const { status = 200, headers = {}, body = {} } = init;
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Registro de una llamada capturada por el mock. */
export interface RecordedCall {
  url: string;
  init: RequestInit;
}

/** Mock de `fetch` con historial de llamadas. */
export interface MockFetch {
  fetch: FetchLike;
  calls: RecordedCall[];
}

/**
 * Crea un mock de `fetch` que va devolviendo, en orden, las respuestas indicadas.
 * Si se agotan, repite la última. Un elemento `Error` provoca un rechazo (fallo de red).
 * @param responses - Secuencia de respuestas o errores.
 */
export function mockFetchSequence(responses: Array<Response | Error>): MockFetch {
  const calls: RecordedCall[] = [];
  let index = 0;

  const fetch: FetchLike = async (url, init = {}) => {
    calls.push({ url, init });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next instanceof Error) throw next;
    // Se clona para poder reutilizar la misma respuesta en varios intentos.
    return next.clone();
  };

  return { fetch, calls };
}

/**
 * Crea un `fetch` que nunca resuelve, salvo que su señal se aborte.
 * Simula un servidor que no responde (para probar el timeout).
 */
export function hangingFetch(): MockFetch {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = (url, init = {}) => {
    calls.push({ url, init });
    return new Promise<Response>((_resolve, reject) => {
      const signal = init.signal;
      if (signal?.aborted) {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
        return;
      }
      signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
    });
  };
  return { fetch, calls };
}

/** Simula un fallo de red al estilo de `fetch` (TypeError). */
export function networkFailure(message = 'fetch failed'): Error {
  return new TypeError(message);
}
