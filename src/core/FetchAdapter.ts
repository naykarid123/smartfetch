import { CanceledError, HttpResponseError, NetworkError } from '../errors';
import { parseResponseBody, serializeBody } from '../utils/body';
import { headersToObject } from '../utils/headers';
import { isAbortError } from '../utils/signal';
import { buildURL } from '../utils/url';
import type { FetchLike, RequestContext, SmartResponse } from '../types';

/**
 * Adaptador sobre la API nativa `fetch` (patrón Adapter).
 *
 * Es el **núcleo** (el join point que los aspectos envuelven) y la ÚNICA parte
 * de la librería que conoce `fetch`. Traduce el mundo de `fetch` al de
 * SmartFetch:
 *
 * | fetch                              | SmartFetch                    |
 * |------------------------------------|-------------------------------|
 * | Promesa rechazada por red caída    | `NetworkError`                |
 * | `AbortError`                       | `CanceledError`               |
 * | 404/500 resueltos con `ok: false`  | `HttpResponseError` (lanzado) |
 * | `res.json()` manual                | `data` ya deserializado       |
 *
 * Aislar `fetch` aquí permite sustituirlo (tests, polyfills, entornos exóticos)
 * sin tocar el resto de la librería.
 */
export class FetchAdapter {
  /**
   * @param fetchImpl - Implementación de `fetch` a utilizar.
   */
  constructor(private readonly fetchImpl: FetchLike) {}

  /**
   * Ejecuta UN intento de la petición.
   * @typeParam T - Tipo esperado del cuerpo de la respuesta.
   * @param context - Contexto de la petición.
   * @throws {NetworkError} Si la conexión falla.
   * @throws {CanceledError} Si la petición se aborta.
   * @throws {HttpResponseError} Si el estado no supera `validateStatus`.
   * @returns Respuesta normalizada.
   */
  public async execute<T>(context: RequestContext): Promise<SmartResponse<T>> {
    const { config } = context;
    const url = buildURL(config.url, config.baseURL, config.params);
    const { body, headers } = serializeBody(config.body, config.headers, config.method);

    // La señal efectiva la aporta el TimeoutAspect (usuario + timeout combinados).
    const signal = context.signal ?? config.signal;

    let raw: Response;
    try {
      raw = await this.fetchImpl(url, {
        method: config.method,
        headers,
        body,
        signal,
        credentials: config.credentials,
        mode: config.mode,
        cache: config.cache,
        redirect: config.redirect,
        referrerPolicy: config.referrerPolicy,
        integrity: config.integrity,
        keepalive: config.keepalive,
      });
    } catch (error) {
      // `fetch` solo rechaza por fallo de red o por cancelación.
      if (isAbortError(error)) throw new CanceledError(config, context.attempt);
      throw new NetworkError(error, config, context.attempt);
    }

    const data = await parseResponseBody<T>(raw, config.responseType, config);

    const response: SmartResponse<T> = {
      data,
      status: raw.status,
      statusText: raw.statusText,
      headers: headersToObject(raw.headers),
      config,
      attempts: context.attempt,
      raw,
    };

    // A diferencia de `fetch`, un 4xx/5xx SÍ es un error: se lanza para poder
    // reintentarlo y para que el consumidor lo capture en un único `catch`.
    if (!config.validateStatus(raw.status)) {
      throw new HttpResponseError(response, context.attempt);
    }

    return response;
  }
}
