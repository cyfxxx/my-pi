"""驱动真实终端里的 TUI：起 pty、发一句话、断言回复出现、退出。
不 mock 终端渲染 —— 这是「它真能跑」的证据，而不是「函数返回值对」。"""
import os
import pty
import re
import select
import sys
import time

args = sys.argv[1:]
via_launcher = bool(args) and args[0] == '--via-launcher'
if via_launcher:
    args = args[1:]
url = args[0] if args else ''
prompt = args[1] if len(args) > 1 else '只回一个字：好'
expect = args[2] if len(args) > 2 else '好'

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
pid, fd = pty.fork()
if pid == 0:
    os.chdir(root)
    if via_launcher:
        # 走文档里写的那一条指令（宿主已在跑时不会重启），而不是直接调 bin/
        os.execvp('bash', ['bash', 'scripts/mypi.sh', 'tui'])
    os.execvp('node', ['node', 'bin/tui.mjs', url])

out = b''
def pump(seconds):
    global out
    end = time.time() + seconds
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.2)
        if fd in r:
            try:
                chunk = os.read(fd, 65536)
            except OSError:
                return
            if not chunk:
                return
            out += chunk

pump(6)
os.write(fd, (prompt + '\r').encode())
pump(20)
os.write(fd, '/quit\r'.encode())
pump(2)

clean = re.sub(r'\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]', '', out.decode('utf-8', 'replace'))
tail = clean.split(prompt, 1)[-1] if prompt in clean else clean
ok = expect in tail
print(f'TUI 退出码检查：回复含「{expect}」= {ok}')
sys.exit(0 if ok else 1)
