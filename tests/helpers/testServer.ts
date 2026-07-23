import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

/** Servidor HTTP real usado en las pruebas de integración. */
export interface TestServer {
  /** URL base, por ejemplo `http://127.0.0.1:53123`. */
  baseURL: string;
  /** Número de veces que se ha llamado a cada ruta. */
  hits: Record<string, number>;
  /** Cierra el servidor. */
  close: () => Promise<void>;
}

/** Lee el cuerpo completo de una petición entrante. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
  });
}

/**
 * Levanta un servidor HTTP real en un puerto libre con endpoints pensados
 * para ejercitar la librería de extremo a extremo.
 *
 * Endpoints:
 * - `/echo`            -> devuelve método, cabeceras, query y cuerpo recibidos.
 * - `/flaky`           -> falla con 500 las 2 primeras veces y luego responde 200.
 * - `/slow`            -> tarda 300 ms en responder (para probar timeouts).
 * - `/status/:code`    -> responde con el código indicado.
 * - `/no-content`      -> responde 204 sin cuerpo.
 * - `/rate-limited`    -> responde 429 con `Retry-After: 0` la primera vez.
 */
export async function startTestServer(): Promise<TestServer> {
  const hits: Record<string, number> = {};

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    hits[path] = (hits[path] ?? 0) + 1;

    const json = (status: number, payload: unknown, headers: Record<string, string> = {}): void => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(payload));
    };

    if (path === '/echo') {
      const body = await readBody(req);
      json(200, {
        method: req.method,
        headers: req.headers,
        query: Object.fromEntries(url.searchParams.entries()),
        body: body ? (JSON.parse(body) as unknown) : null,
      });
      return;
    }

    if (path === '/flaky') {
      if (hits[path]! <= 2) {
        json(500, { error: 'servidor inestable' });
        return;
      }
      json(200, { ok: true, attempts: hits[path] });
      return;
    }

    if (path === '/slow') {
      setTimeout(() => json(200, { ok: true }), 300);
      return;
    }

    if (path === '/rate-limited') {
      if (hits[path] === 1) {
        json(429, { error: 'demasiadas peticiones' }, { 'retry-after': '0' });
        return;
      }
      json(200, { ok: true });
      return;
    }

    if (path === '/no-content') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (path.startsWith('/status/')) {
      const code = Number(path.split('/')[2]);
      json(code, { error: `estado ${code}` });
      return;
    }

    json(404, { error: 'no encontrado' });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseURL: `http://127.0.0.1:${port}`,
    hits,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
