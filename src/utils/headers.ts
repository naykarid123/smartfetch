/**
 * Normaliza las claves de un objeto de cabeceras a minúsculas.
 * HTTP trata las cabeceras como case-insensitive, así que unificarlas
 * evita duplicados del tipo `Content-Type` / `content-type`.
 * @param headers - Cabeceras de entrada.
 * @returns Nuevo objeto con las claves en minúsculas.
 */
export function normalizeHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue;
    result[key.toLowerCase()] = String(value);
  }
  return result;
}

/**
 * Fusiona varios conjuntos de cabeceras. Los últimos sobrescriben a los primeros.
 * @param sources - Conjuntos de cabeceras en orden de prioridad ascendente.
 * @returns Cabeceras fusionadas y normalizadas.
 */
export function mergeHeaders(
  ...sources: Array<Record<string, string> | undefined>
): Record<string, string> {
  return sources.reduce<Record<string, string>>(
    (acc, source) => Object.assign(acc, normalizeHeaders(source)),
    {},
  );
}

/**
 * Convierte un objeto `Headers` nativo en un diccionario plano.
 * @param headers - Cabeceras nativas de la respuesta.
 * @returns Diccionario con claves en minúsculas.
 */
export function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}
