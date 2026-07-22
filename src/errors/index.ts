import type { RequestConfig, SmartResponse } from '../types';

/**
 * Códigos de error estables de SmartFetch.
 * Permiten discriminar la causa del fallo sin depender del mensaje.
 */
export enum SmartFetchErrorCode {
  /** La petición superó el tiempo máximo de espera. */
  TIMEOUT = 'ETIMEDOUT',
  /** Fallo de red / DNS / servidor inalcanzable. */
  NETWORK = 'ENETWORK',
  /** La respuesta llegó, pero su estado no supera `validateStatus`. */
  BAD_RESPONSE = 'EBADRESPONSE',
  /** La petición fue cancelada mediante un `AbortSignal` externo. */
  CANCELED = 'ECANCELED',
  /** El cuerpo de la respuesta no pudo deserializarse. */
  PARSE = 'EPARSE',
  /** Configuración inválida (por ejemplo, `fetch` no disponible). */
  CONFIG = 'ECONFIG',
  /** Causa desconocida. */
  UNKNOWN = 'EUNKNOWN',
}

/**
 * Error base de la librería. Todos los errores que SmartFetch propaga
 * heredan de esta clase, de modo que un único `catch` basta para tratarlos.
 */
export class SmartFetchError extends Error {
  /** Marca estructural para identificar errores de la librería sin `instanceof`. */
  public readonly isSmartFetchError = true as const;
  /** Código estable del error. */
  public readonly code: SmartFetchErrorCode;
  /** Configuración de la petición que falló. */
  public readonly config?: RequestConfig;
  /** Error original capturado (si lo hubo). */
  public readonly originalError?: unknown;
  /** Número de intentos realizados antes de rendirse. */
  public attempts: number;

  /**
   * @param message - Mensaje legible.
   * @param code - Código estable del error.
   * @param config - Configuración de la petición fallida.
   * @param originalError - Error subyacente, si existe.
   * @param attempts - Intentos realizados.
   */
  constructor(
    message: string,
    code: SmartFetchErrorCode = SmartFetchErrorCode.UNKNOWN,
    config?: RequestConfig,
    originalError?: unknown,
    attempts = 1,
  ) {
    super(message);
    // Necesario para que `instanceof` funcione al compilar a ES5/ES2015+.
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = new.target.name;
    this.code = code;
    this.config = config;
    this.originalError = originalError;
    this.attempts = attempts;
  }

  /**
   * Serializa el error de forma segura (sin volcar objetos nativos pesados).
   * @returns Representación plana apta para logs.
   */
  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      attempts: this.attempts,
      method: this.config?.method,
      url: this.config?.url,
    };
  }
}

/** Error lanzado cuando se agota el tiempo máximo de espera configurado. */
export class TimeoutError extends SmartFetchError {
  /** Milisegundos de timeout que se superaron. */
  public readonly timeout: number;

  /**
   * @param timeout - Timeout configurado, en milisegundos.
   * @param config - Configuración de la petición.
   * @param attempts - Intentos realizados.
   */
  constructor(timeout: number, config?: RequestConfig, attempts = 1) {
    super(
      `La petición ${config?.method ?? ''} ${config?.url ?? ''} excedió el tiempo máximo de ${timeout}ms`.trim(),
      SmartFetchErrorCode.TIMEOUT,
      config,
      undefined,
      attempts,
    );
    this.timeout = timeout;
  }
}

/** Error lanzado ante un fallo de red (servidor caído, DNS, CORS, offline...). */
export class NetworkError extends SmartFetchError {
  /**
   * @param originalError - Error lanzado por `fetch`.
   * @param config - Configuración de la petición.
   * @param attempts - Intentos realizados.
   */
  constructor(originalError: unknown, config?: RequestConfig, attempts = 1) {
    const detail = originalError instanceof Error ? originalError.message : String(originalError);
    super(
      `Fallo de red al solicitar ${config?.url ?? 'el recurso'}: ${detail}`,
      SmartFetchErrorCode.NETWORK,
      config,
      originalError,
      attempts,
    );
  }
}

