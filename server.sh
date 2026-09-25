# http.server's default listen backlog of 5 drops connections when requirejs fetches modules in a burst
python3 -c "import http.server as h; h.ThreadingHTTPServer.request_queue_size=256; h.test(HandlerClass=h.SimpleHTTPRequestHandler, ServerClass=h.ThreadingHTTPServer, port=8000)" &
