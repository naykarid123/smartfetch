/**
 * example.ts — Ejemplo de uso de SmartFetch.
 *
 * Ejecutar con:  npm run example
 *
 * Usa la API pública de JSONPlaceholder, así que necesita conexión a internet.
 * Cada bloque demuestra una capacidad concreta de la librería.
 */

import smartfetch, {
  SmartFetch,
  LoggingAspect,
  exponentialBackoff,
  isTimeoutError,
  isHttpResponseError,
  isNetworkError,
  type Aspect,
} from './src';

/** Modelo de ejemplo devuelto por la API. */
interface Post {
  id: number;
  userId: number;
  title: string;
  body: string;
}

// ---------------------------------------------------------------------------
// 1. Cliente configurado: baseURL, timeout y reintentos.
// ---------------------------------------------------------------------------
const api = SmartFetch.create({
  baseURL: 'https://jsonplaceholder.typicode.com',
  timeout: 5000, // 5 s: si el servidor no responde, se cancela la petición
  retries: 3, // 3 reintentos adicionales (4 intentos en total)
  retryDelay: 300, // retardo base
  backoff: exponentialBackoff({ jitter: true, maxDelay: 5000 }),
  headers: { accept: 'application/json' },
});

// ---------------------------------------------------------------------------
// 2. Interceptores: autenticación y trazas de respuesta.
// ---------------------------------------------------------------------------
api.interceptors.request.use((config) => {
  config.headers.authorization = 'Bearer token-de-ejemplo';
  return config;
});

api.interceptors.response.use((response) => {
  console.log(`   [interceptor] ${response.status} en ${response.attempts} intento/s`);
  return response;
});

// ---------------------------------------------------------------------------
// 3. Aspecto propio (POA): mide la duración de cada petición.
// ---------------------------------------------------------------------------
const metricsAspect: Aspect = {
  name: 'metrics',
  order: 1,
  before: (context) => {
    context.meta.t0 = Date.now();
  },
  after: (context) => {
    const elapsed = Date.now() - (context.meta.t0 as number);
    console.log(`   [métricas] ${context.config.method} ${context.config.url} -> ${elapsed}ms`);
  },
};

api.use(metricsAspect).use(new LoggingAspect());
api.defaults.logger = console;

/** Punto de entrada del ejemplo. */
async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  // GET con async/await + parámetros de query
  // -------------------------------------------------------------------------
  console.log('\n1) GET /posts?_limit=3');
  const { data: posts, status } = await api.get<Post[]>('/posts', { params: { _limit: 3 } });
  console.log(`   status ${status}, ${posts.length} posts:`, posts.map((p) => p.title.slice(0, 25)));

  // -------------------------------------------------------------------------
  // POST — el objeto se serializa a JSON automáticamente
  // -------------------------------------------------------------------------
  console.log('\n2) POST /posts');
  const { data: creado } = await api.post<Post>('/posts', {
    title: 'SmartFetch',
    body: 'Un wrapper avanzado sobre fetch',
    userId: 1,
  });
  console.log('   creado con id:', creado.id);

  // -------------------------------------------------------------------------
  // PUT y PATCH
  // -------------------------------------------------------------------------
  console.log('\n3) PUT y PATCH /posts/1');
  const { data: reemplazado } = await api.put<Post>('/posts/1', {
    id: 1,
    title: 'Título reemplazado',
    body: '...',
    userId: 1,
  });
  const { data: parcheado } = await api.patch<Post>('/posts/1', { title: 'Solo el título' });
  console.log('   PUT ->', reemplazado.title, '| PATCH ->', parcheado.title);

  // -------------------------------------------------------------------------
  // DELETE
  // -------------------------------------------------------------------------
  console.log('\n4) DELETE /posts/1');
  const { status: statusDelete } = await api.delete('/posts/1');
  console.log('   status:', statusDelete);

  // -------------------------------------------------------------------------
  // Estilo con promesas (.then / .catch), sin async/await
  // -------------------------------------------------------------------------
  console.log('\n5) Estilo promesas encadenadas');
  await api
    .get<Post>('/posts/2')
    .then((response) => console.log('   título:', response.data.title.slice(0, 30)))
    .catch((error: unknown) => console.error('   error:', (error as Error).message));

  // -------------------------------------------------------------------------
  // Manejo de errores tipados
  // -------------------------------------------------------------------------
  console.log('\n6) Manejo de errores (404 esperado)');
  try {
    await api.get('/ruta-inexistente-404');
  } catch (error) {
    if (isHttpResponseError(error)) {
      console.log(`   HTTP ${error.status}: el servidor respondió con un estado inválido`);
    } else if (isTimeoutError(error)) {
      console.log(`   Timeout tras ${error.timeout}ms`);
    } else if (isNetworkError(error)) {
      console.log('   Fallo de red');
    } else {
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Timeout: se fuerza un plazo imposible de cumplir
  // -------------------------------------------------------------------------
  console.log('\n7) Timeout forzado (1 ms, sin reintentos)');
  try {
    await api.get('/posts', { timeout: 1, retries: 0 });
  } catch (error) {
    if (isTimeoutError(error)) {
      console.log(`   La petición se canceló automáticamente tras ${error.timeout}ms`);
    }
  }

  // -------------------------------------------------------------------------
  // Cancelación manual con AbortSignal
  // -------------------------------------------------------------------------
  console.log('\n8) Cancelación manual');
  const controller = new AbortController();
  const pendiente = api.get('/posts', { signal: controller.signal });
  controller.abort();
  await pendiente.catch((error: unknown) => console.log('   cancelada:', (error as Error).message));

  // -------------------------------------------------------------------------
  // Instancia por defecto: sin configurar nada
  // -------------------------------------------------------------------------
  console.log('\n9) Instancia por defecto (import smartfetch from "smartfetch")');
  const { data: uno } = await smartfetch.get<Post>(
    'https://jsonplaceholder.typicode.com/posts/1',
  );
  console.log('   post 1:', uno.title.slice(0, 30));

  console.log('\n✔ Ejemplo completado.\n');
}

main().catch((error: unknown) => {
  console.error('El ejemplo falló:', error);
  process.exit(1);
});
