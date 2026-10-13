/**
 * Returns a JSON-safe copy of `value`: BigInt → string (recursively), Date → ISO string.
 * Use before returning rows that contain BigInt columns (e.g. Event.id) in JSON responses.
 * @param {unknown} value
 * @returns {unknown}
 */
export function toJsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === "object") {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, v] of Object.entries(value)) out[key] = toJsonSafe(v);
    return out;
  }
  return value;
}
