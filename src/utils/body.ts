import { ParseError } from '../errors';
import type { HttpMethod, RequestConfig, ResponseType } from '../types';

/** Estados HTTP que, por definición, no llevan cuerpo. */
const BODYLESS_STATUS = new Set([204, 205, 304]);

/** Métodos que no admiten cuerpo. */
const BODYLESS_METHODS = new Set<HttpMethod>(['GET', 'HEAD']);

/**
 * Indica si el valor es un cuerpo que `fetch` ya sabe enviar tal cual
 * (y para el que NO debemos fijar `Content-Type` manualmente).
 * @param value - Cuerpo candidato.
 */
function isNativeBody(value: unknown): boolean {
  if (typeof value === 'string') return true;
  if (typeof FormData !== 'undefined' && value instanceof FormData) return true;
  if (typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams) return true;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true;
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return true;
  if (typeof ReadableStream !== 'undefined' && value instanceof ReadableStream) return true;
  return ArrayBuffer.isView(value);
}

/** Resultado de la serialización del cuerpo. */
export interface SerializedBody {
  /** Cuerpo listo para `fetch` (o `undefined` si no procede). */
  body: BodyInit | undefined;
  /** Cabeceras finales, posiblemente con `content-type` añadido. */
  headers: Record<string, string>;
}

/**
 * Serializa el cuerpo de la petición y ajusta el `Content-Type` cuando hace falta.
 *
 * - Objetos y arrays planos -> JSON + `content-type: application/json`.
 * - `FormData` -> se delega en `fetch` (necesita generar su propio boundary).
 * - `string`, `Blob`, `ArrayBuffer`, `URLSearchParams`, streams -> se envían tal cual.
 * - `GET` y `HEAD` -> nunca llevan cuerpo.
 *
 * @param body - Cuerpo original.
 * @param headers - Cabeceras ya normalizadas.
 * @param method - Método HTTP de la petición.
 * @returns Cuerpo y cabeceras listos para `fetch`.
 */
export function serializeBody(
  body: unknown,
  headers: Record<string, string>,
  method: HttpMethod,
): SerializedBody {
  const finalHeaders = { ...headers };

  if (body === undefined || body === null || BODYLESS_METHODS.has(method)) {
    return { body: undefined, headers: finalHeaders };
  }

  if (isNativeBody(body)) {
    return { body: body as BodyInit, headers: finalHeaders };
  }

  
  if (!finalHeaders['content-type']) {
    finalHeaders['content-type'] = 'application/json';
  }
  return { body: JSON.stringify(body), headers: finalHeaders };
}

/**
 * Decide el modo de deserialización cuando `responseType` es `auto`,
 * basándose en la cabecera `Content-Type`.
 * @param contentType - Valor de la cabecera `content-type`.
 */
function inferResponseType(contentType: string | null): ResponseType {
  if (!contentType) return 'text';
  if (/application\/(\w+\+)?json/i.test(contentType)) return 'json';
  if (/^text\//i.test(contentType) || /application\/(xml|x-www-form-urlencoded)/i.test(contentType)) {
    return 'text';
  }
  return 'arrayBuffer';
}

/**
 * Deserializa el cuerpo de una respuesta según el `responseType` configurado.
 * @typeParam T - Tipo esperado del cuerpo.
 * @param response - Respuesta nativa de `fetch`.
 * @param responseType - Modo de deserialización.
 * @param config - Configuración de la petición (para enriquecer errores).
 * @throws {ParseError} Si el cuerpo no puede interpretarse.
 * @returns Cuerpo deserializado (o `null` si la respuesta no tiene cuerpo).
 */
export async function parseResponseBody<T>(
  response: Response,
  responseType: ResponseType,
  config: RequestConfig,
): Promise<T> {
  if (responseType === 'none' || BODYLESS_STATUS.has(response.status) || config.method === 'HEAD') {
    return null as T;
  }

  const type =
    responseType === 'auto'
      ? inferResponseType(response.headers.get('content-type'))
      : responseType;

  try {
    switch (type) {
      case 'json': {
        // Se lee como texto primero para tolerar cuerpos vacíos con content-type JSON.
        const text = await response.text();
        return (text ? (JSON.parse(text) as T) : (null as T));
      }
      case 'text':
        return (await response.text()) as T;
      case 'arrayBuffer':
        return (await response.arrayBuffer()) as T;
      case 'blob':
        return (await response.blob()) as T;
      case 'formData':
        return (await response.formData()) as T;
      default:
        return (await response.text()) as T;
    }
  } catch (error) {
    throw new ParseError(error, config);
  }
}
