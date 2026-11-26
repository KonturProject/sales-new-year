/**
 * Ссылка для экрана площади с ключом после `#`: адрес сайта без `admin.html`, ключ в хеше (на сервер он не уходит,
 * экран запоминает его и убирает из адреса). `?backend=` сохраняется — он действует только в разработке и на моке.
 */
export function screenLink(adminHref: string, key: string): string {
  const u = new URL(adminHref);
  u.pathname = u.pathname.replace(/[^/]*$/, '');
  const backend = u.searchParams.get('backend');
  u.search = backend ? `?backend=${encodeURIComponent(backend)}` : '';
  u.hash = `k=${encodeURIComponent(key)}`;
  return u.toString();
}
