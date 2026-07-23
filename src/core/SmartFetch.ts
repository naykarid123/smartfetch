import { InterceptorAspect } from '../aspects/InterceptorAspect';
import { RetryAspect } from '../aspects/RetryAspect';
import { TimeoutAspect } from '../aspects/TimeoutAspect';
import { weave } from '../aspects/weaver';
import { InterceptorManager } from '../interceptors/InterceptorManager';
import { mergeHeaders } from '../utils/headers';
import { DEFAULT_CONFIG, RequestConfigBuilder } from './ConfigBuilder';
import { FetchAdapter } from './FetchAdapter';
import type {
  Aspect,
  FullRequestOptions,
  HttpMethod,
  ProceedFn,
  RequestConfig,
  RequestContext,
  RequestOptions,
  SmartFetchOptions,
  SmartResponse,
} from '../types';

/**
 * Cliente HTTP de SmartFetch: un wrapper avanzado sobre `fetch`.
 *
 * Actúa como **Fachada** (patrón Facade): oculta el pipeline interno
 * (interceptores -> reintentos -> timeout -> adaptador de `fetch`) tras una API
 * sencilla y familiar.
 *
 * Todos los métodos devuelven una `Promise`, por lo que pueden consumirse
 * indistintamente con `async/await` o encadenando `.then()/.catch()`.
 *
 * @example Uso básico
 * ```ts
 * const api = new SmartFetch({ baseURL: 'https://api.ejemplo.com', timeout: 5000, retries: 3 });
 * const { data } = await api.get<Usuario[]>('/usuarios');
 * ```
 */
export class SmartFetch {
  /** Opciones por defecto aplicadas a todas las peticiones del cliente. */
  public readonly defaults: SmartFetchOptions;

  /** Interceptores de petición y de respuesta. */
  public readonly interceptors: {
    request: InterceptorManager<RequestConfig>;
    response: InterceptorManager<SmartResponse<any>>;
  };

  /** Aspectos registrados a nivel de cliente. */
  private readonly aspects: Aspect[] = [];

  /**
   * Crea una nueva instancia del cliente.
   * @param options - Opciones por defecto (baseURL, timeout, retries, headers...).
   */
  constructor(options: SmartFetchOptions = {}) {
    this.defaults = { ...options };
    this.interceptors = {
      request: new InterceptorManager<RequestConfig>(),
      response: new InterceptorManager<SmartResponse<any>>(),
    };
  }

  /**
   * Factoría de clientes (patrón Factory).
   * @param options - Opciones por defecto de la nueva instancia.
   * @returns Un cliente independiente, con sus propios interceptores.
   * @example
   * const api = SmartFetch.create({ baseURL: 'https://api.ejemplo.com' });
   */
  public static create(options: SmartFetchOptions = {}): SmartFetch {
    return new SmartFetch(options);
  }

  /**
   * Deriva un cliente hijo que hereda las opciones de este y las combina con
   * las nuevas. Útil para reutilizar `baseURL` cambiando, por ejemplo, el timeout.
   * @param options - Opciones que se sobreponen a las heredadas.
   * @returns Nuevo cliente.
   */
  public extend(options: SmartFetchOptions = {}): SmartFetch {
    const child = new SmartFetch({
      ...this.defaults,
      ...options,
      headers: mergeHeaders(this.defaults.headers, options.headers),
      params: { ...this.defaults.params, ...options.params },
    });
    for (const aspect of this.aspects) child.use(aspect);
    return child;
  }

  /**
   * Registra un aspecto (POA) que se aplicará a todas las peticiones del cliente.
   * @param aspect - Aspecto a tejer en el pipeline.
   * @returns El propio cliente, para poder encadenar llamadas.
   * @example
   * client.use(new LoggingAspect()).use(miAspectoDeMetricas);
   */
  public use(aspect: Aspect): this {
    this.aspects.push(aspect);
    return this;
  }

  /**
   * Elimina un aspecto por su nombre.
   * @param name - Nombre del aspecto.
   * @returns `true` si se eliminó alguno.
   */
  public eject(name: string): boolean {
    const index = this.aspects.findIndex((aspect) => aspect.name === name);
    if (index === -1) return false;
    this.aspects.splice(index, 1);
    return true;
  }

