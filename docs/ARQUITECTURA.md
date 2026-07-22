# Arquitectura de SmartFetch

Este documento explica **qué patrones de diseño se han aplicado, dónde y por qué**. Está pensado tanto para quien contribuya a la librería como para la defensa del proyecto.

---

## 1. Visión general

SmartFetch separa dos cosas que en muchos clientes HTTP acaban mezcladas:

- **La lógica esencial**: construir la petición, llamar a `fetch`, interpretar la respuesta.
- **Las preocupaciones transversales** (*cross-cutting concerns*): timeout, reintentos, logging, autenticación, métricas, caché.

Las primeras viven en el `FetchAdapter`. Las segundas son **aspectos** que se tejen a su alrededor. El resultado es que el núcleo no sabe nada de reintentos, y el aspecto de reintentos no sabe nada de `fetch`.

```
             ┌──────────────────────────────────────────────┐
petición ──> │  InterceptorAspect   (order 10)              │
             │  ┌────────────────────────────────────────┐  │
             │  │  RetryAspect       (order 20)          │  │
             │  │  ┌──────────────────────────────────┐  │  │
             │  │  │  TimeoutAspect   (order 30)      │  │  │
             │  │  │  ┌────────────────────────────┐  │  │  │
             │  │  │  │  FetchAdapter  (núcleo)    │  │  │  │
             │  │  │  └────────────────────────────┘  │  │  │
             │  │  └──────────────────────────────────┘  │  │
             │  └────────────────────────────────────────┘  │
             └──────────────────────────────────────────────┘
```

### La decisión de diseño más importante: el orden de las capas

`RetryAspect` (order 20) envuelve a `TimeoutAspect` (order 30), y **no al revés**. La consecuencia es que **cada intento estrena su propio reloj de timeout**.

Si el orden estuviera invertido, un `timeout: 5000` con `retries: 3` significaría "5 segundos para los cuatro intentos en total", lo cual casi nunca es lo que el usuario quiere. Con el orden actual significa "5 segundos para cada intento", que es el comportamiento intuitivo y el que implementan las librerías serias.

Los interceptores (order 10) quedan por fuera del retry, de modo que se ejecutan **una vez por petición lógica** y no una vez por reintento (si no, un interceptor que registra métricas contaría cuatro peticiones donde el usuario hizo una).

---

## 2. Programación Orientada a Aspectos

### El problema

El timeout y los reintentos son el ejemplo de manual de un *cross-cutting concern*: no pertenecen a ninguna función concreta, pero afectan a todas. Implementarlos "a mano" dentro del método `request()` produce un método de 150 líneas con tres niveles de anidamiento, imposible de testear por partes.

### La solución

Un **aspecto** es un objeto que declara *advices* (`before`, `around`, `afterReturning`, `afterThrowing`, `after`) y un `order`. El **weaver** (`src/aspects/weaver.ts`) los ordena y los compone en una cadena de funciones anidadas mediante `reduceRight`:

```ts
return ordered.reduceRight<ProceedFn>((next, aspect) => {
  return async () => {
    await aspect.before?.(context);
    try {
      const response = aspect.around ? await aspect.around(context, next) : await next();
      await aspect.afterReturning?.(context, response);
      return response;
    } catch (rawError) {
      const error = toSmartFetchError(rawError, context.config);
      await aspect.afterThrowing?.(context, error);
      throw error;
    } finally {
      await aspect.after?.(context);
    }
  };
}, core);
```

El *join point* (el punto donde se inyecta el comportamiento) es la ejecución de la petición HTTP. El `around` recibe una función `proceed()` y decide qué hacer con ella:

| Aspecto | Qué hace con `proceed()` |
|---|---|
| `RetryAspect` | La llama **N veces** hasta que una funcione |
| `TimeoutAspect` | La llama **con un reloj** que la aborta si tarda |
| `InterceptorAspect` | La llama **transformando** lo que entra y lo que sale |
| Un aspecto de caché | Puede **no llamarla** y devolver un valor cacheado |

Beneficio concreto: **añadir métricas, trazas distribuidas o un circuit breaker no requiere tocar ni una línea del núcleo**, solo registrar un aspecto con `client.use(...)`.

---

## 3. Patrones de diseño

### Facade — `SmartFetch`

`src/core/SmartFetch.ts`

El usuario escribe `api.get('/usuarios')`. Detrás hay un builder de configuración, un weaver de aspectos, un pipeline de cuatro capas y un adaptador. La fachada esconde todo eso tras una API que se aprende en treinta segundos.

### Adapter — `FetchAdapter`

`src/core/FetchAdapter.ts`

Es la **única** clase de toda la librería que conoce `fetch`. Traduce su modelo al de SmartFetch:

