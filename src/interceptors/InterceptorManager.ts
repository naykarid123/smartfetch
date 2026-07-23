/** Handler que transforma un valor (config o respuesta) antes de continuar. */
export type FulfilledHandler<V> = (value: V) => V | Promise<V>;

/** Handler que recibe el error; puede relanzarlo o devolver un valor de recuperación. */
export type RejectedHandler<V> = (error: unknown) => V | Promise<V> | never;

/** Par de handlers registrado en el gestor. */
export interface InterceptorHandler<V> {
  onFulfilled?: FulfilledHandler<V>;
  onRejected?: RejectedHandler<V>;
}

/**
 * Gestor de interceptores (patrón Observer / middleware).
 *
 * Permite registrar transformaciones sobre las peticiones (por ejemplo, añadir
 * un token) y sobre las respuestas (por ejemplo, desenvolver `data.data`),
 * pudiendo eliminarlas después.
 *
 * @typeParam V - Tipo del valor interceptado (`RequestConfig` o `SmartResponse`).
 */
export class InterceptorManager<V> {
  private readonly handlers: Array<InterceptorHandler<V> | null> = [];

  /**
   * Registra un interceptor.
   * @param onFulfilled - Transformación del valor.
   * @param onRejected - Manejador de errores.
   * @returns Identificador que permite eliminarlo con {@link eject}.
   * @example
   * const id = client.interceptors.request.use((config) => {
   *   config.headers.authorization = `Bearer ${token}`;
   *   return config;
   * });
   */
  public use(onFulfilled?: FulfilledHandler<V>, onRejected?: RejectedHandler<V>): number {
    this.handlers.push({ onFulfilled, onRejected });
    return this.handlers.length - 1;
  }

  /**
   * Elimina un interceptor previamente registrado.
   * @param id - Identificador devuelto por {@link use}.
   */
  public eject(id: number): void {
    if (this.handlers[id]) this.handlers[id] = null;
  }

  /** Elimina todos los interceptores registrados. */
  public clear(): void {
    this.handlers.length = 0;
  }

  /**
   * Devuelve los interceptores activos, en orden de registro.
   * @returns Lista de handlers vivos.
   */
  public list(): Array<InterceptorHandler<V>> {
    return this.handlers.filter((handler): handler is InterceptorHandler<V> => handler !== null);
  }

  /** Número de interceptores activos. */
  public get size(): number {
    return this.list().length;
  }
}
