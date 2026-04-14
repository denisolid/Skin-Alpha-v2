export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"`â„¢™\u2122]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
