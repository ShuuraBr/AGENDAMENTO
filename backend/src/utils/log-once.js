const seen = new Set();

export function logOnce(key, message, ...rest) {
  const cacheKey = String(key || message || 'log-once');
  if (seen.has(cacheKey)) return;
  seen.add(cacheKey);
  console.error(message, ...rest);
}
