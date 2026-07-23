import {
  SmartFetch,
  HttpResponseError,
  isNetworkError,
  isHttpResponseError,
  fixedBackoff,
  noBackoff,
} from '../../src';
import { jsonResponse, mockFetchSequence, networkFailure } from '../helpers/mockFetch';

describe('Reintentos (requisito funcional 2)', () => {
  it('por defecto realiza UN SOLO intento', async () => {
    const mock = mockFetchSequence([jsonResponse({ status: 500, body: {} })]);
    const client = new SmartFetch({ fetchImpl: mock.fetch });

    await client.get('https://api.test/x').catch(() => undefined);

    expect(mock.calls).toHaveLength(1);
  });

  it('reintenta ante errores 5xx hasta obtener respuesta válida', async () => {
    const mock = mockFetchSequence([
      jsonResponse({ status: 500, body: { error: 'boom' } }),
      jsonResponse({ status: 503, body: { error: 'boom' } }),
      jsonResponse({ status: 200, body: { ok: true } }),
    ]);
    const client = new SmartFetch({
      fetchImpl: mock.fetch,
      retries: 3,
      retryDelay: 0,
      backoff: noBackoff(),
    });

    const response = await client.get<{ ok: boolean }>('https://api.test/x');

    expect(mock.calls).toHaveLength(3);
    expect(response.data.ok).toBe(true);
    expect(response.attempts).toBe(3);
  });

  it('reintenta ante fallos de red', async () => {
    const mock = mockFetchSequence([
      networkFailure(),
      networkFailure(),
      jsonResponse({ body: { ok: true } }),
    ]);
    const client = new SmartFetch({ fetchImpl: mock.fetch, retries: 2, retryDelay: 0 });

    const response = await client.get('https://api.test/x');
    expect(response.attempts).toBe(3);
  });

  it('se rinde tras agotar los reintentos y propaga el último error', async () => {
    const mock = mockFetchSequence([networkFailure('sin conexión')]);
    const client = new SmartFetch({ fetchImpl: mock.fetch, retries: 2, retryDelay: 0 });

    const error = await client.get('https://api.test/x').catch((e: unknown) => e);

    expect(mock.calls).toHaveLength(3); // 1 intento + 2 reintentos
    expect(isNetworkError(error)).toBe(true);
    expect((error as Error & { attempts: number }).attempts).toBe(3);
  });

  it('NO reintenta ante errores 4xx del cliente', async () => {
    const mock = mockFetchSequence([jsonResponse({ status: 400, body: {} })]);
    const client = new SmartFetch({ fetchImpl: mock.fetch, retries: 5, retryDelay: 0 });

    const error = await client.get('https://api.test/x').catch((e: unknown) => e);

    expect(mock.calls).toHaveLength(1);
    expect(isHttpResponseError(error)).toBe(true);
  });

  it('SÍ reintenta ante 429 (Too Many Requests)', async () => {
    const mock = mockFetchSequence([
      jsonResponse({ status: 429, body: {} }),
      jsonResponse({ status: 200, body: { ok: true } }),
    ]);
    const client = new SmartFetch({ fetchImpl: mock.fetch, retries: 1, retryDelay: 0 });

    await expect(client.get('https://api.test/x')).resolves.toMatchObject({ attempts: 2 });
  });

  it('respeta la cabecera Retry-After', async () => {
    const mock = mockFetchSequence([
      jsonResponse({ status: 503, body: {}, headers: { 'retry-after': '0' } }),
      jsonResponse({ status: 200, body: { ok: true } }),
    ]);
    const client = new SmartFetch({
      fetchImpl: mock.fetch,
      retries: 1,
      retryDelay: 10_000, // se ignoraría si no se respetara Retry-After
      respectRetryAfter: true,
    });

    const start = Date.now();
    await client.get('https://api.test/x');
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('admite una política de reintento personalizada', async () => {
    const mock = mockFetchSequence([
      jsonResponse({ status: 404, body: {} }),
      jsonResponse({ status: 200, body: { ok: true } }),
    ]);
    const client = new SmartFetch({
      fetchImpl: mock.fetch,
      retries: 2,
      retryDelay: 0,
      // Política a medida: reintentar incluso ante 404.
      retryOn: (error) => isHttpResponseError(error) && error.status === 404,
    });

    await expect(client.get('https://api.test/x')).resolves.toMatchObject({ attempts: 2 });
  });

  it('aplica la estrategia de backoff entre intentos', async () => {
    const mock = mockFetchSequence([
      jsonResponse({ status: 500, body: {} }),
      jsonResponse({ status: 500, body: {} }),
      jsonResponse({ status: 200, body: {} }),
    ]);
    const client = new SmartFetch({
      fetchImpl: mock.fetch,
      retries: 2,
      retryDelay: 20,
      backoff: fixedBackoff(),
    });

    const start = Date.now();
    await client.get('https://api.test/x');
    const elapsed = Date.now() - start;

    // Dos esperas de ~20 ms entre los tres intentos.
    expect(elapsed).toBeGreaterThanOrEqual(35);
  });

  it('expone el detalle del último error HTTP tras agotar reintentos', async () => {
    const mock = mockFetchSequence([jsonResponse({ status: 500, body: { error: 'caído' } })]);
    const client = new SmartFetch({ fetchImpl: mock.fetch, retries: 1, retryDelay: 0 });

    const error = (await client
      .get('https://api.test/x')
      .catch((e: unknown) => e)) as HttpResponseError<{ error: string }>;

    expect(error.status).toBe(500);
    expect(error.data).toEqual({ error: 'caído' });
    expect(error.attempts).toBe(2);
  });
});
