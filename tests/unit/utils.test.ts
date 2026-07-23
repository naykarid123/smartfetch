import { buildURL, combineURLs, isAbsoluteURL, serializeParams } from '../../src/utils/url';
import { headersToObject, mergeHeaders, normalizeHeaders } from '../../src/utils/headers';
import { parseResponseBody, serializeBody } from '../../src/utils/body';
import { DEFAULT_CONFIG } from '../../src';
import type { RequestConfig } from '../../src';

const baseConfig = (overrides: Partial<RequestConfig> = {}): RequestConfig => ({
  ...DEFAULT_CONFIG,
  url: '/test',
  method: 'GET',
  ...overrides,
});

describe('utils/url', () => {
  it('detecta URLs absolutas', () => {
    expect(isAbsoluteURL('https://api.com/x')).toBe(true);
    expect(isAbsoluteURL('//cdn.com/x')).toBe(true);
    expect(isAbsoluteURL('/usuarios')).toBe(false);
  });

  it('combina base y ruta sin duplicar barras', () => {
    expect(combineURLs('https://api.com/v1/', '/usuarios')).toBe('https://api.com/v1/usuarios');
    expect(combineURLs('https://api.com/v1', 'usuarios')).toBe('https://api.com/v1/usuarios');
  });

  it('serializa parámetros omitiendo nulos y expandiendo arrays', () => {
    const query = serializeParams({ page: 1, activo: true, vacio: null, tags: ['a', 'b'] });
    expect(query).toBe('page=1&activo=true&tags=a&tags=b');
  });

  it('ignora la baseURL cuando la URL ya es absoluta', () => {
    expect(buildURL('https://otra.com/x', 'https://api.com')).toBe('https://otra.com/x');
  });

  it('preserva la query string existente al añadir params', () => {
    expect(buildURL('/buscar?q=ts', 'https://api.com', { page: 2 })).toBe(
      'https://api.com/buscar?q=ts&page=2',
    );
  });
});

describe('utils/headers', () => {
  it('normaliza las claves a minúsculas', () => {
    expect(normalizeHeaders({ 'Content-Type': 'application/json' })).toEqual({
      'content-type': 'application/json',
    });
  });

  it('fusiona dando prioridad a las últimas cabeceras', () => {
    const merged = mergeHeaders({ 'Content-Type': 'text/plain' }, { 'content-type': 'application/json' });
    expect(merged).toEqual({ 'content-type': 'application/json' });
  });

  it('convierte Headers nativas en objeto plano', () => {
    const headers = new Headers({ 'X-Total': '42' });
    expect(headersToObject(headers)).toEqual({ 'x-total': '42' });
  });
});

describe('utils/body', () => {
  it('serializa objetos planos a JSON y fija el content-type', () => {
    const { body, headers } = serializeBody({ nombre: 'Ada' }, {}, 'POST');
    expect(body).toBe('{"nombre":"Ada"}');
    expect(headers['content-type']).toBe('application/json');
  });

  it('no fija content-type cuando el cuerpo es FormData', () => {
    const form = new FormData();
    form.append('archivo', 'contenido');
    const { body, headers } = serializeBody(form, {}, 'POST');
    expect(body).toBe(form);
    expect(headers['content-type']).toBeUndefined();
  });

  it('respeta un content-type indicado por el usuario', () => {
    const { headers } = serializeBody({ a: 1 }, { 'content-type': 'application/vnd.api+json' }, 'PUT');
    expect(headers['content-type']).toBe('application/vnd.api+json');
  });

  it('nunca envía cuerpo en GET ni HEAD', () => {
    expect(serializeBody({ a: 1 }, {}, 'GET').body).toBeUndefined();
    expect(serializeBody({ a: 1 }, {}, 'HEAD').body).toBeUndefined();
  });

  it('deserializa JSON automáticamente según el content-type', async () => {
    const response = new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
    await expect(parseResponseBody(response, 'auto', baseConfig())).resolves.toEqual({ ok: true });
  });

  it('devuelve null en respuestas sin cuerpo (204)', async () => {
    const response = new Response(null, { status: 204 });
    await expect(parseResponseBody(response, 'auto', baseConfig())).resolves.toBeNull();
  });

  it('lanza ParseError si el JSON está malformado', async () => {
    const response = new Response('{no-json', { headers: { 'content-type': 'application/json' } });
    await expect(parseResponseBody(response, 'json', baseConfig())).rejects.toThrow(
      /No se pudo interpretar/,
    );
  });
});
