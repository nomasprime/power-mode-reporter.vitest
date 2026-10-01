"""Native watch controls, run sounds, symbols, wrapping and Ctrl+C.

Run after pnpm run build. Python standard library only; audio is disabled.
"""
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import signal
import struct
import sys
import tempfile
import termios
import time

ROOT = Path(__file__).resolve().parent.parent
VITEST = Path(os.environ.get('VITEST_TEST_PACKAGE', ROOT / 'node_modules/vitest')).resolve()
ANSI = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')
CI_KEYS = {'CI', 'CONTINUOUS_INTEGRATION', 'GITHUB_ACTIONS', 'GITLAB_CI', 'BUILDKITE',
           'CIRCLECI', 'JENKINS_URL', 'JENKINS_HOME', 'TEAMCITY_VERSION', 'TF_BUILD',
           'TRAVIS', 'APPVEYOR', 'BITBUCKET_BUILD_NUMBER', 'NO_COLOR'}


class Terminal:
    def __init__(self, root, watch=True, allow_empty=False):
        env = {key: value for key, value in os.environ.items()
               if key not in CI_KEYS and not key.startswith('VITEST_HYPE_')}
        env.update(TERM='xterm-256color', FORCE_COLOR='1', HYPE_ALLOW_EMPTY='1' if allow_empty else '0')
        self.pid, self.master = pty.fork()
        if self.pid == 0:
            os.chdir(root)
            os.execvpe(shutil.which('node'), ['node', str(VITEST / 'vitest.mjs'), '--watch' if watch else 'run', '--config', str(root / 'vitest.config.mjs')], env)
        self.buffer = bytearray()
        self.reaped = False
        self.width(80)

    def text(self):
        return ANSI.sub('', self.buffer.decode('utf-8', errors='replace')).replace('\r', '')

    def read(self):
        if select.select([self.master], [], [], 0.05)[0]:
            try:
                data = os.read(self.master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    return False
                raise
            self.buffer.extend(data)
            return bool(data)
        return True

    def wait(self, pattern, start=0, timeout=15):
        deadline = time.monotonic() + timeout
        while not re.search(pattern, self.text()[start:]):
            if time.monotonic() > deadline or not self.read():
                raise AssertionError(f'Missing {pattern}\n{self.text()}')
        return self.text()[start:]

    def key(self, key):
        offset = len(self.text())
        os.write(self.master, key.encode())
        return offset

    def width(self, columns):
        fcntl.ioctl(self.master, termios.TIOCSWINSZ, struct.pack('HHHH', 40, columns, 0, 0))
        os.kill(self.pid, signal.SIGWINCH)

    def exit(self, key='q'):
        if key is not None:
            self.key(key)
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            self.read()
            exited, _ = os.waitpid(self.pid, os.WNOHANG)
            if exited:
                self.reaped = True
                break
        assert self.reaped, f'Did not exit promptly\n{self.text()}'

    def close(self):
        if not self.reaped:
            try:
                os.kill(self.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            os.waitpid(self.pid, 0)
        os.close(self.master)


def verify():
    with tempfile.TemporaryDirectory(prefix='hype-tty-') as directory:
        root = Path(directory)
        (root / 'node_modules').symlink_to(VITEST.parent, target_is_directory=True)
        (root / 'package.json').write_text('{"type":"module"}')
        shutil.copytree(ROOT / 'dist', root / 'reporter')
        sounds = root / 'sounds.jsonl'
        # Observe sound selection without launching afplay or making any noise.
        (root / 'vitest.config.mjs').write_text(f"""
import {{ appendFileSync }} from 'node:fs'
import PowerModeReporter from './reporter/index.js'
import {{ SoundPlayer }} from './reporter/sound.js'
SoundPlayer.prototype.play = file => appendFileSync({json.dumps(str(sounds))}, JSON.stringify(file) + '\\n')
export default {{ clearScreen: false, test: {{
  root: {json.dumps(str(root))}, testTimeout: 10000,
  passWithNoTests: process.env.HYPE_ALLOW_EMPTY === '1',
  reporters: [new PowerModeReporter({{
    sound: true, dot: '💚', failDot: '💔', skipDot: '💛',
    soundFile: '/pass', failSoundFile: '/fail', interruptedSoundFile: '/cancel',
    skippedSoundFile: '/skip', emptySoundFile: '/empty',
  }})],
}} }}
""")
        def played():
            return [json.loads(line) for line in sounds.read_text().splitlines()] if sounds.exists() else []
        def expect_sounds(expected):
            assert played() == (expected if sys.platform == 'darwin' else []), played()

        work = root / 'work.test.js'
        work.write_text("import { test } from 'vitest'; test('passes', () => {})")
        terminal = Terminal(root)
        try:
            terminal.wait('press h to show help, press q to quit')
            expect_sounds(['/pass'])
            terminal.wait('press h to show help, press q to quit', terminal.key('r'))
            expect_sounds(['/pass', '/pass'])
            for source, diagnostic in [
                ("import { test, expect } from 'vitest'; test('fails', () => expect(1).toBe(2))", 'AssertionError'),
                ("throw new Error('collection exploded')", 'collection exploded'),
                ("import { test, afterAll } from 'vitest'; test('passes',()=>{}); afterAll(()=>{throw new Error('hook exploded')})", 'hook exploded'),
                ("import { test } from 'vitest'; test('unhandled', async()=>{void Promise.reject(new Error('unhandled exploded')); await new Promise(r=>setTimeout(r,25))})", 'unhandled exploded'),
            ]:
                start = len(terminal.text())
                work.write_text(source)
                terminal.wait('press h to show help, press q to quit', start)
                assert diagnostic in terminal.text()[start:]
            expect_sounds(['/pass', '/pass', '/fail', '/fail', '/fail', '/fail'])

            start = len(terminal.text())
            work.write_text("import { test } from 'vitest'; test.skip('skip',()=>{}); test.todo('todo')")
            terminal.wait('press h to show help, press q to quit', start)
            assert '1 skipped' in terminal.text()[start:] and '1 todo' in terminal.text()[start:]
            expect_sounds(['/pass', '/pass', '/fail', '/fail', '/fail', '/fail', '/skip'])

            terminal.width(24)
            start = len(terminal.text())
            work.write_text("import { test } from 'vitest'; for (let i=0;i<78;i++) test('fast '+i,()=>{})")
            terminal.wait('press h to show help, press q to quit', start)
            rows = re.findall(r'^💚(?: 💚)*$', terminal.text()[start:], re.M)
            assert sum(row.count('💚') for row in rows) == 78
            assert all(row.count('💚') * 2 + row.count(' ') <= 24 for row in rows)

            start = len(terminal.text())
            work.write_text("import { test } from 'vitest'; test('cancel', async()=>{console.log('CANCEL_READY'); await new Promise(r=>setTimeout(r,1000))})")
            terminal.wait('CANCEL_READY', start)
            terminal.exit('\x03')
            expect_sounds(['/pass', '/pass', '/fail', '/fail', '/fail', '/fail', '/skip', '/pass', '/cancel'])
            assert not re.search(r'💕|❤️‍🔥|streak|press s|session', terminal.text(), re.I)
            assert not (root / '.vitest').exists()
            assert b'\x1b[2J' not in terminal.buffer and b'\x1b[3J' not in terminal.buffer
        finally:
            terminal.close()

        # Empty runs distinguish an allowed empty result from Vitest rejecting it.
        work.unlink()
        for allow_empty in [True, False]:
            sounds.unlink(missing_ok=True)
            terminal = Terminal(root, watch=False, allow_empty=allow_empty)
            try:
                terminal.wait('No test files found')
                terminal.exit(None)
                expect_sounds(['/empty' if allow_empty else '/fail'])
            finally:
                terminal.close()
        print(f"Verified Vitest {json.loads((VITEST / 'package.json').read_text())['version']}: native watch controls, pass/fail/skip/empty/interrupted sounds, diagnostics, narrow rows, prompt exit")


if __name__ == '__main__':
    verify()
