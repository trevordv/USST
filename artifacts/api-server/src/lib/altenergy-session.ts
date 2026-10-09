/**
 * Detects that an AltEnergy response is the login page rather than members'
 * content, which happens when the session expires early or is invalidated.
 * Without this the scraper parsed the login page as if it were news and
 * silently found nothing.
 */
export function looksLikeAltEnergyLoginPage(finalUrl: string, status: number, body: string): boolean {
  if (status === 401 || status === 403) return true;
  try {
    if (/\/login\b/i.test(new URL(finalUrl).pathname)) return true;
  } catch { /* fall through to body check */ }
  const head = body.slice(0, 20_000);
  return /<input\b[^>]*type\s*=\s*["']password["']/i.test(head) && /<form\b[^>]*login/i.test(head);
}