/** Error lanzado cuando el usuario cancela la petición con un `AbortSignal`. */
export class CanceledError extends SmartFetchError {
  /**
   * @param config - Configuración de la petición.
   * @param attempts - Intentos realizados.
   */
  constructor(config?: RequestConfig, attempts = 1) {
    super('La petición fue cancelada', SmartFetchErrorCode.CANCELED, config, undefined, attempts);
  }
}

/** Error lanzado cuando el cuerpo de la respuesta no se pudo deserializar. */
export class ParseError extends SmartFetchError {
  /**
   * @param originalError - Error de deserialización.
   * @param config - Configuración de la petición.
   */
  constructor(originalError: unknown, config?: RequestConfig) {
    super(
      `No se pudo interpretar el cuerpo de la respuesta de ${config?.url ?? 'el recurso'}`,
      SmartFetchErrorCode.PARSE,
      config,
      originalError,
    );
  }
}

/** Error de configuración (por ejemplo, no existe `fetch` en el entorno). */
export class ConfigurationError extends SmartFetchError {
  /** @param message - Detalle del problema de configuración. */
  constructor(message: string) {
    super(message, SmartFetchErrorCode.CONFIG);
  }
}

/**
 * Error lanzado cuando el servidor respondió con un estado no válido
 * según `validateStatus` (por defecto, fuera del rango 2xx).
 * Expone la respuesta completa para poder leer el cuerpo del error.
 * @typeParam T - Tipo del cuerpo de la respuesta de error.
 */
export class HttpResponseError<T = unknown> extends SmartFetchError {
  /** Respuesta normalizada que provocó el error. */
  public readonly response: SmartResponse<T>;

  /**
   * @param response - Respuesta con estado inválido.
   * @param attempts - Intentos realizados.
   */
  constructor(response: SmartResponse<T>, attempts = 1) {
    super(
      `La petición ${response.config.method} ${response.config.url} falló con estado ${response.status} (${response.statusText})`,
      SmartFetchErrorCode.BAD_RESPONSE,
      response.config,
      undefined,
      attempts,
    );
    this.response = response;
  }

  /** Código de estado HTTP devuelto por el servidor. */
  public get status(): number {
    return this.response.status;
  }

  /** Cuerpo del error ya deserializado. */
  public get data(): T {
    return this.response.data;
  }
}

/**
 * Comprueba si un valor es un error de SmartFetch.
 * @param value - Valor a inspeccionar.
 */
export function isSmartFetchError(value: unknown): value is SmartFetchError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { isSmartFetchError?: boolean }).isSmartFetchError === true
  );
}

/**
 * Comprueba si el error se debe a un timeout.
 * @param value - Valor a inspeccionar.
 */
export function isTimeoutError(value: unknown): value is TimeoutError {
  return isSmartFetchError(value) && value.code === SmartFetchErrorCode.TIMEOUT;
}

/**
 * Comprueba si el error se debe a un fallo de red.
 * @param value - Valor a inspeccionar.
 */
export function isNetworkError(value: unknown): value is NetworkError {
  return isSmartFetchError(value) && value.code === SmartFetchErrorCode.NETWORK;
}

/**
 * Comprueba si el error corresponde a una respuesta HTTP con estado inválido.
 * @param value - Valor a inspeccionar.
 */
export function isHttpResponseError<T = unknown>(value: unknown): value is HttpResponseError<T> {
  return isSmartFetchError(value) && value.code === SmartFetchErrorCode.BAD_RESPONSE;
}

/**
 * Comprueba si la petición fue cancelada por el usuario.
 * @param value - Valor a inspeccionar.
 */
export function isCanceledError(value: unknown): value is CanceledError {
  return isSmartFetchError(value) && value.code === SmartFetchErrorCode.CANCELED;
}

/**
 * Normaliza cualquier valor lanzado a un `SmartFetchError`.
 * Garantiza que la librería nunca propague errores desconocidos.
 * @param value - Valor capturado en un `catch`.
 * @param config - Configuración de la petición en curso.
 */
export function toSmartFetchError(value: unknown, config?: RequestConfig): SmartFetchError {
  if (isSmartFetchError(value)) return value;
  const message = value instanceof Error ? value.message : String(value);
  return new SmartFetchError(message, SmartFetchErrorCode.UNKNOWN, config, value);
}