| `fetch` | SmartFetch |
|---|---|
| Un `404` resuelve con `ok: false` | Se lanza `HttpResponseError` |
| Rechaza con `TypeError` si la red falla | Se lanza `NetworkError` |
| Rechaza con `AbortError` al cancelar | Se lanza `CanceledError` |
| Hay que llamar a `res.json()` | `response.data` ya viene deserializado |

Esta indirección es lo que permite inyectar `fetchImpl` en los tests unitarios (sin red) y lo que haría trivial migrar a otro transporte si algún día hiciera falta.

### Strategy — estrategias de backoff

`src/retry/backoff.ts`

La espera entre reintentos varía: constante, lineal, exponencial, exponencial con jitter, nula. En vez de un `switch` dentro del `RetryAspect`, cada política es un objeto que cumple la interfaz `BackoffStrategy`:

```ts
export interface BackoffStrategy {
  readonly name: string;
  delay(attempt: number, baseDelay: number): number;
}
```

El `RetryAspect` solo llama a `config.backoff.delay(...)`; no sabe qué estrategia hay detrás. El usuario puede escribir la suya sin tocar la librería.

La misma idea se aplica a `retryOn` (qué errores merecen reintento) y a `validateStatus` (qué estados son válidos): son estrategias inyectadas como funciones.

### Builder — `RequestConfigBuilder`

`src/core/ConfigBuilder.ts`

Resolver la configuración de una petición no es un simple `Object.assign`: hay tres niveles de precedencia (defaults de la librería → defaults del cliente → opciones de la llamada) y estructuras anidadas (`headers`, `params`, `meta`, `aspects`) que deben **fusionarse**, no sobrescribirse en bloque. El builder encapsula esas reglas y expone una API fluida:

```ts
new RequestConfigBuilder(this.defaults)
  .withUrl(url)
  .withMethod(method)
  .withOptions(options)
  .withBody(body)
  .build();
```

### Factory — `SmartFetch.create()` y `createBackoff()`

Ocultan la construcción del objeto y permiten cambiar la implementación concreta sin romper a los consumidores. `createBackoff('exponential', { jitter: true })` devuelve una estrategia sin que el usuario tenga que importar la clase concreta.

### Chain of Responsibility — el pipeline de aspectos

Cada aspecto recibe la petición, hace lo suyo y decide si delega en el siguiente eslabón (`proceed()`) o corta la cadena. Es exactamente la estructura de una cadena de responsabilidad, y es la razón por la que un aspecto de caché puede "responder" sin llegar nunca a la red.

### Observer / Middleware — `InterceptorManager`

`src/interceptors/InterceptorManager.ts`

Los interceptores son *listeners* registrables y eliminables (`use()` devuelve un id, `eject(id)` lo quita) que se notifican en cada petición y en cada respuesta. Es el mecanismo que permite, por ejemplo, refrescar un token expirado de forma centralizada.

### Decorator — los aspectos como decoradores de comportamiento

Cada aspecto envuelve la función `proceed` y devuelve otra función con la misma firma pero comportamiento enriquecido. Esa es, literalmente, la definición del patrón Decorator aplicada a funciones en vez de a objetos.

### Singleton (ligero) — la instancia por defecto

`src/index.ts` exporta una instancia ya creada (`export default smartfetch`) para el caso de uso trivial. No es un singleton estricto — nada impide crear más instancias con `new SmartFetch()` —, que es justo lo que evita los problemas de estado global típicos del patrón.

---

## 4. Estrategia de pruebas

| Nivel | Qué prueba | Cómo |
|---|---|---|
| **Unitarias** | Utilidades puras (`buildURL`, `serializeBody`, backoff, política de reintento) | Sin dobles: entrada → salida |
| **Unitarias** | Cliente, timeout, reintentos, interceptores, aspectos | Inyectando `fetchImpl` (un mock), sin tocar la red |
| **Integración** | El sistema completo contra su colaborador externo real | `fetch` nativo contra un servidor HTTP levantado con `node:http` |

La librería no tiene dependencias NPM, pero **sí depende de un colaborador externo**: la API `fetch` del runtime y la red. Por eso las pruebas de integración levantan un servidor real con endpoints que simulan las situaciones difíciles: `/slow` (para el timeout), `/flaky` (falla dos veces con 500 y luego responde), `/rate-limited` (429 con `Retry-After`).

Casos límite cubiertos explícitamente:

- El timeout **aborta de verdad** la señal subyacente (no se limita a ignorar la respuesta tardía).
- Una cancelación del usuario produce `CanceledError`, **no** `TimeoutError`, y **no se reintenta**.
- Los interceptores se ejecutan **una vez**, aunque haya tres reintentos.
- Un `404` no se reintenta ni con `retries: 5` configurado.
