import { DotReporter, experimental_getRunnerTask } from 'vitest/node'
import type { SerializedError, TestCase, TestModule, TestRunEndReason, TestSpecification, Vitest } from 'vitest/node'
import { Dots } from './dots.js'
import { resolveOptions } from './environment.js'
import { soundForRun } from './outcome.js'
import { SoundPlayer } from './sound.js'
import type { PowerModeReporterOptions, ResolvedOptions } from './types.js'

/** Vitest's dot reporter with configurable symbols and optional macOS sounds. */
export class PowerModeReporter extends DotReporter {
  private readonly hypeOptions: PowerModeReporterOptions
  private resolved: ResolvedOptions | undefined
  private readonly sound = new SoundPlayer()
  private active = false
  private dots: Dots | undefined

  constructor(options: PowerModeReporterOptions = {}) {
    const resolved = {
      sound: true,
      soundFile: '/System/Library/Sounds/Glass.aiff',
      failSoundFile: '/System/Library/Sounds/Basso.aiff',
      interruptedSoundFile: false,
      skippedSoundFile: false,
      emptySoundFile: false,
      dot: '💚',
      failDot: '💔',
      skipDot: '💛',
      ...options,
    } satisfies PowerModeReporterOptions

    super(resolved)
    this.hypeOptions = { ...resolved }
  }

  override onInit(vitest: Vitest): void {
    this.active = false
    const terminal = vitest.logger.outputStream as typeof vitest.logger.outputStream & { isTTY?: boolean }
    this.resolved = resolveOptions(this.hypeOptions, {
      env: process.env,
      isTTY: terminal.isTTY === true,
      platform: process.platform,
    })
    // Disable only the inherited dot window; summaries and diagnostics stay native.
    this.isTTY = false
    super.onInit(vitest)
    this.isTTY = this.resolved.interactive
    this.dots = new Dots(this.hypeOptions,
      text => { vitest.logger.outputStream.write(text) },
      () => vitest.logger.getColumns(), this.resolved.color)
  }

  override onTestRunStart(specifications: ReadonlyArray<TestSpecification>): void {
    this.active = true
    this.dots?.start()
    super.onTestRunStart(specifications)
  }

  // Completed results drive our symbols instead of the inherited pending-test window.
  override onTestModuleCollected(): void {}
  override onTestCaseReady(): void {}

  override onTestCaseResult(test: TestCase): void {
    if (!this.active) return
    this.dots?.result(test.id, test.result().state)
    // Preserve BaseReporter's deferred console output for failed tests.
    if (test.result().state === 'failed') this.logFailedTask(experimental_getRunnerTask(test))
  }

  override shouldLog(...args: Parameters<DotReporter['shouldLog']>): boolean {
    const allowed = super.shouldLog(...args)
    if (allowed) this.dots?.endLine()
    return allowed
  }

  override onTestRunEnd(modules: ReadonlyArray<TestModule>, errors: ReadonlyArray<SerializedError>, reason: TestRunEndReason): void {
    if (!this.active) return
    this.active = false
    // Skipped modules may not produce individual result callbacks.
    for (const module of modules) {
      for (const test of module.children.allTests()) this.dots?.result(test.id, test.result().state)
    }
    super.onTestRunEnd(modules, errors, reason)
    if (this.resolved?.sound) {
      const file = soundForRun(modules, errors, reason, this.resolved)
      if (file) this.sound.play(file)
    }
  }
}
