import type { TestModule, TestRunEndReason } from 'vitest/node'
import type { ResolvedOptions } from './types.js'

/** Choose one sound for this run; interruption takes precedence over partial failures. */
export function soundForRun(modules: ReadonlyArray<TestModule>, errors: ReadonlyArray<unknown>, reason: TestRunEndReason, options: ResolvedOptions): string | false {
  if (reason === 'interrupted') return options.interruptedSoundFile
  if (reason === 'failed' || errors.length) return options.failSoundFile
  let passed = false
  let skipped = false
  let pending = false
  for (const module of modules) {
    if (module.state() === 'failed' || module.errors().length) return options.failSoundFile
    for (const suite of module.children.allSuites()) if (suite.errors().length) return options.failSoundFile
    for (const test of module.children.allTests()) {
      const state = test.result().state
      if (state === 'failed') return options.failSoundFile
      if (state === 'passed') passed = true
      if (state === 'skipped') skipped = true
      if (state === 'pending') pending = true
    }
  }
  if (pending) return options.interruptedSoundFile
  return passed ? options.soundFile : skipped ? options.skippedSoundFile : options.emptySoundFile
}
