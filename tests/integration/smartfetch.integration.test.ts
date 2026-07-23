import { SmartFetch, isTimeoutError, isHttpResponseError, noBackoff } from '../../src';
import { startTestServer, type TestServer } from '../helpers/testServer';

/**
 * Pruebas de INTEGRACIÓN.
 *
 * A diferencia de las unitarias, aquí NO se inyecta ningún mock: se usa el
 * `fetch` nativo del runtime contra un servidor HTTP real levantado con
 * `node:http`. Verifican que la librería funciona de extremo a extremo con su
 * colaborador externo (la red y la API `fetch` del entorno).
 */
describe('Integración: SmartFetch contra un servidor HTTP real', () => {
  let server: TestServer;
  let api: SmartFetch;

  beforeAll(async () => {
    server = await startTestServer();
    api = new SmartFetch({ baseURL: server.baseURL, timeout: 2000 });
  });

  afterAll(async () => {
    await server.close();
  });

  describe('métodos HTTP', () => {
    it('GET envía la query string y recibe JSON', async () => {
      const { data, status } = await api.get<{ method: string; query: Record<string, string> }>(
        '/echo',
        { params: { page: 2 } },
      );

      expect(status).toBe(200);
      expect(data.method).toBe('GET');
      expect(data.query).toEqual({ page: '2' });
    });

    it('POST envía el cuerpo serializado como JSON', async () => {
      const { data, status } = await api.post<{ method: string; body: unknown }>('/echo', {
        nombre: 'Ada',
      });

      expect(status).toBe(200);
      expect(data.method).toBe('POST');
      expect(data.body).toEqual({ nombre: 'Ada' });
    });

    it('PUT reemplaza el recurso', async () => {
      const { data } = await api.put<{ method: string; body: unknown }>('/echo', { id: 1 });
      expect(data.method).toBe('PUT');
      expect(data.body).toEqual({ id: 1 });
    });

    it('PATCH envía una modificación parcial', async () => {
      const { data } = await api.patch<{ method: string; body: unknown }>('/echo', { activo: false });
      expect(data.method).toBe('PATCH');
      expect(data.body).toEqual({ activo: false });
    });

    it('DELETE elimina el recurso', async () => {
      const { data } = await api.delete<{ method: string }>('/echo');
      expect(data.method).toBe('DELETE');
    });

    it('maneja respuestas 204 sin cuerpo', async () => {
      const { status, data } = await api.get('/no-content');
      expect(status).toBe(204);
      expect(data).toBeNull();
    });

    it('envía las cabeceras configuradas', async () => {
      const { data } = await api.get<{ headers: Record<string, string> }>('/echo', {
        headers: { 'x-api-key': 'secreta' },
      });
      expect(data.headers['x-api-key']).toBe('secreta');
    });
  });

  describe('timeout real', () => {
    it('aborta la conexión si el servidor tarda demasiado', async () => {
      const error = await api.get('/slow', { timeout: 50 }).catch((e: unknown) => e);
      expect(isTimeoutError(error)).toBe(true);
    });

    it('no aborta si el servidor responde dentro del plazo', async () => {
      await expect(api.get('/slow', { timeout: 2000 })).resolves.toMatchObject({ status: 200 });
    });
  });

  describe('reintentos reales', () => {
    it('se recupera de un endpoint inestable que falla dos veces con 500', async () => {
      const resilient = new SmartFetch({
        baseURL: server.baseURL,
        retries: 3,
        retryDelay: 10,
        backoff: noBackoff(),
      });

      const { data, status, attempts } = await resilient.get<{ ok: boolean }>('/flaky');

      expect(status).toBe(200);
      expect(data.ok).toBe(true);
      expect(attempts).toBe(3);
      expect(server.hits['/flaky']).toBe(3);
    });

    it('respeta Retry-After ante un 429', async () => {
      const resilient = new SmartFetch({ baseURL: server.baseURL, retries: 2, retryDelay: 5 });
      await expect(resilient.get('/rate-limited')).resolves.toMatchObject({ status: 200 });
    });
  });

  describe('errores HTTP reales', () => {
    it('lanza HttpResponseError ante un 404 e incluye el cuerpo', async () => {
      const error = await api.get('/status/404').catch((e: unknown) => e);

      expect(isHttpResponseError(error)).toBe(true);
      if (isHttpResponseError<{ error: string }>(error)) {
        expect(error.status).toBe(404);
        expect(error.data.error).toBe('estado 404');
      }
    });

    it('no reintenta un 404 aunque haya reintentos configurados', async () => {
      const before = server.hits['/status/400'] ?? 0;
      const client = new SmartFetch({ baseURL: server.baseURL, retries: 3, retryDelay: 0 });

      await client.get('/status/400').catch(() => undefined);

      expect((server.hits['/status/400'] ?? 0) - before).toBe(1);
    });
  });

  describe('cancelación real', () => {
    it('cancela una petición en vuelo con AbortSignal', async () => {
      const controller = new AbortController();
      const promise = api.get('/slow', { signal: controller.signal, timeout: 5000 });
      setTimeout(() => controller.abort(), 20);

      await expect(promise).rejects.toMatchObject({ code: 'ECANCELED' });
    });
  });

  describe('interceptores en un flujo real', () => {
    it('inyecta un token de autenticación en cada petición', async () => {
      const client = new SmartFetch({ baseURL: server.baseURL });
      client.interceptors.request.use((config) => {
        config.headers.authorization = 'Bearer token-real';
        return config;
      });

      const { data } = await client.get<{ headers: Record<string, string> }>('/echo');
      expect(data.headers.authorization).toBe('Bearer token-real');
    });
  });
});
