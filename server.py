"""Local-only OBS keyboard overlay. Python standard library, Windows only."""
import ctypes
import json
import os
from pathlib import Path
import threading
import time
import webbrowser
import sys
import socket
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs
from metrics import TapRecorder, report, csv_bytes
import keyconfig

PORT = 18964
ROOT = Path(__file__).resolve().parent
lock = threading.Lock()
VERSION = 5
CONFIG_PATH = ROOT / 'key-bindings.json'
bindings = keyconfig.load(CONFIG_PATH)
config_revision = 0
SHORTCUT = {17, 18, 123}
state = {"keys": [], "paused": False, "version": VERSION,
         "presses": 0, "capture_ok": False, "error": "", "updated": 0.0}
stop = threading.Event()


class InputHistory:
    """Measured key spans, independent of the overlay's visual release delay."""
    def __init__(self, retention=12):
        self.retention = retention
        self.active = {}
        self.finished = deque(maxlen=4096)

    def update(self, down, now, paused=False):
        if paused:
            self.active.clear()
            self.finished.clear()
            return
        for key in self.active.keys() - down:
            self.finished.append((key, self.active.pop(key), now))
        for key in down - self.active.keys():
            self.active[key] = now
        cutoff = now - self.retention
        while self.finished and self.finished[0][2] < cutoff:
            self.finished.popleft()

    def snapshot(self):
        return list(self.finished) + [(key, start, None) for key, start in self.active.items()]


history = InputHistory()
recorder = TapRecorder()


def desktop_name():
    from ctypes import wintypes as w
    user32 = ctypes.WinDLL('user32', use_last_error=True)
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    user32.GetThreadDesktop.argtypes = [w.DWORD]
    user32.GetThreadDesktop.restype = w.HANDLE
    kernel32.GetCurrentThreadId.restype = w.DWORD
    user32.GetUserObjectInformationW.argtypes = [w.HANDLE, ctypes.c_int, w.LPVOID, w.DWORD, ctypes.POINTER(w.DWORD)]
    desktop = user32.GetThreadDesktop(kernel32.GetCurrentThreadId())
    buf, needed = ctypes.create_unicode_buffer(256), w.DWORD()
    if not user32.GetUserObjectInformationW(desktop, 2, buf, ctypes.sizeof(buf), ctypes.byref(needed)):
        raise ctypes.WinError(ctypes.get_last_error())
    return buf.value


def capture():
    user32 = ctypes.WinDLL('user32', use_last_error=True)
    user32.GetAsyncKeyState.argtypes = [ctypes.c_int]
    user32.GetAsyncKeyState.restype = ctypes.c_short
    expires = {}
    paused = False
    shortcut_was_down = False
    previous = set()
    presses = 0
    last_revision = -1
    while not stop.is_set():
        now = time.monotonic()
        with lock:
            watched = set().union(*map(set, bindings.values()))
            revision = config_revision
        down = {k for k in watched | SHORTCUT if user32.GetAsyncKeyState(k) & 0x8000}
        presses += len((down - previous) & watched)
        previous = down
        shortcut = 17 in down and 18 in down and 123 in down
        if shortcut and not shortcut_was_down:
            paused = not paused
            expires.clear()
        shortcut_was_down = shortcut
        if not paused:
            for k in down & watched:
                expires[k] = now + .09
        expires = {k: until for k, until in expires.items() if until > now}
        with lock:
            if revision != config_revision:
                expires.clear()
                continue
            expires = {k: until for k, until in expires.items() if k in watched}
            if revision != last_revision:
                expires.clear()
                recorder.previous = down & watched
                last_revision = revision
            history.update(down & watched, now, paused)
            recorder.update(down & watched, now, paused)
            state.update(keys=[] if paused else sorted(expires), paused=paused,
                         presses=presses, capture_ok=True, updated=now)
        stop.wait(.002)


