import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pnpmCLI = process.env.npm_execpath
assert.ok(pnpmCLI && process.env.npm_config_user_agent?.startsWith('pnpm/'), 'Run this script through pnpm run verify:package')
const pnpm = (args, cwd = root) => exec(process.execPath, [pnpmCLI, ...args], { cwd, maxBuffer: 4 * 1024 * 1024 })
const artifacts = join(root, 'artifacts')
await mkdir(artifacts, { recursive: true })
const { stdout } = await pnpm(['pack', '--json', '--pack-destination', artifacts])
const packed = JSON.parse(stdout.slice(stdout.indexOf('{\n')))
assert.ok(packed.files.some(file => file.path === 'dist/index.js'))
assert.ok(packed.files.some(file => file.path === 'dist/index.d.ts'))
assert.ok(!packed.files.some(file => /(?:session|keyboard|snapshot)/.test(file.path)), 'Obsolete workflow modules were packed')
for (const path of ['README.md', 'LICENSE', 'package.json']) assert.ok(packed.files.some(file => file.path === path))
assert.ok(packed.files.every(file => /^(dist\/.*\.(js|d\.ts)|README\.md|LICENSE|package\.json)$/.test(file.path)), 'Unexpected package contents')
const tarball = resolve(artifacts, packed.filename)
const consumer = await mkdtemp(join(tmpdir(), 'hype-consumer-'))
try {
  const { devDependencies } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', devDependencies }))
  // Preserve the toolchain's transitive versions so a frozen install populates everything needed offline.
  await copyFile(join(root, 'pnpm-lock.yaml'), join(consumer, 'pnpm-lock.yaml'))
  const localVersion = async name => JSON.parse(await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8')).version
  const vitestVersion = process.env.VITEST_VERIFY_VERSION || await localVersion('vitest')
  // Use pnpm's store to prove the packed artifact works independently of this checkout.
  await pnpm(['add', '--save-dev', '--offline', '--ignore-scripts', tarball,
    `vitest@${vitestVersion}`, `typescript@${await localVersion('typescript')}`, `@types/node@${await localVersion('@types/node')}`], consumer)
  await exec(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict'
    import ReporterClass, { PowerModeReporter } from 'power-mode-reporter.vitest'
    assert.equal(ReporterClass, PowerModeReporter)
    const { DotReporter } = await import('vitest/node')
    assert.ok(new PowerModeReporter() instanceof DotReporter)
    assert.equal(typeof new PowerModeReporter().onTestRunStart, 'function')
  `], { cwd: consumer })
  await writeFile(join(consumer, 'consumer.ts'), `
import ReporterClass, { PowerModeReporter, type PowerModeReporterOptions } from 'power-mode-reporter.vitest'
import type { Reporter } from 'vitest/node'
const options: PowerModeReporterOptions = { sound: false, soundFile: '/pass.aiff', failSoundFile: '/fail.aiff', interruptedSoundFile: '/cancel.aiff', skippedSoundFile: false, emptySoundFile: false, isTTY: false, silent: 'passed-only', dot: '💚', failDot: '💔', skipDot: '⏭️' }
const reporters: Reporter[] = [new ReporterClass(options), new PowerModeReporter(options)]
void reporters
`)
  await exec(process.execPath, [join(consumer, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict',
    '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'consumer.ts'], { cwd: consumer })
  await writeFile(join(consumer, 'sample.test.js'), `import { test, expect } from 'vitest'; test('packed consumer', () => expect(2 + 2).toBe(4))`)
  await writeFile(join(consumer, 'vitest.config.mjs'), `export default { test: {
    reporters: [['power-mode-reporter.vitest', { sound: false, failSoundFile: '/fail.aiff', dot: '💚' }]],
  } }`)
  const result = await exec(process.execPath, [join(consumer, 'node_modules/vitest/vitest.mjs'), 'run'], {
    cwd: consumer, env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST_HYPE_'))),
      CI: '1', NO_COLOR: '1', FORCE_COLOR: '0',
    },
  })
  assert.match(result.stdout, /Tests\s+1 passed/)
  assert.equal((result.stdout.match(/💚/g) ?? []).length, 1)
  assert.equal((result.stdout.match(/Test Files/g) ?? []).length, 1)
  const [tree] = JSON.parse((await pnpm(['list', 'vitest', '--json'], consumer)).stdout)
  assert.equal(tree.devDependencies.vitest.version, vitestVersion)
  console.log(`Verified ${packed.name}@${packed.version} with Vitest ${vitestVersion}`)
  console.log(`${packed.files.length} files, ${(await stat(tarball)).size} bytes packed`)
  console.log(`Tarball: ${tarball}`)
} catch (error) {
  if (error.stdout) console.error(error.stdout)
  if (error.stderr) console.error(error.stderr)
  throw error
} finally {
  await rm(consumer, { recursive: true, force: true })
}
