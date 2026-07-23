import type { QueryParams } from '../types';

/**
 * Indica si una URL es absoluta (incluye protocolo).
 * @param url - URL a evaluar.
 */
export function isAbsoluteURL(url: string): boolean {
  return /^([a-z][a-z\d+\-.]*:)?\/\//i.test(url);
}

/**
 * Une una URL base con una ruta relativa evitando barras duplicadas o ausentes.
 * @param baseURL - Prefijo base (por ejemplo, `https://api.com/v1`).
 * @param relativeURL - Ruta relativa (por ejemplo, `/users`).
 * @returns URL combinada.
 */
export function combineURLs(baseURL: string, relativeURL: string): string {
  if (!relativeURL) return baseURL;
  return `${baseURL.replace(/\/+$/, '')}/${relativeURL.replace(/^\/+/, '')}`;
}

/**
 * Serializa un diccionario de parámetros a query string.
 * Omite `null` y `undefined`, y expande arrays repitiendo la clave.
 * @param params - Parámetros a serializar.
 * @returns Query string SIN el `?` inicial.
 */
export function serializeParams(params: QueryParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === null || item === undefined) continue;
        search.append(key, String(item));
      }
    } else {
      search.append(key, String(value));
    }
  }
  return search.toString();
}

/**
 * Construye la URL final de la petición: aplica `baseURL` y añade los `params`,
 * preservando cualquier query string ya presente en la URL.
 * @param url - URL absoluta o relativa.
 * @param baseURL - Base opcional aplicada solo a URLs relativas.
 * @param params - Parámetros de query string.
 * @returns URL definitiva lista para `fetch`.
 */
export function buildURL(url: string, baseURL?: string, params: QueryParams = {}): string {
  const fullURL = baseURL && !isAbsoluteURL(url) ? combineURLs(baseURL, url) : url;
  const query = serializeParams(params);
  if (!query) return fullURL;
  const separator = fullURL.includes('?') ? '&' : '?';
  return `${fullURL}${separator}${query}`;
}
