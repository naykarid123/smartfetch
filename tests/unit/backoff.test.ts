import { createBackoff, exponentialBackoff, fixedBackoff, linearBackoff, noBackoff } from '../../src';
import { parseRetryAfter, isRetryableStatus } from '../../src';

describe('estrategias de backoff (Strategy)', () => {
  it('fixed devuelve siempre el mismo retardo', () => {
    const strategy = fixedBackoff();
    expect(strategy.delay(1, 100)).toBe(100);
    expect(strategy.delay(5, 100)).toBe(100);
  });

  it('linear crece proporcionalmente al intento', () => {
    const strategy = linearBackoff();
    expect(strategy.delay(1, 100)).toBe(100);
    expect(strategy.delay(3, 100)).toBe(300);
  });

  it('exponential duplica el retardo en cada intento', () => {
    const strategy = exponentialBackoff();
    expect(strategy.delay(1, 100)).toBe(100);
    expect(strategy.delay(2, 100)).toBe(200);
    expect(strategy.delay(4, 100)).toBe(800);
  });

  it('respeta el tope maxDelay', () => {
    const strategy = exponentialBackoff({ maxDelay: 500 });
    expect(strategy.delay(10, 100)).toBe(500);
  });

  it('el jitter mantiene el retardo dentro del rango esperado', () => {
    const strategy = exponentialBackoff({ jitter: true });
    for (let i = 0; i < 20; i += 1) {
      const delay = strategy.delay(3, 100); // techo: 100 * 2^2 = 400
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(400);
    }
  });

  it('none no espera', () => {
    expect(noBackoff().delay(3, 1000)).toBe(0);
  });

  it('la factoría devuelve la estrategia solicitada', () => {
    expect(createBackoff('linear').name).toBe('linear');
    expect(createBackoff('exponential', { jitter: true }).name).toBe('exponential-jitter');
  });
});

describe('política de reintentos', () => {
  it('considera transitorios los 5xx, 408, 425 y 429', () => {
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(400)).toBe(false);
  });

  it('interpreta Retry-After en segundos', () => {
    expect(parseRetryAfter('2')).toBe(2000);
  });

  it('interpreta Retry-After como fecha HTTP', () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const delay = parseRetryAfter(future)!;
    expect(delay).toBeGreaterThan(3000);
    expect(delay).toBeLessThanOrEqual(6000);
  });

  it('devuelve null si la cabecera no es interpretable', () => {
    expect(parseRetryAfter(undefined)).toBeNull();
    expect(parseRetryAfter('mañana')).toBeNull();
  });
});