  /**
   * Ejecuta una petición HTTP genérica.
   * Es el método sobre el que se apoyan `get`, `post`, `put`, `patch` y `delete`.
   *
   * @typeParam T - Tipo esperado del cuerpo de la respuesta.
   * @param options - Configuración de la petición (requiere `url`).
   * @returns Promesa con la respuesta normalizada.
   * @throws {TimeoutError} Si se agota el tiempo de espera.
   * @throws {NetworkError} Si hay un fallo de red.
   * @throws {HttpResponseError} Si el estado no es válido.
   * @throws {CanceledError} Si se cancela mediante `signal`.
   *
   * @example
   * const res = await client.request<Usuario>({ url: '/usuarios/1', method: 'GET' });
   */
  public request<T = unknown>(options: FullRequestOptions): Promise<SmartResponse<T>> {
    const { url, method = 'GET', body, ...rest } = options;

    const config = new RequestConfigBuilder(this.defaults)
      .withUrl(url)
      .withMethod(method)
      .withOptions(rest)
      .withBody(body)
      .build();

    const context: RequestContext = {
      config,
      attempt: 1,
      startedAt: Date.now(),
      signal: config.signal,
      meta: config.meta,
    };

    const adapter = new FetchAdapter(config.fetchImpl ?? DEFAULT_CONFIG.fetchImpl);
    const core: ProceedFn = () => adapter.execute<T>(context);

    // Pipeline: interceptores (10) -> reintentos (20) -> timeout (30) -> [aspectos de usuario] -> fetch.
    const pipeline = [
      new InterceptorAspect(this.interceptors.request, this.interceptors.response),
      new RetryAspect(),
      new TimeoutAspect(),
      ...this.aspects,
      ...config.aspects,
    ];

    return weave(pipeline, core, context)() as Promise<SmartResponse<T>>;
  }

  /**
   * Realiza una petición `GET`.
   * @typeParam T - Tipo esperado del cuerpo de la respuesta.
   * @param url - URL absoluta o relativa a `baseURL`.
   * @param options - Opciones puntuales (params, headers, timeout, retries...).
   * @returns Promesa con la respuesta.
   * @example
   * const { data } = await api.get<Usuario[]>('/usuarios', { params: { page: 1 } });
   */
  public get<T = unknown>(url: string, options: RequestOptions = {}): Promise<SmartResponse<T>> {
    return this.request<T>({ ...options, url, method: 'GET' });
  }

  /**
   * Realiza una petición `DELETE`.
   * @typeParam T - Tipo esperado del cuerpo de la respuesta.
   * @param url - URL de destino.
   * @param options - Opciones puntuales.
   * @returns Promesa con la respuesta.
   * @example
   * await api.delete('/usuarios/1');
   */
  public delete<T = unknown>(url: string, options: RequestOptions = {}): Promise<SmartResponse<T>> {
    return this.request<T>({ ...options, url, method: 'DELETE' });
  }

  /**
   * Realiza una petición `HEAD`.
   * @typeParam T - Tipo esperado del cuerpo de la respuesta.
   * @param url - URL de destino.
   * @param options - Opciones puntuales.
   * @returns Promesa con la respuesta (sin cuerpo).
   */
  public head<T = unknown>(url: string, options: RequestOptions = {}): Promise<SmartResponse<T>> {
    return this.request<T>({ ...options, url, method: 'HEAD' });
  }

  /**
   * Realiza una petición `OPTIONS`.
   * @typeParam T - Tipo esperado del cuerpo de la respuesta.
   * @param url - URL de destino.
   * @param options - Opciones puntuales.
   * @returns Promesa con la respuesta.
   */
  public options<T = unknown>(url: string, options: RequestOptions = {}): Promise<SmartResponse<T>> {
    return this.request<T>({ ...options, url, method: 'OPTIONS' });
  }

  /**
   * Realiza una petición `POST`.
   * @typeParam T - Tipo esperado del cuerpo de la respuesta.
   * @param url - URL de destino.
   * @param body - Cuerpo (los objetos planos se serializan a JSON automáticamente).
   * @param options - Opciones puntuales.
   * @returns Promesa con la respuesta.
   * @example
   * const { data } = await api.post<Usuario>('/usuarios', { nombre: 'Ada' });
   */
  public post<T = unknown>(
    url: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<SmartResponse<T>> {
    return this.request<T>({ ...options, url, method: 'POST', body });
  }

  /**
   * Realiza una petición `PUT`.
   * @typeParam T - Tipo esperado del cuerpo de la respuesta.
   * @param url - URL de destino.
   * @param body - Cuerpo de la petición.
   * @param options - Opciones puntuales.
   * @returns Promesa con la respuesta.
   */
  public put<T = unknown>(
    url: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<SmartResponse<T>> {
    return this.request<T>({ ...options, url, method: 'PUT', body });
  }

  /**
   * Realiza una petición `PATCH`.
   * @typeParam T - Tipo esperado del cuerpo de la respuesta.
   * @param url - URL de destino.
   * @param body - Cuerpo de la petición.
   * @param options - Opciones puntuales.
   * @returns Promesa con la respuesta.
   */
  public patch<T = unknown>(
    url: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<SmartResponse<T>> {
    return this.request<T>({ ...options, url, method: 'PATCH', body });
  }
}

/** Alias de tipo para los métodos con cuerpo. */
export type BodyMethod = Extract<HttpMethod, 'POST' | 'PUT' | 'PATCH'>;
