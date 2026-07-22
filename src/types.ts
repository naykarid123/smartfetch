import type { SmartFetchError } from './errors';

/**
 * Métodos HTTP soportados por el cliente.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/**
 * Firma mínima compatible con la API nativa `fetch`.
 * Permite inyectar una implementación alternativa (útil para tests o entornos sin `fetch` global).
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Valores admitidos en los parámetros de query string. */
export type QueryParamValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number | boolean>;

/** Diccionario de parámetros que se serializan en la query string. */
export type QueryParams = Record<string, QueryParamValue>;

/**
 * Forma en la que se deserializa el cuerpo de la respuesta.
 * `auto` decide según la cabecera `Content-Type`.
 */
export type ResponseType = 'auto' | 'json' | 'text' | 'arrayBuffer' | 'blob' | 'formData' | 'none';

/**
 * Estrategia de espera entre reintentos (patrón Strategy).
 */
export interface BackoffStrategy {
  /** Nombre legible de la estrategia (útil para logs y depuración). */
  readonly name: string;
  /**
   * Calcula cuántos milisegundos esperar antes del siguiente intento.
   * @param attempt - Número del intento que acaba de fallar (1-based).
   * @param baseDelay - Retardo base configurado en `retryDelay`.
   * @returns Milisegundos de espera.
   */
  delay(attempt: number, baseDelay: number): number;
}

/**
 * Predicado que decide si un error concreto es reintentable.
 * @param error - Error normalizado de SmartFetch.
 * @param attempt - Número del intento que falló (1-based).
 * @param config - Configuración resuelta de la petición.
 */
export type RetryPredicate = (
  error: SmartFetchError,
  attempt: number,
  config: RequestConfig,
) => boolean | Promise<boolean>;

/** Logger mínimo (compatible con `console`). */
export interface Logger {
  debug?(message: string, meta?: unknown): void;
  info?(message: string, meta?: unknown): void;
  warn?(message: string, meta?: unknown): void;
  error?(message: string, meta?: unknown): void;
}

/**
 * Configuración completamente resuelta de una petición
 * (defaults del cliente + opciones puntuales de la llamada).
 */
export interface RequestConfig {
  /** URL absoluta o relativa a `baseURL`. */
  url: string;
  /** Método HTTP. */
  method: HttpMethod;
  /** Prefijo aplicado a las URLs relativas. */
  baseURL?: string;
  /** Cabeceras normalizadas a minúsculas. */
  headers: Record<string, string>;
  /** Parámetros de query string. */
  params: QueryParams;
  /** Cuerpo de la petición (se serializa automáticamente si es un objeto plano). */
  body?: unknown;
  /** Milisegundos máximos de espera. `0` desactiva el timeout. */
  timeout: number;
  /** Reintentos ADICIONALES tras el primer intento. `0` => un único intento. */
  retries: number;
  /** Retardo base entre reintentos, en milisegundos. */
  retryDelay: number;
  /** Estrategia de crecimiento del retardo entre reintentos. */
  backoff: BackoffStrategy;
  /** Predicado que determina qué errores son reintentables. */
  retryOn: RetryPredicate;
  /** Si es `true`, se respeta la cabecera `Retry-After` de la respuesta. */
  respectRetryAfter: boolean;
  /** Modo de deserialización del cuerpo de la respuesta. */
  responseType: ResponseType;
  /** Determina qué códigos de estado se consideran exitosos. */
  validateStatus: (status: number) => boolean;
  /** Señal externa para cancelar manualmente la petición. */
  signal?: AbortSignal;
  /** Implementación de `fetch` a utilizar. */
  fetchImpl: FetchLike;
  /** Aspectos adicionales aplicados solo a esta petición. */
  aspects: Aspect[];
  /** Logger opcional usado por el `LoggingAspect`. */
  logger?: Logger;
  /** Metadatos libres, disponibles en interceptores y aspectos. */
  meta: Record<string, unknown>;
  /** Opciones nativas de `fetch` que se pasan tal cual. */
  credentials?: RequestCredentials;
  mode?: RequestMode;
  cache?: RequestCache;
  redirect?: RequestRedirect;
  referrerPolicy?: ReferrerPolicy;
  integrity?: string;
  keepalive?: boolean;
}

/**
 * Opciones que puede recibir el constructor del cliente o una llamada puntual.
 * Todo es opcional: lo que falte se toma de los valores por defecto.
 */
export type SmartFetchOptions = Partial<Omit<RequestConfig, 'url' | 'method'>>;

/** Opciones de una petición individual. */
export type RequestOptions = SmartFetchOptions;

/** Configuración de una petición cuando se usa el método genérico `request()`. */
export interface FullRequestOptions extends RequestOptions {
  url: string;
  method?: HttpMethod;
}

/**
 * Respuesta normalizada devuelta por SmartFetch.
 * @typeParam T - Tipo esperado del cuerpo deserializado.
 */
export interface SmartResponse<T = unknown> {
  /** Cuerpo ya deserializado. */
  data: T;
  /** Código de estado HTTP. */
  status: number;
  /** Texto del estado HTTP. */
  statusText: string;
  /** Cabeceras de respuesta, en minúsculas. */
  headers: Record<string, string>;
  /** Configuración con la que se ejecutó la petición. */
  config: RequestConfig;
  /** Número de intentos realizados (1 si no hubo reintentos). */
  attempts: number;
  /** Objeto `Response` nativo, por si se necesita acceso de bajo nivel. */
  raw: Response;
}

/**
 * Contexto compartido durante toda la ejecución de una petición.
 * Es el objeto que viaja por la cadena de aspectos (join point).
 */
export interface RequestContext {
  /** Configuración resuelta (los interceptores pueden reemplazarla). */
  config: RequestConfig;
  /** Intento actual (1-based), actualizado por el `RetryAspect`. */
  attempt: number;
  /** Marca de tiempo del inicio de la petición. */
  startedAt: number;
  /** Señal efectiva del intento actual (combina la del usuario y la del timeout). */
  signal?: AbortSignal;
  /** Metadatos libres compartidos entre aspectos. */
  meta: Record<string, unknown>;
}

/** Función que continúa la ejecución hacia el siguiente aspecto o hacia el núcleo. */
export type ProceedFn = () => Promise<SmartResponse<any>>;

/**
 * Aspecto (Programación Orientada a Aspectos).
 *
 * Permite inyectar comportamiento transversal (timeout, reintentos, logging,
 * autenticación, métricas...) sin ensuciar la lógica del cliente HTTP.
 * Los aspectos con `order` menor envuelven a los de `order` mayor.
 */
export interface Aspect {
  /** Identificador del aspecto. */
  readonly name: string;
  /** Orden de tejido; menor valor = más externo. Por defecto `100`. */
  readonly order?: number;
  /** Advice ejecutado antes de proceder. */
  before?(context: RequestContext): void | Promise<void>;
  /** Advice envolvente: controla la ejecución y puede repetirla o abortarla. */
  around?(context: RequestContext, proceed: ProceedFn): Promise<SmartResponse<any>>;
  /** Advice ejecutado cuando la petición finaliza con éxito. */
  afterReturning?(context: RequestContext, response: SmartResponse<any>): void | Promise<void>;
  /** Advice ejecutado cuando la petición finaliza con error. */
  afterThrowing?(context: RequestContext, error: SmartFetchError): void | Promise<void>;
  /** Advice final, se ejecuta siempre (éxito o error). */
  after?(context: RequestContext): void | Promise<void>;
}
