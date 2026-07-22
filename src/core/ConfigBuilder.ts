import { ConfigurationError } from '../errors';
import { exponentialBackoff } from '../retry/backoff';
import { defaultRetryPredicate } from '../retry/policy';
import { mergeHeaders } from '../utils/headers';
import type {
  FetchLike,
  HttpMethod,
  RequestConfig,
  SmartFetchOptions,
} from '../types';

/**
 * Implementación de `fetch` por defecto.
 * Se resuelve de forma perezosa (en cada llamada) para que los tests puedan
 * sustituir `globalThis.fetch` y para dar un error claro en entornos antiguos.
 * @param input - URL de destino.
 * @param init - Opciones nativas de `fetch`.
 */
export const defaultFetch: FetchLike = (input, init) => {
  if (typeof globalThis.fetch !== 'function') {
    throw new ConfigurationError(
      'La API `fetch` no está disponible en este entorno. Usa Node >= 18 o inyecta una implementación mediante la opción `fetchImpl`.',
    );
  }
  return globalThis.fetch(input, init);
};

/**
 * Valores por defecto de la librería.
 *
 * Nota sobre `retries: 0`: la especificación exige que, por defecto, la
 * librería realice **un solo intento**. `retries` cuenta los reintentos
 * ADICIONALES, de modo que `0` equivale a 1 intento total.
 */
export const DEFAULT_CONFIG: Omit<RequestConfig, 'url' | 'method'> = {
  headers: {},
  params: {},
  timeout: 0,
  retries: 0,
  retryDelay: 300,
  backoff: exponentialBackoff({ maxDelay: 30_000 }),
  retryOn: defaultRetryPredicate,
  respectRetryAfter: true,
  responseType: 'auto',
  validateStatus: (status: number): boolean => status >= 200 && status < 300,
  fetchImpl: defaultFetch,
  aspects: [],
  meta: {},
};

/**
 * Constructor fluido de la configuración de una petición (patrón Builder).
 *
 * Resuelve la precedencia de opciones (defaults de la librería -> defaults del
 * cliente -> opciones de la llamada) y fusiona correctamente las estructuras
 * anidadas (`headers`, `params`, `meta`, `aspects`), que no deben sobrescribirse
 * en bloque.
 *
 * @example
 * const config = new RequestConfigBuilder(client.defaults)
 *   .withMethod('POST')
 *   .withUrl('/users')
 *   .withOptions({ timeout: 2000 })
 *   .withBody({ name: 'Ada' })
 *   .build();
 */
export class RequestConfigBuilder {
  private readonly config: Omit<RequestConfig, 'url' | 'method'> & {
    url?: string;
    method?: HttpMethod;
  };

  /**
   * @param clientDefaults - Opciones por defecto del cliente.
   */
  constructor(clientDefaults: SmartFetchOptions = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...clientDefaults,
      headers: mergeHeaders(DEFAULT_CONFIG.headers, clientDefaults.headers),
      params: { ...DEFAULT_CONFIG.params, ...clientDefaults.params },
      meta: { ...DEFAULT_CONFIG.meta, ...clientDefaults.meta },
      aspects: [...(clientDefaults.aspects ?? [])],
    };
  }

  /**
   * Fija la URL de la petición.
   * @param url - URL absoluta o relativa a `baseURL`.
   */
  public withUrl(url: string): this {
    this.config.url = url;
    return this;
  }

  /**
   * Fija el método HTTP.
   * @param method - Método HTTP.
   */
  public withMethod(method: HttpMethod): this {
    this.config.method = method;
    return this;
  }

  /**
   * Fija el cuerpo de la petición.
   * @param body - Cuerpo (se serializa a JSON si es un objeto plano).
   */
  public withBody(body: unknown): this {
    if (body !== undefined) this.config.body = body;
    return this;
  }

  /**
   * Aplica las opciones puntuales de la llamada, que tienen la máxima prioridad.
   * @param options - Opciones de la petición.
   */
  public withOptions(options: SmartFetchOptions = {}): this {
    const { headers, params, meta, aspects, ...rest } = options;
    Object.assign(this.config, rest);
    this.config.headers = mergeHeaders(this.config.headers, headers);
    this.config.params = { ...this.config.params, ...params };
    this.config.meta = { ...this.config.meta, ...meta };
    if (aspects?.length) this.config.aspects = [...this.config.aspects, ...aspects];
    return this;
  }

  /**
   * Construye la configuración final.
   * @throws {ConfigurationError} Si falta la URL o el método.
   * @returns Configuración lista para ejecutarse.
   */
  public build(): RequestConfig {
    if (!this.config.url) {
      throw new ConfigurationError('La petición requiere una `url`.');
    }
    if (!this.config.method) {
      throw new ConfigurationError('La petición requiere un `method`.');
    }
    return this.config as RequestConfig;
  }
}
