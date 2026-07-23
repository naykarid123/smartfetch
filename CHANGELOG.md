# Changelog

Este proyecto sigue [Versionado Semántico](https://semver.org/lang/es/) y el formato de
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [1.0.0] - 2026-07-12

### Añadido

- Cliente `SmartFetch` con soporte para `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD` y `OPTIONS`.
- Timeout configurable con cancelación real mediante `AbortController` (`TimeoutAspect`).
- Reintentos automáticos ante errores `5xx`, fallos de red y timeouts (`RetryAspect`). Por
  defecto se realiza un único intento.
- Estrategias de backoff intercambiables: fija, lineal, exponencial (con jitter opcional) y nula.
- Soporte de la cabecera `Retry-After`.
- Jerarquía de errores tipados con *type guards*: `HttpResponseError`, `TimeoutError`,
  `NetworkError`, `CanceledError`, `ParseError` y `ConfigurationError`.
- Interceptores de petición, respuesta y error.
- Sistema de aspectos (POA) extensible mediante `client.use(aspect)`.
- Serialización automática del cuerpo a JSON y deserialización automática de la respuesta.
- `baseURL`, cabeceras por defecto, query params y clientes derivados con `extend()`.
- Tipos TypeScript incluidos en el paquete. Cero dependencias en tiempo de ejecución.
