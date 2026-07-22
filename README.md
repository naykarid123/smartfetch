<div align="center">

# SmartFetch

**Un wrapper avanzado sobre `fetch`. La potencia de axios, sin sus dependencias.**

[![npm version](https://img.shields.io/npm/v/smartfetch.svg)](https://www.npmjs.com/package/smartfetch)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](#por-qué-smartfetch)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

</div>

SmartFetch es una librería HTTP escrita en TypeScript que envuelve la API nativa `fetch` y le añade lo que le falta para usarla en producción: **timeouts con cancelación real, reintentos automáticos, errores tipados, interceptores y aspectos**.

Todo ello con **cero dependencias en tiempo de ejecución**: usa solo `fetch`, `AbortController` y `URL`, que ya vienen en el runtime.

---

## Tabla de contenidos

- [Por qué SmartFetch](#por-qué-smartfetch)
- [Instalación](#instalación)
- [Integración en un proyecto](#integración-en-un-proyecto)
- [Uso](#uso)
  - [Métodos HTTP](#métodos-http)
  - [Timeout](#timeout)
  - [Reintentos automáticos](#reintentos-automáticos)
  - [async/await y promesas](#asyncawait-y-promesas)
  - [Manejo de errores](#manejo-de-errores)
  - [Cancelación manual](#cancelación-manual)
  - [Interceptores](#interceptores)
  - [Aspectos (POA)](#aspectos-poa)
- [Referencia de la API](#referencia-de-la-api)
- [Arquitectura](#arquitectura)
- [Desarrollo](#desarrollo)
- [Licencia](#licencia)

---

## Por qué SmartFetch

`fetch` es potente, pero tiene aristas conocidas:

| Con `fetch` a secas | Con SmartFetch |
|---|---|
| Un `404` **no** lanza error: hay que comprobar `res.ok` a mano | Los estados inválidos lanzan un `HttpResponseError` tipado |
| Hay que llamar a `res.json()` en cada petición | El cuerpo llega ya deserializado en `response.data` |
| No hay timeout: una petición puede colgarse para siempre | `timeout` con cancelación real vía `AbortController` |
| Si el servidor devuelve `503`, te toca reintentar a mano | Reintentos automáticos con backoff exponencial |
| No hay `baseURL` ni cabeceras por defecto | Instancias configurables y heredables |
| No hay interceptores | Interceptores de petición, respuesta y error |

Y a diferencia de axios, **no arrastra ninguna dependencia transitiva**, que es precisamente la principal fuente de vulnerabilidades de una librería HTTP.

---

## Instalación

```bash
npm install smartfetch
```

Con otros gestores:

```bash
yarn add smartfetch
pnpm add smartfetch
```

**Requisitos:** Node.js >= 18 (o cualquier navegador moderno). Son los entornos donde `fetch` y `AbortController` son globales.

---

## Integración en un proyecto

SmartFetch incluye sus propias definiciones de tipos: **no necesitas instalar `@types/...` por separado**.

### TypeScript / ESM

```ts
import { SmartFetch } from 'smartfetch';

const api = new SmartFetch({
  baseURL: 'https://api.ejemplo.com',
  timeout: 5000,
  retries: 3,
  headers: { accept: 'application/json' },
});

export default api;
```

### CommonJS

```js
const { SmartFetch } = require('smartfetch');

const api = new SmartFetch({ baseURL: 'https://api.ejemplo.com' });
```

### Sin configuración: la instancia por defecto

Si no necesitas configurar nada, importa la instancia lista para usar:

```ts
import smartfetch from 'smartfetch';

const { data } = await smartfetch.get('https://api.ejemplo.com/usuarios');
```

### Patrón recomendado: un cliente por servicio

```ts
// src/api/client.ts
import { SmartFetch, exponentialBackoff } from 'smartfetch';

export const api = SmartFetch.create({
  baseURL: process.env.API_URL,
  timeout: 5000,
  retries: 3,
  backoff: exponentialBackoff({ jitter: true }),
});

api.interceptors.request.use((config) => {
  config.headers.authorization = `Bearer ${localStorage.getItem('token')}`;
  return config;
});
```

---

## Uso

### Métodos HTTP

Todos los métodos devuelven una `Promise<SmartResponse<T>>`. El parámetro genérico `T` tipa el cuerpo de la respuesta.

```ts
interface Usuario {
  id: number;
  nombre: string;
}

// GET
const { data } = await api.get<Usuario[]>('/usuarios');

// GET con query string  ->  /usuarios?page=2&activo=true
const { data } = await api.get<Usuario[]>('/usuarios', {
  params: { page: 2, activo: true },
});

// POST — los objetos planos se serializan a JSON automáticamente,
// y se añade la cabecera `content-type: application/json`
const { data } = await api.post<Usuario>('/usuarios', { nombre: 'Ada' });

// PUT
const { data } = await api.put<Usuario>('/usuarios/1', { id: 1, nombre: 'Ada L.' });

// PATCH
const { data } = await api.patch<Usuario>('/usuarios/1', { nombre: 'Ada Lovelace' });

// DELETE
await api.delete('/usuarios/1');

// HEAD y OPTIONS también están disponibles
await api.head('/usuarios');

// Método genérico, por si necesitas control total
const { data } = await api.request<Usuario>({
  url: '/usuarios/1',
  method: 'GET',
  timeout: 1000,
});
```

Cada respuesta tiene esta forma:

```ts
{
  data: T,                          // cuerpo ya deserializado
  status: 200,
  statusText: 'OK',
  headers: { 'content-type': '...' },
  attempts: 1,                      // intentos realizados
  config: { ... },                  // configuración usada
  raw: Response,                    // el `Response` nativo, por si acaso
}
```

### Timeout

Si el servidor no responde en el plazo indicado, la petición **se cancela de verdad** (no se queda colgada) y se lanza un `TimeoutError`.

```ts
// A nivel de cliente: se aplica a todas las peticiones
const api = new SmartFetch({ timeout: 5000 });

// A nivel de petición: sobrescribe el del cliente
await api.get('/lento', { timeout: 1000 });

// timeout: 0 (valor por defecto) desactiva la funcionalidad
```

```ts
import { isTimeoutError } from 'smartfetch';

try {
  await api.get('/lento', { timeout: 1000 });
} catch (error) {
  if (isTimeoutError(error)) {
    console.error(`Se agotaron los ${error.timeout}ms`);
  }
}
```

> Cuando se combinan timeout y reintentos, **cada intento estrena su propio reloj**.

### Reintentos automáticos

Ante fallos transitorios (errores `5xx`, problemas de red o timeouts), SmartFetch reintenta la petición automáticamente.

```ts
const api = new SmartFetch({
  retries: 3,      // 3 reintentos ADICIONALES => 4 intentos como máximo
  retryDelay: 300, // retardo base en ms
});
```

> **Por defecto `retries: 0`**, es decir, **un solo intento**. Los reintentos son opt-in.

#### Estrategias de espera (backoff)

```ts
import { fixedBackoff, linearBackoff, exponentialBackoff, noBackoff } from 'smartfetch';

const api = new SmartFetch({
  retries: 4,
  retryDelay: 200,
  backoff: exponentialBackoff({ jitter: true, maxDelay: 10_000 }),
});
```

| Estrategia | Esperas con `retryDelay: 200` |
|---|---|
| `fixedBackoff()` | 200, 200, 200, 200 |
| `linearBackoff()` | 200, 400, 600, 800 |
| `exponentialBackoff()` *(por defecto)* | 200, 400, 800, 1600 |
| `exponentialBackoff({ jitter: true })` | valores aleatorios acotados por los anteriores |
| `noBackoff()` | 0, 0, 0, 0 |

El `jitter` evita el efecto *thundering herd*: que miles de clientes reintenten a la vez tras una caída.

#### Qué se reintenta

| Situación | ¿Se reintenta? |
|---|---|
| Fallo de red | Sí |
| Timeout | Sí |
| `500`, `502`, `503`, `504`... | Sí |
| `408`, `425`, `429` | Sí |
| `400`, `401`, `403`, `404` | No (reintentar no cambiaría el resultado) |
| Cancelación del usuario | No |

Si el servidor envía la cabecera `Retry-After`, se respeta en lugar del backoff configurado.

#### Política de reintento a medida

```ts
import { isHttpResponseError } from 'smartfetch';

const api = new SmartFetch({
  retries: 3,
  retryOn: (error, attempt) => {
    if (attempt >= 2 && new Date().getHours() > 22) return false; // sin reintentos de madrugada
    return isHttpResponseError(error) && error.status >= 500;
  },
});
```

### async/await y promesas

Todos los métodos devuelven una promesa, así que ambos estilos son válidos:

```ts
// async / await
const { data } = await api.get<Usuario>('/usuarios/1');

// promesas encadenadas
api
  .get<Usuario>('/usuarios/1')
  .then((response) => console.log(response.data))
  .catch((error) => console.error(error))
  .finally(() => console.log('listo'));

// y también en paralelo
const [usuarios, productos] = await Promise.all([
  api.get<Usuario[]>('/usuarios'),
  api.get<Producto[]>('/productos'),
]);
```

### Manejo de errores

Todos los errores heredan de `SmartFetchError`, así que un único `catch` basta. Para distinguirlos hay *type guards* y un `code` estable.

```ts
import {
  isHttpResponseError,
  isTimeoutError,
  isNetworkError,
  isCanceledError,
} from 'smartfetch';

try {
  await api.get('/usuarios');
} catch (error) {
  if (isHttpResponseError(error)) {
    // El servidor respondió con un estado inválido
    console.error(error.status);        // 404
    console.error(error.data);          // cuerpo del error, ya deserializado
    console.error(error.response.headers);
  } else if (isTimeoutError(error)) {
    console.error(`Timeout tras ${error.timeout}ms`);
  } else if (isNetworkError(error)) {
    console.error('Servidor inalcanzable');
  } else if (isCanceledError(error)) {
    console.error('Petición cancelada');
  }
}
```

| Error | `code` | Cuándo se lanza |
|---|---|---|
| `HttpResponseError` | `EBADRESPONSE` | El estado no supera `validateStatus` (por defecto, fuera de 2xx) |
| `TimeoutError` | `ETIMEDOUT` | Se agotó el tiempo de espera |
| `NetworkError` | `ENETWORK` | Fallo de red, DNS o CORS |
| `CanceledError` | `ECANCELED` | Cancelación con `AbortSignal` |
| `ParseError` | `EPARSE` | El cuerpo no se pudo deserializar |
| `ConfigurationError` | `ECONFIG` | Configuración inválida |

Todos exponen `attempts` (cuántos intentos se hicieron) y `config` (la petición que falló).

Si prefieres que un `404` **no** lance error, personaliza `validateStatus`:

```ts
const api = new SmartFetch({ validateStatus: (status) => status < 500 });
```

### Cancelación manual

```ts
const controller = new AbortController();

const promesa = api.get('/informe-pesado', { signal: controller.signal });

document.querySelector('#cancelar')?.addEventListener('click', () => controller.abort());

try {
  const { data } = await promesa;
} catch (error) {
  if (isCanceledError(error)) console.log('El usuario canceló la petición');
}
```

### Interceptores

Permiten transformar peticiones y respuestas de forma centralizada. Se ejecutan **una vez por petición lógica**, no una vez por reintento.

```ts
// Petición: inyectar el token de autenticación
const id = api.interceptors.request.use((config) => {
  config.headers.authorization = `Bearer ${getToken()}`;
  return config;
});

// Respuesta: desenvolver la envoltura `{ data: ... }` de la API
api.interceptors.response.use((response) => {
  response.data = response.data.data;
  return response;
});

// Error: refrescar el token y recuperarse (devolver un valor evita que el error se propague)
api.interceptors.response.use(undefined, async (error) => {
  if (isHttpResponseError(error) && error.status === 401) {
    await refrescarToken();
    return api.request(error.config); // se reintenta con el token nuevo
  }
  throw error;
});

// Eliminar un interceptor
api.interceptors.request.eject(id);
```

### Aspectos (POA)

Un **aspecto** encapsula una preocupación transversal (logging, métricas, caché, trazas...) y la teje alrededor de la petición sin ensuciar la lógica del cliente. De hecho, el timeout y los reintentos de SmartFetch **están implementados así**.

```ts
import { SmartFetch, LoggingAspect, type Aspect } from 'smartfetch';

// Aspecto incluido en la librería
api.use(new LoggingAspect());
api.defaults.logger = console;

// Aspecto propio: caché en memoria de las peticiones GET
const cache = new Map<string, unknown>();

const cacheAspect: Aspect = {
  name: 'cache',
  order: 5, // menor `order` = capa más externa
  around: async (context, proceed) => {
    const key = `${context.config.method}:${context.config.url}`;
    if (context.config.method === 'GET' && cache.has(key)) {
      return cache.get(key) as never; // se sirve de caché, sin tocar la red
    }
    const response = await proceed();
    cache.set(key, response);
    return response;
  },
};

api.use(cacheAspect);
```

Un aspecto puede implementar cinco *advices*:

| Advice | Cuándo se ejecuta |
|---|---|
| `before` | Antes de proceder |
| `around` | Envuelve la ejecución: decide si continuar (`proceed()`), repetirla o cortocircuitarla |
| `afterReturning` | Cuando la petición termina bien |
| `afterThrowing` | Cuando la petición termina con error |
| `after` | Siempre, al final (como un `finally`) |

---

## Referencia de la API

### `new SmartFetch(options)` / `SmartFetch.create(options)`

| Opción | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `baseURL` | `string` | — | Prefijo de las URLs relativas |
| `headers` | `Record<string, string>` | `{}` | Cabeceras por defecto |
| `params` | `QueryParams` | `{}` | Query params por defecto |
| `timeout` | `number` | `0` | Milisegundos máximos. `0` lo desactiva |
| `retries` | `number` | `0` | Reintentos **adicionales** (`0` = un solo intento) |
| `retryDelay` | `number` | `300` | Retardo base entre reintentos, en ms |
| `backoff` | `BackoffStrategy` | `exponentialBackoff()` | Estrategia de espera |
| `retryOn` | `RetryPredicate` | `defaultRetryPredicate` | Qué errores se reintentan |
| `respectRetryAfter` | `boolean` | `true` | Respetar la cabecera `Retry-After` |
| `responseType` | `ResponseType` | `'auto'` | `auto`, `json`, `text`, `blob`, `arrayBuffer`, `formData`, `none` |
| `validateStatus` | `(status) => boolean` | `2xx` | Qué estados se consideran válidos |
| `signal` | `AbortSignal` | — | Señal de cancelación |
| `fetchImpl` | `FetchLike` | `globalThis.fetch` | Implementación de `fetch` (útil en tests) |
| `logger` | `Logger` | — | Logger usado por `LoggingAspect` |

### Métodos del cliente

| Método | Firma |
|---|---|
| `get` | `get<T>(url, options?)` |
| `delete` | `delete<T>(url, options?)` |
| `head` | `head<T>(url, options?)` |
| `options` | `options<T>(url, options?)` |
| `post` | `post<T>(url, body?, options?)` |
| `put` | `put<T>(url, body?, options?)` |
| `patch` | `patch<T>(url, body?, options?)` |
| `request` | `request<T>({ url, method, body, ...options })` |
| `use` | `use(aspect)` — registra un aspecto |
| `eject` | `eject(nombreDelAspecto)` |
| `extend` | `extend(options)` — deriva un cliente que hereda la configuración |

---

## Arquitectura

```
             ┌──────────────────────────────────────────────┐
petición ──> │  InterceptorAspect   (order 10)              │  1 vez por petición
             │  ┌────────────────────────────────────────┐  │
             │  │  RetryAspect       (order 20)          │  │  bucle de intentos
             │  │  ┌──────────────────────────────────┐  │  │
             │  │  │  TimeoutAspect   (order 30)      │  │  │  1 reloj por intento
             │  │  │  ┌────────────────────────────┐  │  │  │
             │  │  │  │  FetchAdapter  (núcleo)    │  │  │  │  fetch nativo
             │  │  │  └────────────────────────────┘  │  │  │
             │  │  └──────────────────────────────────┘  │  │
             │  └────────────────────────────────────────┘  │
             └──────────────────────────────────────────────┘
```

Patrones de diseño empleados: **Facade**, **Adapter**, **Builder**, **Strategy**, **Factory**, **Chain of Responsibility**, **Observer** y **Decorator**. El detalle de cada uno, en [`docs/ARQUITECTURA.md`](./docs/ARQUITECTURA.md).

---

## Desarrollo

```bash
git clone https://github.com/naykarid123/smartfetch.git
cd smartfetch
npm install

npm test               # todas las pruebas
npm run test:unit      # solo unitarias
npm run test:integration  # solo de integración (servidor HTTP real)
npm run test:coverage  # informe de cobertura
npm run typecheck      # comprobación de tipos
npm run build          # compila a dist/
npm run example        # ejecuta example.ts
```

El flujo de ramas del proyecto sigue **GitFlow**: ver [`docs/GITFLOW.md`](./docs/GITFLOW.md).

---

## Licencia

[MIT](./LICENSE)