def capture_guarded():
    try:
        name = desktop_name()
        if 'sandbox' in name.lower():
            raise RuntimeError('ISOLATED_DESKTOP')
        capture()
    except Exception as exc:
        with lock:
            state.update(keys=[], capture_ok=False, error=str(exc))
        print(f'Input capture failed: {exc}', flush=True)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *_):
        pass

    def do_GET(self):
        if self.headers.get('Host') not in (f'127.0.0.1:{PORT}', f'localhost:{PORT}'):
            self.send_error(403)
            return
        url = urlsplit(self.path)
        path = url.path
        download = None
        if path == '/state':
            with lock:
                payload = dict(state)
                payload['bindings'] = bindings
                payload['notes'] = history.snapshot()
                payload['now'] = time.monotonic()
            payload['capture_ok'] = payload['capture_ok'] and time.monotonic() - payload.pop('updated') < 2
            body = json.dumps(payload).encode()
            mime = 'application/json'
        elif path == '/config':
            with lock:
                body = json.dumps(dict(bindings=bindings, defaults=keyconfig.DEFAULTS, labels=keyconfig.LABELS)).encode()
            mime = 'application/json'
        elif path in ('/', '/overlay'):
            body = (ROOT / 'index.html').read_bytes()
            mime = 'text/html; charset=utf-8'
        elif path in ('/metrics', '/graph', '/export.csv', '/export.json'):
            layout = parse_qs(url.query).get('layout', ['4k'])[0]
            if layout not in keyconfig.DEFAULTS:
                self.send_error(400)
                return
            with lock:
                snapshot = recorder.snapshot()
                selected = list(bindings[layout])
            if path == '/graph':
                snapshot['rows'] = snapshot['rows'][-2000:]
            data = report(snapshot, layout, selected)
            if path == '/export.csv':
                body = csv_bytes(data)
                mime = 'text/csv; charset=utf-8'
                download = 'KeyGlow-taps.csv'
            else:
                if path == '/metrics':
                    data['taps'] = data['taps'][-15:]
                elif path == '/graph':
                    data['taps'] = data['taps'][-300:]
                body = json.dumps(data, ensure_ascii=False).encode('utf-8')
                mime = 'application/json; charset=utf-8'
                if path == '/export.json':
                    download = 'KeyGlow-taps.json'
        elif path in ('/trail.js', '/metrics-ui.js', '/graphs.js', '/bindings.js'):
            body = (ROOT / path[1:]).read_bytes()
            mime = 'text/javascript; charset=utf-8'
        elif path == '/health':
            body = b'KeyGlow/5'
            mime = 'text/plain'
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if download:
            self.send_header('Content-Disposition', f'attachment; filename="{download}"')
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_POST(self):
        global bindings, config_revision
        actions = {'/config': 'configure', '/stop': 'stop', '/record/pause': 'pause', '/record/resume': 'resume', '/record/clear': 'clear'}
        action = actions.get(self.path)
        if (action is None or
                self.headers.get('Host') not in (f'127.0.0.1:{PORT}', f'localhost:{PORT}') or
                self.headers.get('X-KeyGlow-Control') != action or
                self.headers.get('Origin') not in (None, f'http://127.0.0.1:{PORT}', f'http://localhost:{PORT}')):
            self.send_error(403)
            return
        if action == 'configure':
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 4096:
                    raise ValueError('Invalid size')
                updated = keyconfig.validate(json.loads(self.rfile.read(length)))
                with lock:
                    temporary = CONFIG_PATH.with_suffix('.tmp')
                    temporary.write_text(json.dumps(updated), encoding='utf-8')
                    temporary.replace(CONFIG_PATH)
                    recorder.interrupt('bindings_changed')
                    history.update(set(), time.monotonic(), True)
                    state['keys'] = []
                    bindings = updated
                    config_revision += 1
            except (ValueError, TypeError, OSError):
                self.send_error(400, 'Invalid bindings or settings could not be saved')
                return
        elif action != 'stop':
            with lock:
                recorder.control(action)
        self.send_response(200)
        self.send_header('Content-Length', '0')
        self.end_headers()
        if action == 'stop':
            stop.set()
            threading.Thread(target=self.server.shutdown, daemon=True).start()


class LocalServer(ThreadingHTTPServer):
    # Windows SO_REUSEADDR permits a second process to bind the same address.
    allow_reuse_address = False

    def server_bind(self):
        if os.name == 'nt':
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def main():
    if os.name != 'nt':
        raise SystemExit('KeyGlow requires Windows.')
    if '--stop' in sys.argv:
        from urllib.request import Request, urlopen
        try:
            with urlopen(Request(f'http://127.0.0.1:{PORT}/stop', data=b'', headers={'X-KeyGlow-Control': 'stop'}), timeout=3):
                print('KeyGlow stopped.')
        except Exception as exc:
            print(f'Could not stop KeyGlow: {exc}')
        return
    if 'sandbox' in desktop_name().lower():
        raise SystemExit('KeyGlow cannot read your keyboard from an isolated desktop. Run Start.cmd on your normal Windows desktop.')
    try:
        server = LocalServer(('127.0.0.1', PORT), Handler)
    except OSError:
        from urllib.request import urlopen
        try:
            with urlopen(f'http://127.0.0.1:{PORT}/health', timeout=2) as r:
                existing = r.read() == b'KeyGlow/5'
        except Exception:
            existing = False
        if existing:
            webbrowser.open(f'http://127.0.0.1:{PORT}/')
            return
        raise SystemExit(f'Port {PORT} is occupied. Close the other application and retry.')
    threading.Thread(target=capture_guarded, daemon=True).start()
    print(f'KeyGlow running: http://127.0.0.1:{PORT}/', flush=True)
    print('Pause/resume: Ctrl+Alt+F12 | Quit: Ctrl+C or close this window', flush=True)
    if '--no-browser' not in sys.argv:
        webbrowser.open(f'http://127.0.0.1:{PORT}/')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.server_close()


if __name__ == '__main__':
    main()
