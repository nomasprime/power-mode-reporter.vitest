import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'

const reporterDirectory = new URL('../dist/', import.meta.url)
const vitestPackage = process.env.VITEST_TEST_PACKAGE || dirname(fileURLToPath(import.meta.resolve('vitest/package.json')))
const vitestCLI = join(vitestPackage, 'vitest.mjs')
const vitestVersion = JSON.parse(await readFile(join(vitestPackage, 'package.json'), 'utf8')).version

async function fixture(t, source, { watch = false, passWithNoTests = false, reporterOptions = {} } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'integration-'))
  let child

  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await once(child, 'close')
    }

    await rm(root, { recursive: true, force: true })
  })

  await symlink(dirname(vitestPackage), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
  const file = join(root, 'sample.test.js')
  if (source !== null) await writeFile(file, source)
  await cp(reporterDirectory, join(root, 'reporter'), { recursive: true })
  const config = join(root, 'vitest.config.mjs')

  await writeFile(config, `
    import { PowerModeReporter } from './reporter/index.js'
    export default {
      clearScreen: false,
      test: {
        root: ${JSON.stringify(root)},
        watch: ${watch},
        passWithNoTests: ${passWithNoTests},
        reporters: [new PowerModeReporter(${JSON.stringify({ sound: true, ...reporterOptions })})],
        testTimeout: 3000,
        fileParallelism: false,
      },
    }
  `)

  child = spawn(process.execPath, [vitestCLI, watch ? '--watch' : 'run', '--config', config], {
    cwd: root,
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST_HYPE_'))),
      CI: '1', NO_COLOR: '1', FORCE_COLOR: '0', VITEST_HYPE_SOUND: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { output += data })
  const exited = once(child, 'close').then(([code, signal]) => ({ code, signal, output }))

  const waitFor = async (pattern, count = 1) => {
    const deadline = Date.now() + 15_000
    while ((output.match(pattern) ?? []).length < count) {
      if (child.exitCode !== null || child.signalCode !== null || Date.now() > deadline) {
        throw new Error(`Did not receive ${pattern} (${count} times)\n${output}`)
      }
      await delay(25)
    }
  }

  return { root, file, child, exited, waitFor, output: () => output }
}

const passing = `
  import { test, expect } from 'vitest'
  test.concurrent('one', () => expect(1).toBe(1))
  test.concurrent('two', () => expect(2).toBe(2))
  test.skip('skipped', () => {})
  test.todo('later')
`

test(`Vitest ${vitestVersion}: concurrent pass, skipped and todo counts`, { timeout: 20_000 }, async t => {
  const { exited } = await fixture(t, passing)
  const { code, output } = await exited

  assert.equal(code, 0, output)
  assert.match(output, /Tests\s+2 passed \| 1 skipped \| 1 todo \(4\)/)
  assert.equal((output.match(/Test Files/g) ?? []).length, 1)
})

for (const [name, source, diagnostic] of [
  ['assertion', `import { test, expect } from 'vitest'; test('broken assertion', () => expect('actual').toBe('expected'))`, /expected.*actual.*to be.*expected|Expected:.*expected/s],
  ['collection', `throw new Error('collection exploded')`, /collection exploded/],
  ['beforeAll', `import { test, beforeAll } from 'vitest'; beforeAll(() => { throw new Error('setup exploded') }); test('never runs', () => {})`, /setup exploded/],
  ['afterAll', `import { test, afterAll } from 'vitest'; test('passes', () => {}); afterAll(() => { throw new Error('teardown exploded') })`, /teardown exploded/],
  ['nested hook', `import { test, describe, afterAll } from 'vitest'; describe('nested', () => { test('passes', () => {}); afterAll(() => { throw new Error('nested exploded') }) })`, /nested exploded/],
  ['unhandled rejection', `import { test } from 'vitest'; test('unhandled', async () => { void Promise.reject(new Error('unhandled exploded')); await new Promise(r => setTimeout(r, 25)) })`, /unhandled exploded/],
]) {
  test(`Vitest ${vitestVersion}: ${name} retains diagnostics and reports failure`, { timeout: 20_000 }, async t => {
    const { exited } = await fixture(t, source)
    const { code, output } = await exited
    assert.equal(code, 1, output)
    assert.match(output, diagnostic)
    assert.match(output, /Test Files\s+.*(?:failed|passed)/)
    assert.doesNotMatch(output, /^PASS \d|streak x|GREEN/m)
  })
}

test(`Vitest ${vitestVersion}: empty runs honour passWithNoTests`, { timeout: 30_000 }, async t => {
  for (const passWithNoTests of [false, true]) {
    const { exited } = await fixture(t, null, { passWithNoTests })
    const { code, output } = await exited
    assert.equal(code, passWithNoTests ? 0 : 1, output)
    assert.match(output, /No test files found/i)
    assert.doesNotMatch(output, /streak x|GREEN/)
  }
})

test(`Vitest ${vitestVersion}: CI output has one native summary and no rewards`, { timeout: 20_000 }, async t => {
  const { exited } = await fixture(t, passing)
  const { code, output } = await exited
  assert.equal(code, 0, output)
  assert.equal((output.match(/Test Files/g) ?? []).length, 1)
  assert.doesNotMatch(output, /Streak|GREEN/)
  assert.doesNotMatch(output, /\x1b|●|✨|🔥/)
})

test(`Vitest ${vitestVersion}: real file edits rerun pass → pass → fail → pass`, { timeout: 60_000 }, async t => {
  const f = await fixture(t, passing, { watch: true })
  await f.waitFor(/(?:Waiting|Watching) for file changes/gi)
  assert.match(f.output(), /Tests\s+2 passed/)
  const nextPass = `import { test, expect } from 'vitest'; test('edited', () => expect(3).toBe(3))\n`
  await writeFile(f.file, nextPass)
  await f.waitFor(/(?:Waiting|Watching) for file changes/gi, 2)
  assert.match(f.output(), /Tests\s+1 passed \(1\)/)
  await writeFile(f.file, nextPass.replace('toBe(3)', 'toBe(4)'))
  await f.waitFor(/(?:Waiting|Watching) for file changes/gi, 3)
  assert.match(f.output(), /Tests\s+1 failed \(1\)/)
  await writeFile(f.file, nextPass)
  await f.waitFor(/(?:Waiting|Watching) for file changes/gi, 4)
  assert.match(f.output(), /Tests\s+1 passed \(1\)/)
  assert.equal((f.output().match(/Test Files/g) ?? []).length, 4)
  assert.equal((f.output().match(/Tests\s+\d+ passed/g) ?? []).length, 3)
  f.child.kill('SIGINT')
  await f.exited
})

test(`Vitest ${vitestVersion}: snapshot failure retains diff and snapshot summary`, { timeout: 20_000 }, async t => {
  const { exited } = await fixture(t, `import { test, expect } from 'vitest';
    test('snapshot', () => expect('actual').toMatchInlineSnapshot('"expected"'))`)
  const { code, output } = await exited
  assert.equal(code, 1, output)
  assert.match(output, /Snapshot.*mismatched/i)
  assert.match(output, /Snapshots\s+1 failed/)
  assert.match(output, /expected/)
  assert.match(output, /actual/)
  assert.equal((output.match(/Test Files/g) ?? []).length, 1)
})

test(`Vitest ${vitestVersion}: large suite keeps every custom symbol and one summary`, { timeout: 30_000 }, async t => {
  const { exited } = await fixture(t, `import { test } from 'vitest';
    for (let i = 0; i < 10000; i++) test('case ' + i, () => {})`)
  const { code, output } = await exited
  assert.equal(code, 0, output)
  assert.equal((output.match(/💚/g) ?? []).length, 10000)
  assert.equal((output.match(/Test Files/g) ?? []).length, 1)
  assert.match(output, /Tests\s+10000 passed/)
})

for (const silent of [true, false, 'passed-only']) {
  test(`Vitest ${vitestVersion}: forwards silent=${silent} to the dot reporter`, { timeout: 20_000 }, async t => {
    const { exited } = await fixture(t, `import { test, expect } from 'vitest';
      test('passing log', () => console.log('PASS_LOG_MESSAGE'));
      test('failing log', () => { console.log('FAIL_LOG_MESSAGE'); expect(1).toBe(2) })`,
      { reporterOptions: { silent } })
    const { code, output } = await exited
    assert.equal(code, 1, output)
    assert.equal(output.includes('PASS_LOG_MESSAGE\n'), silent === false, output)
    assert.equal(output.includes('FAIL_LOG_MESSAGE\n'), silent !== true, output)
    assert.match(output, /AssertionError/)
    assert.equal((output.match(/Test Files/g) ?? []).length, 1)
  })
}

test(`Vitest ${vitestVersion}: custom symbols keep user logs, errors and one summary`, { timeout: 20_000 }, async t => {
  const { exited } = await fixture(t, `import { test, expect } from 'vitest';
    test('pass', () => { console.log('literal: · x -'); expect(1).toBe(1) });
    test('fail', () => expect(1).toBe(2));
    test.skip('skip', () => {});
    test.todo('todo');`, { reporterOptions: { dot: '💚', failDot: '💔', skipDot: '⏭️' } })
  const { code, output } = await exited
  assert.equal(code, 1, output)
  assert.equal((output.match(/💚/g) ?? []).length, 1, output)
  assert.equal((output.match(/💔/g) ?? []).length, 1, output)
  assert.equal((output.match(/⏭️/g) ?? []).length, 2, output)
  assert.match(output, /literal: · x -/)
  assert.match(output, /AssertionError/)
  assert.equal((output.match(/Test Files/g) ?? []).length, 1)
})

test(`Vitest ${vitestVersion}: symbols can be overridden back to native characters`, { timeout: 20_000 }, async t => {
  const { exited } = await fixture(t, passing, { reporterOptions: { dot: '·', failDot: 'x', skipDot: '-' } })
  const { code, output } = await exited
  assert.equal(code, 0, output)
  assert.equal((output.match(/·/g) ?? []).length, 2, output)
  assert.doesNotMatch(output, /💚|💔|⏭️/)
})
