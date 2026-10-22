# sample/index.json lets the console `list <folder>` command see sample files where directories can't be listed (GitHub Pages, Electron file://)
python3 -c "
import os, json
d = 'sample'
m = {f: sorted(x for x in os.listdir(os.path.join(d, f)) if not x.startswith('.') and os.path.isfile(os.path.join(d, f, x))) for f in sorted(os.listdir(d)) if os.path.isdir(os.path.join(d, f))}
json.dump({k: v for k, v in m.items() if v}, open(os.path.join(d, 'index.json'), 'w'), indent=0)
"
# http.server's default listen backlog of 5 drops connections when requirejs fetches modules in a burst
python3 -c "import http.server as h; h.ThreadingHTTPServer.request_queue_size=256; h.test(HandlerClass=h.SimpleHTTPRequestHandler, ServerClass=h.ThreadingHTTPServer, port=8000)" &
