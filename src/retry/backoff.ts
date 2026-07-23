import type { BackoffStrategy } from '../types';

/** Opciones comunes de las estrategias de espera. */
export interface BackoffOptions {
  /** Tope máximo de espera, en milisegundos. Por defecto, 30 000. */
  maxDelay?: number;
  /** Añade aleatoriedad para evitar el efecto "thundering herd". */
  jitter?: boolean;
}

/** Aplica el tope máximo y descarta valores negativos. */
function clamp(value: number, maxDelay: number): number {
  return Math.max(0, Math.min(value, maxDelay));
}

/** Aplica "full jitter": un valor aleatorio entre 0 y el retardo calculado. */
function applyJitter(value: number, jitter: boolean): number {
  return jitter ? Math.random() * value : value;
}

/**
 * Estrategia de espera constante: siempre el mismo retardo.
 * @param options - Tope máximo y jitter opcionales.
 * @returns Estrategia lista para usar en `retryDelay`.
 * @example
 * const client = new SmartFetch({ retries: 3, retryDelay: 200, backoff: fixedBackoff() });
 */
export function fixedBackoff(options: BackoffOptions = {}): BackoffStrategy {
  const { maxDelay = 30_000, jitter = false } = options;
  return {
    name: 'fixed',
    delay: (_attempt: number, baseDelay: number): number =>
      clamp(applyJitter(baseDelay, jitter), maxDelay),
  };
}

/**
 * Estrategia de espera lineal: `baseDelay * intento`.
 * @param options - Tope máximo y jitter opcionales.
 * @returns Estrategia lista para usar.
 */
export function linearBackoff(options: BackoffOptions = {}): BackoffStrategy {
  const { maxDelay = 30_000, jitter = false } = options;
  return {
    name: 'linear',
    delay: (attempt: number, baseDelay: number): number =>
      clamp(applyJitter(baseDelay * attempt, jitter), maxDelay),
  };
}

/**
 * Estrategia de espera exponencial: `baseDelay * 2^(intento-1)`.
 * Es la recomendada para servicios en producción, idealmente con `jitter`.
 * @param options - Tope máximo y jitter opcionales.
 * @returns Estrategia lista para usar.
 * @example
 * const backoff = exponentialBackoff({ jitter: true, maxDelay: 5000 });
 */
export function exponentialBackoff(options: BackoffOptions = {}): BackoffStrategy {
  const { maxDelay = 30_000, jitter = false } = options;
  return {
    name: jitter ? 'exponential-jitter' : 'exponential',
    delay: (attempt: number, baseDelay: number): number =>
      clamp(applyJitter(baseDelay * 2 ** (attempt - 1), jitter), maxDelay),
  };
}

/**
 * Estrategia de espera nula: reintenta de inmediato.
 * @returns Estrategia sin espera.
 */
export function noBackoff(): BackoffStrategy {
  return { name: 'none', delay: (): number => 0 };
}

/** Nombres de estrategia admitidos por la factoría. */
export type BackoffName = 'fixed' | 'linear' | 'exponential' | 'none';

/**
 * Factoría de estrategias de espera (patrón Factory).
 * @param name - Nombre de la estrategia deseada.
 * @param options - Tope máximo y jitter opcionales.
 * @returns Estrategia correspondiente.
 */
export function createBackoff(name: BackoffName, options: BackoffOptions = {}): BackoffStrategy {
  switch (name) {
    case 'fixed':
      return fixedBackoff(options);
    case 'linear':
      return linearBackoff(options);
    case 'exponential':
      return exponentialBackoff(options);
    case 'none':
      return noBackoff();
    default:
      return exponentialBackoff(options);
  }
}
