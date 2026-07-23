import { SmartFetch, TimeoutError, isTimeoutError, isCanceledError } from '../../src';
import { hangingFetch, jsonResponse, mockFetchSequence } from '../helpers/mockFetch';

describe('Timeout (requisito funcional 1)', () => {
  it('cancela la petición y lanza TimeoutError si el servidor no responde', async () => {
    const mock = hangingFetch();
    const client = new SmartFetch({ fetchImpl: mock.fetch, timeout: 30 });

    const error = await client.get('https://api.test/lento').catch((e: unknown) => e);

    expect(isTimeoutError(error)).toBe(true);
    expect((error as TimeoutError).timeout).toBe(30);
    expect((error as TimeoutError).code).toBe('ETIMEDOUT');
  });

  it('aborta REALMENTE la petición subyacente (no la deja colgada)', async () => {
    const mock = hangingFetch();
    const client = new SmartFetch({ fetchImpl: mock.fetch, timeout: 20 });

    await client.get('https://api.test/lento').catch(() => undefined);

    // La señal que recibió `fetch` debe haber sido abortada por el timeout.
    expect(mock.calls[0]!.init.signal!.aborted).toBe(true);
  });

  it('no aplica timeout cuando vale 0 (valor por defecto)', async () => {
    const mock = mockFetchSequence([jsonResponse({ body: { ok: true } })]);
    const client = new SmartFetch({ fetchImpl: mock.fetch });

    await expect(client.get('https://api.test/x')).resolves.toMatchObject({ status: 200 });
    expect(mock.calls[0]!.init.signal).toBeUndefined();
  });

  it('el timeout de la petición sobrescribe el del cliente', async () => {
    const mock = hangingFetch();
    const client = new SmartFetch({ fetchImpl: mock.fetch, timeout: 5000 });

    const start = Date.now();
    await client.get('https://api.test/lento', { timeout: 25 }).catch(() => undefined);

    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('cada reintento estrena su propio reloj de timeout', async () => {
    const mock = hangingFetch();
    const client = new SmartFetch({
      fetchImpl: mock.fetch,
      timeout: 20,
      retries: 2,
      retryDelay: 0,
    });

    const error = await client.get('https://api.test/lento').catch((e: unknown) => e);

    // 3 intentos completos, cada uno con su propio timeout de 20 ms.
    expect(mock.calls).toHaveLength(3);
    expect(isTimeoutError(error)).toBe(true);
    expect((error as TimeoutError).attempts).toBe(3);
  });
});

describe('Cancelación manual con AbortSignal', () => {
  it('lanza CanceledError (y no TimeoutError) cuando cancela el usuario', async () => {
    const mock = hangingFetch();
    const client = new SmartFetch({ fetchImpl: mock.fetch, timeout: 5000 });
    const controller = new AbortController();

    const promise = client.get('https://api.test/x', { signal: controller.signal });
    controller.abort();

    const error = await promise.catch((e: unknown) => e);
    expect(isCanceledError(error)).toBe(true);
    expect(isTimeoutError(error)).toBe(false);
  });

  it('una cancelación del usuario NO se reintenta', async () => {
    const mock = hangingFetch();
    const client = new SmartFetch({ fetchImpl: mock.fetch, retries: 3, retryDelay: 0 });
    const controller = new AbortController();

    const promise = client.get('https://api.test/x', { signal: controller.signal });
    controller.abort();
    await promise.catch(() => undefined);

    expect(mock.calls).toHaveLength(1);
  });
});
