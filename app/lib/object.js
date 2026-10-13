/**
 * Copies only the allowed keys whose value is not `undefined`.
 * Repositories use this so caller data can never set `id` or `shopId`.
 * @template {Record<string, unknown>} T
 * @param {T | null | undefined} source
 * @param {readonly string[]} allowed
 * @returns {Partial<T>}
 */
export function pick(source, allowed) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (!source) return /** @type {Partial<T>} */ (out);
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) {
      out[key] = source[key];
    }
  }
  return /** @type {Partial<T>} */ (out);
}
