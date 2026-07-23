import { SmartFetch, isHttpResponseError } from '../../src';
import type { SmartResponse } from '../../src';
import { jsonResponse, mockFetchSequence } from '../helpers/mockFetch';

describe('Interceptores', () => {
  it('un interceptor de petición puede añadir cabeceras', async () => {
    const mock = mockFetchSequence([jsonResponse()]);
    const client = new SmartFetch({ fetchImpl: mock.fetch });

    client.interceptors.request.use((config) => {
      config.headers.authorization = 'Bearer 123';
      return config;
    });

    await client.get('https://api.test/x');
    const headers = mock.calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer 123');
  });

  it('un interceptor de respuesta puede transformar los datos', async () => {
    const mock = mockFetchSequence([jsonResponse({ body: { data: { id: 1 } } })]);
    const client = new SmartFetch({ fetchImpl: mock.fetch });

    client.interceptors.response.use((response: SmartResponse<any>) => {
      response.data = response.data.data; // desenvuelve la envoltura de la API
      return response;
    });

    const response = await client.get<{ id: number }>('https://api.test/x');
    expect(response.data).toEqual({ id: 1 });
  });

  it('un interceptor de error puede recuperarse y devolver una respuesta', async () => {
    const mock = mockFetchSequence([jsonResponse({ status: 500, body: {} })]);
    const client = new SmartFetch({ fetchImpl: mock.fetch });

    client.interceptors.response.use(undefined, () => {
      return { data: { fallback: true }, status: 200, attempts: 1 } as SmartResponse<any>;
    });

    const response = await client.get<{ fallback: boolean }>('https://api.test/x');
    expect(response.data.fallback).toBe(true);
  });

  it('los interceptores se ejecutan UNA vez, no una por reintento', async () => {
    const spy = jest.fn((config: any) => config);
    const mock = mockFetchSequence([
      jsonResponse({ status: 500, body: {} }),
      jsonResponse({ status: 500, body: {} }),
      jsonResponse({ status: 200, body: {} }),
    ]);
    const client = new SmartFetch({ fetchImpl: mock.fetch, retries: 2, retryDelay: 0 });
    client.interceptors.request.use(spy);

    await client.get('https://api.test/x');

    expect(mock.calls).toHaveLength(3);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('eject() y clear() eliminan interceptores', async () => {
    const mock = mockFetchSequence([jsonResponse()]);
    const client = new SmartFetch({ fetchImpl: mock.fetch });

    const id = client.interceptors.request.use((config) => {
      config.headers['x-uno'] = '1';
      return config;
    });
    client.interceptors.request.use((config) => {
      config.headers['x-dos'] = '2';
      return config;
    });

    expect(client.interceptors.request.size).toBe(2);
    client.interceptors.request.eject(id);
    expect(client.interceptors.request.size).toBe(1);

    await client.get('https://api.test/x');
    const headers = mock.calls[0]!.init.headers as Record<string, string>;
    expect(headers['x-uno']).toBeUndefined();
    expect(headers['x-dos']).toBe('2');

    client.interceptors.request.clear();
    expect(client.interceptors.request.size).toBe(0);
  });

  it('si ningún interceptor de error se recupera, el error se propaga', async () => {
    const mock = mockFetchSequence([jsonResponse({ status: 500, body: {} })]);
    const client = new SmartFetch({ fetchImpl: mock.fetch });

    client.interceptors.response.use(undefined, (error) => {
      throw error;
    });

    const error = await client.get('https://api.test/x').catch((e: unknown) => e);
    expect(isHttpResponseError(error)).toBe(true);
  });
});
