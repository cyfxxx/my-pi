"""驱动真实终端里的 TUI：起 pty、发一句话、断言回复出现、退出。
不 mock 终端渲染 —— 这是「它真能跑」的证据，而不是「函数返回值对」。"""
import os
import pty
import re
import select
import sys
import time

url = sys.argv[1]
prompt = sys.argv[2] if len(sys.argv) > 2 else '只回一个字：好'
expect = sys.argv[3] if len(sys.argv) > 3 else '好'

pid, fd = pty.fork()
if pid == 0:
    os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
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
