export function getPublicUrl(path: string): string {
  const baseUrl = import.meta.env.BASE_URL;
  const normalizedPath = path.replace(/^\/+/, "");

  return new URL(
    `${baseUrl}${normalizedPath}`,
    self.location.origin,
  ).href;
}
