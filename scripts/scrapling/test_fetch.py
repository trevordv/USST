"""Worker protocol tests use synthetic pages; no source credentials or network."""
import contextlib
import importlib.util
import io
import json
import os
import socket
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("worker", Path(__file__).with_name("fetch.py"))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
URL = "https://www.energymagazine.com.au/?s=solar+project"


class WorkerTests(unittest.TestCase):
    @unittest.skipUnless(os.environ.get("SCRAPLING_BROWSER_SMOKE") == "true", "browser smoke is opt-in")
    def test_browser_runtime_and_page_setup(self):
        from scrapling.fetchers import DynamicFetcher
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(b"<html><body><article id='fixture'>No projects found</article></body></html>")
            def log_message(self, *_args):
                pass
        # Synthetic localhost fixture only, outside the public worker's allowlist.
        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        setup_called = []
        try:
            response = DynamicFetcher.fetch(f"http://127.0.0.1:{server.server_port}/", headless=True,
                timeout=10_000, retries=1, google_search=False,
                page_setup=lambda page: setup_called.append(True))
            self.assertEqual(response.status, 200)
            self.assertEqual(response.css("#fixture::text").get(), "No projects found")
            self.assertEqual(setup_called, [True])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_destinations(self):
        public = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))]
        with patch.object(worker.socket, "getaddrinfo", return_value=public):
            self.assertTrue(worker.permitted(URL, "www.energymagazine.com.au"))
            for url in ["https://example.com/", "http://www.energymagazine.com.au/",
                        "https://user@www.energymagazine.com.au/", "https://www.energymagazine.com.au:8443/"]:
                self.assertFalse(worker.permitted(url, "www.energymagazine.com.au"))
        private = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))]
        with patch.object(worker.socket, "getaddrinfo", return_value=private):
            self.assertFalse(worker.permitted(URL, "www.energymagazine.com.au"))

    def test_http_protocol_has_no_redirects_or_retries(self):
        response = SimpleNamespace(body=b"<article>No projects found</article>", url=URL,
                                   status=200, headers={"Content-Type": "text/html"})
        output = io.StringIO()
        with patch.object(worker, "permitted", return_value=True), \
                patch.object(worker.sys, "stdin", io.StringIO(json.dumps({"url": URL, "mode": "http"}))), \
                patch("scrapling.fetchers.Fetcher.get", return_value=response) as get, \
                contextlib.redirect_stdout(output):
            worker.main()
        self.assertEqual(json.loads(output.getvalue())["html"], response.body.decode())
        get.assert_called_once_with(URL, timeout=12, retries=0, follow_redirects=False)


if __name__ == "__main__":
    unittest.main()
