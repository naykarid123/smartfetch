import { SmartFetch, HttpResponseError, isHttpResponseError } from '../../src';
import { jsonResponse, mockFetchSequence } from '../helpers/mockFetch';

describe('SmartFetch: métodos HTTP (requisito funcional 3)', () => {
  it.each(['GET', 'DELETE', 'HEAD', 'OPTIONS'] as const)(
    'envía correctamente una petición %s',
    async (method) => {
      const mock = mockFetchSequence([jsonResponse({ body: { ok: true } })]);
      const client = new SmartFetch({ baseURL: 'https://api.test', fetchImpl: mock.fetch });

      const fn = {
        GET: () => client.get('/recurso'),
        DELETE: () => client.delete('/recurso'),
        HEAD: () => client.head('/recurso'),
        OPTIONS: () => client.options('/recurso'),
      }[method];

      const response = await fn();

      expect(mock.calls[0]!.init.method).toBe(method);
      expect(mock.calls[0]!.url).toBe('https://api.test/recurso');
      expect(response.status).toBe(200);
    },
  );

  it.each(['POST', 'PUT', 'PATCH'] as const)(
    'envía %s con el cuerpo serializado a JSON',
    async (method) => {
      const mock = mockFetchSequence([jsonResponse({ status: 201, body: { id: 1 } })]);
      const client = new SmartFetch({ baseURL: 'https://api.test', fetchImpl: mock.fetch });
      const payload = { nombre: 'Ada' };

      const fn = {
        POST: () => client.post('/usuarios', payload),
        PUT: () => client.put('/usuarios/1', payload),
        PATCH: () => client.patch('/usuarios/1', payload),
      }[method];

      const response = await fn();
      const call = mock.calls[0]!;

      expect(call.init.method).toBe(method);
      expect(call.init.body).toBe('{"nombre":"Ada"}');
      expect((call.init.headers as Record<string, string>)['content-type']).toBe('application/json');
      expect(response.data).toEqual({ id: 1 });
      expect(response.status).toBe(201);
    },
  );

  it('deserializa la respuesta y expone status, headers y attempts', async () => {
    const mock = mockFetchSequence([
      jsonResponse({ body: { nombre: 'Ada' }, headers: { 'x-total': '1' } }),
    ]);
    const client = new SmartFetch({ fetchImpl: mock.fetch });

    const response = await client.get<{ nombre: string }>('https://api.test/usuarios/1');

    expect(response.data.nombre).toBe('Ada');
    expect(response.status).toBe(200);
    expect(response.headers['x-total']).toBe('1');
    expect(response.attempts).toBe(1);
    expect(response.raw).toBeInstanceOf(Response);
  });

  it('añade los params a la query string', async () => {
    const mock = mockFetchSequence([jsonResponse()]);
    const client = new SmartFetch({ baseURL: 'https://api.test', fetchImpl: mock.fetch });

    await client.get('/usuarios', { params: { page: 2, activo: true } });

    expect(mock.calls[0]!.url).toBe('https://api.test/usuarios?page=2&activo=true');
  });

  it('fusiona las cabeceras del cliente con las de la petición', async () => {
    const mock = mockFetchSequence([jsonResponse()]);
    const client = new SmartFetch({
      baseURL: 'https://api.test',
      fetchImpl: mock.fetch,
      headers: { authorization: 'Bearer token', 'x-app': 'demo' },
    });

    await client.get('/usuarios', { headers: { 'x-app': 'override' } });
    const headers = mock.calls[0]!.init.headers as Record<string, string>;

    expect(headers.authorization).toBe('Bearer token');
    expect(headers['x-app']).toBe('override');
  });

  it('lanza HttpResponseError ante un 4xx e incluye el cuerpo del error', async () => {
    const mock = mockFetchSequence([jsonResponse({ status: 404, body: { error: 'no existe' } })]);
    const client = new SmartFetch({ fetchImpl: mock.fetch });

    expect.assertions(3);
    try {
      await client.get('https://api.test/nada');
    } catch (error) {
      expect(isHttpResponseError(error)).toBe(true);
      expect((error as HttpResponseError).status).toBe(404);
      expect((error as HttpResponseError<{ error: string }>).data).toEqual({ error: 'no existe' });
    }
  });

  it('permite personalizar validateStatus', async () => {
    const mock = mockFetchSequence([jsonResponse({ status: 404, body: {} })]);
    const client = new SmartFetch({
      fetchImpl: mock.fetch,
      validateStatus: (status) => status < 500,
    });

    await expect(client.get('https://api.test/nada')).resolves.toMatchObject({ status: 404 });
  });
});

describe('SmartFetch: async/await y promesas (requisito funcional 4)', () => {
  it('funciona con async/await', async () => {
    const mock = mockFetchSequence([jsonResponse({ body: { ok: true } })]);
    const client = new SmartFetch({ fetchImpl: mock.fetch });

    const { data } = await client.get<{ ok: boolean }>('https://api.test/x');
    expect(data.ok).toBe(true);
  });

  it('funciona encadenando .then()', () =>
    new SmartFetch({ fetchImpl: mockFetchSequence([jsonResponse({ body: { ok: true } })]).fetch })
      .get<{ ok: boolean }>('https://api.test/x')
      .then((response) => {
        expect(response.data.ok).toBe(true);
      }));

  it('los errores se capturan con .catch()', () => {
    const mock = mockFetchSequence([jsonResponse({ status: 500, body: {} })]);
    return new SmartFetch({ fetchImpl: mock.fetch })
      .get('https://api.test/x')
      .then(() => {
        throw new Error('no debería resolverse');
      })
      .catch((error: unknown) => {
        expect(isHttpResponseError(error)).toBe(true);
      });
  });
});

describe('SmartFetch: factoría y herencia de configuración', () => {
  it('create() genera instancias independientes', () => {
    const a = SmartFetch.create({ baseURL: 'https://a.test' });
    const b = SmartFetch.create({ baseURL: 'https://b.test' });
    expect(a).not.toBe(b);
    expect(a.defaults.baseURL).toBe('https://a.test');
    expect(b.defaults.baseURL).toBe('https://b.test');
  });

  it('extend() hereda y sobrescribe opciones', async () => {
    const mock = mockFetchSequence([jsonResponse()]);
    const base = new SmartFetch({
      baseURL: 'https://api.test',
      headers: { authorization: 'Bearer t' },
      fetchImpl: mock.fetch,
    });
    const child = base.extend({ headers: { 'x-scope': 'admin' } });

    await child.get('/x');
    const headers = mock.calls[0]!.init.headers as Record<string, string>;

    expect(headers.authorization).toBe('Bearer t');
    expect(headers['x-scope']).toBe('admin');
  });
});
