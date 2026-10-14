"""Run every browser smoke test against one local server.

Usage: python3 scripts/run-browser-tests.py [name ...]
Names are smoke files without the -smoke.py suffix (e.g. app-workflow cloud).
Without names, every tests/*-smoke.py runs in order. FLOW_TEST_URL is set for each test.
"""
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def wait_ready(url, process, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError('O servidor encerrou antes de responder.')
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.2)
    raise RuntimeError(f'O servidor não respondeu em {timeout} s.')


def main(names):
    tests = sorted((ROOT / 'tests').glob('*-smoke.py'))
    if names:
        wanted = {name.removesuffix('-smoke.py').removesuffix('-smoke') for name in names}
        missing = wanted - {test.name.removesuffix('-smoke.py') for test in tests}
        if missing:
            print('Testes inexistentes: ' + ', '.join(sorted(missing)), file=sys.stderr)
            return 2
        tests = [test for test in tests if test.name.removesuffix('-smoke.py') in wanted]
    port = free_port()
    base = f'http://127.0.0.1:{port}'
    server = subprocess.Popen(['node', 'server.mjs'], cwd=ROOT, env={**os.environ, 'PORT': str(port)},
                              stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    results = []
    try:
        wait_ready(base + '/', server)
        for test in tests:
            started = time.monotonic()
            print(f'\n=== {test.name}', flush=True)
            code = subprocess.call([sys.executable, str(test)], cwd=ROOT, env={**os.environ, 'FLOW_TEST_URL': base})
            results.append((test.name, code, time.monotonic() - started))
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
    print('\nResumo dos testes de navegador:')
    for name, code, seconds in results:
        print(f"  {'PASS' if code == 0 else 'FAIL'}  {name}  ({seconds:.1f} s)")
    failed = [name for name, code, _ in results if code]
    print(f'{len(results) - len(failed)}/{len(results)} passaram.')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
