import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DotReporter } from 'vitest/node'
import type { SerializedError, TestModule, TestRunEndReason, Vitest } from 'vitest/node'
import { PowerModeReporter } from '../src/reporter.js'
import type { PowerModeReporterOptions } from '../src/types.js'
import { SoundPlayer } from '../src/sound.js'
import * as environment from '../src/environment.js'

const resolveOptions = environment.resolveOptions
function module(states: Array<'passed' | 'failed' | 'skipped' | 'pending'> = ['passed'], problem?: 'module' | 'suite'): TestModule {
  return {
    state: () => problem === 'module' ? 'failed' : 'passed',
    errors: () => problem === 'module' ? [new Error('collection')] : [],
    children: {
      allTests: () => states.map((state, i) => ({ id: String(i), result: () => ({ state }) })),
      allSuites: () => [{ errors: () => problem === 'suite' ? [new Error('hook')] : [] }],
    },
  } as unknown as TestModule
}

beforeEach(() => {
  vi.spyOn(environment, 'resolveOptions').mockImplementation(options => resolveOptions(options, {
    env: { NO_COLOR: '1' }, isTTY: true, platform: 'darwin',
  }))
  vi.spyOn(DotReporter.prototype, 'onInit').mockImplementation(function (this: DotReporter, ctx) { this.ctx = ctx })
  vi.spyOn(DotReporter.prototype, 'onTestRunStart').mockImplementation(() => {})
  vi.spyOn(DotReporter.prototype, 'onTestRunEnd').mockImplementation(() => {})
  vi.spyOn(SoundPlayer.prototype, 'play').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

function reporter(options: PowerModeReporterOptions = {}) {
  const log = vi.fn()
  const result = new PowerModeReporter(options)
  result.onInit({
    logger: { outputStream: { isTTY: true, write: vi.fn() }, getColumns: () => 80, log },
  } as unknown as Vitest)
  result.onTestRunStart([])
  return { result, log }
}

it('inherits native summaries and watch controls and adds no status line', () => {
  const { result, log } = reporter()
  const modules = [module()]
  expect(result).toBeInstanceOf(DotReporter)
  expect(result.reportSummary).toBe(DotReporter.prototype.reportSummary)
  expect(result.onWatcherStart).toBe(DotReporter.prototype.onWatcherStart)
  result.onTestRunEnd(modules, [], 'passed')
  expect(DotReporter.prototype.onTestRunEnd).toHaveBeenCalledExactlyOnceWith(modules, [], 'passed')
  expect(log).not.toHaveBeenCalled()
  expect(SoundPlayer.prototype.play).toHaveBeenCalledExactlyOnceWith('/System/Library/Sounds/Glass.aiff')
  result.onTestRunEnd(modules, [], 'passed')
  expect(SoundPlayer.prototype.play).toHaveBeenCalledOnce()
})

it('plays the default failure sound and stays quiet for other default outcomes', () => {
  const { result, log } = reporter()
  result.onTestRunEnd([module(['failed'])], [], 'failed')
  expect(SoundPlayer.prototype.play).toHaveBeenCalledExactlyOnceWith('/System/Library/Sounds/Basso.aiff')
  for (const [modules, reason] of [[[], 'passed'], [[module(['skipped'])], 'passed'], [[module(['pending'])], 'interrupted']] as const) {
    result.onTestRunStart([])
    result.onTestRunEnd(modules, [], reason)
  }
  expect(SoundPlayer.prototype.play).toHaveBeenCalledOnce()
  expect(log).not.toHaveBeenCalled()
})

it.each([
  { name: 'passed', modules: [module()], reason: 'passed', expected: '/pass' },
  { name: 'passed with skips', modules: [module(['passed', 'skipped'])], reason: 'passed', expected: '/pass' },
  { name: 'assertion', modules: [module(['failed'])], reason: 'passed', expected: '/fail' },
  { name: 'run failure', modules: [module()], reason: 'failed', expected: '/fail' },
  { name: 'collection', modules: [module([], 'module')], reason: 'passed', expected: '/fail' },
  { name: 'hook', modules: [module(['passed'], 'suite')], reason: 'passed', expected: '/fail' },
  { name: 'unhandled', modules: [module()], reason: 'passed', errors: [{ message: 'unhandled' }], expected: '/fail' },
  { name: 'interrupted with failures', modules: [module(['failed', 'pending'])], reason: 'interrupted', expected: '/cancel' },
  { name: 'unfinished', modules: [module(['passed', 'pending'])], reason: 'passed', expected: '/cancel' },
  { name: 'all skipped/todo', modules: [module(['skipped', 'skipped'])], reason: 'passed', expected: '/skip' },
  { name: 'allowed empty', modules: [], reason: 'passed', expected: '/empty' },
  { name: 'empty module', modules: [module([])], reason: 'passed', expected: '/empty' },
  { name: 'disallowed empty', modules: [], reason: 'failed', expected: '/fail' },
])('selects one custom sound for $name', ({ modules, reason, errors, expected }) => {
  const { result } = reporter({ soundFile: '/pass', failSoundFile: '/fail', interruptedSoundFile: '/cancel', skippedSoundFile: '/skip', emptySoundFile: '/empty' })
  result.onTestRunEnd(modules, errors as SerializedError[] ?? [], reason as TestRunEndReason)
  expect(SoundPlayer.prototype.play).toHaveBeenCalledExactlyOnceWith(expected)
})

it('uses fresh results for each watch rerun', () => {
  const { result } = reporter({ soundFile: '/pass', failSoundFile: '/fail' })
  for (const reason of ['passed', 'failed', 'passed'] as const) {
    result.onTestRunStart([])
    result.onTestRunEnd([module([reason])], [], reason)
  }
  expect(vi.mocked(SoundPlayer.prototype.play).mock.calls).toEqual([['/pass'], ['/fail'], ['/pass']])
})

it('can mute individual outcomes or every sound', () => {
  for (const options of [{ sound: false }, { soundFile: false, failSoundFile: false }] as const) {
    const { result } = reporter(options)
    result.onTestRunEnd([module()], [], 'passed')
    result.onTestRunStart([])
    result.onTestRunEnd([module(['failed'])], [], 'failed')
  }
  expect(SoundPlayer.prototype.play).not.toHaveBeenCalled()
})

it.each([
  { env: { CI: '1', VITEST_HYPE_SOUND: '1' }, isTTY: true, platform: 'darwin' },
  { env: {}, isTTY: false, platform: 'darwin' },
  { env: {}, isTTY: true, platform: 'linux' },
  { env: {}, isTTY: true, platform: 'win32' },
])('disables all playback with restrictions: %j', terminal => {
  vi.mocked(environment.resolveOptions).mockImplementation(options => resolveOptions(options, terminal))
  const { result } = reporter({ sound: true, isTTY: true, interruptedSoundFile: '/cancel', skippedSoundFile: '/skip', emptySoundFile: '/empty' })
  for (const reason of ['passed', 'failed', 'interrupted'] as const) {
    result.onTestRunStart([])
    result.onTestRunEnd([], [], reason)
  }
  result.onTestRunStart([])
  result.onTestRunEnd([module(['skipped'])], [], 'passed')
  expect(SoundPlayer.prototype.play).not.toHaveBeenCalled()
})

it('honours native isTTY=false', () => {
  const { result } = reporter({ isTTY: false })
  expect(result.isTTY).toBe(false)
  result.onTestRunEnd([module()], [], 'passed')
  expect(SoundPlayer.prototype.play).not.toHaveBeenCalled()
})
