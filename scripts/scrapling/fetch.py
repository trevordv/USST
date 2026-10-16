"""Bounded public-page transport. JSON stdin/stdout; no application secrets."""
import contextlib
import ipaddress
import json
import socket
import sys
from urllib.parse import urlsplit

MAX_BYTES = 2_000_000


def permitted(url, host):
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or parsed.hostname != host or
            parsed.username or parsed.password or parsed.port not in (None, 443)):
        return False
    addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    return bool(addresses) and all(ipaddress.ip_address(a[4][0]).is_global for a in addresses)


def main():
    request = json.loads(sys.stdin.read(16_384))
    url, mode = request["url"], request["mode"]
    host = urlsplit(url).hostname
    if mode not in ("http", "browser") or not permitted(url, host):
        raise ValueError("unsafe request")
    # Library diagnostics must never corrupt the JSON protocol.
    with contextlib.redirect_stdout(sys.stderr):
        from scrapling.fetchers import Fetcher, DynamicFetcher
        if mode == "http":
            response = Fetcher.get(url, timeout=12, retries=0, follow_redirects=False)
        else:
            def setup(page):
                def route_request(route):
                    target = route.request.url
                    # No cross-host subresources, redirects, private destinations,
                    # media downloads, credentials, cookies or access-control bypass.
                    if route.request.resource_type in ("image", "media", "font") or not permitted(target, host):
                        route.abort()
                    else:
                        route.continue_()
                page.context.route("**/*", route_request)
            response = DynamicFetcher.fetch(
                url, headless=True, timeout=20_000, retries=1,
                google_search=False, page_setup=setup,
                additional_args={"service_workers": "block"},
            )
    body = response.body
    if isinstance(body, bytes):
        body = body.decode("utf-8", errors="replace")
    if len(body.encode("utf-8")) > MAX_BYTES:
        raise ValueError("response too large")
    final_url = str(response.url)
    if not permitted(final_url, host):
        raise ValueError("unsafe final URL")
    headers = {str(k).lower(): str(v) for k, v in response.headers.items()}
    print(json.dumps({"html": body, "url": final_url, "status": response.status,
                      "contentType": headers.get("content-type", ""),
                      "wwwAuthenticate": headers.get("www-authenticate")}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Do not return URLs, page bodies or library exceptions in diagnostics.
        print("Scrapling acquisition failed", file=sys.stderr)
        sys.exit(1)
