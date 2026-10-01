import type { DotReporter } from 'vitest/node'

type DotReporterOptions = NonNullable<ConstructorParameters<typeof DotReporter>[0]>

/** Additions to Vitest's built-in dot reporter. */
export interface PowerModeReporterOptions extends DotReporterOptions {
  /** Symbol for a passing test. Default: 💚 */
  dot?: string
  /** Symbol for a failing test. Default: 💔 */
  failDot?: string
  /** Symbol for a skipped or todo test. Default: 💛 */
  skipDot?: string
  /** Enable run sounds on interactive macOS terminals. Default: true */
  sound?: boolean
  /** Passed-run sound path, or false to mute. Default: /System/Library/Sounds/Glass.aiff */
  soundFile?: string | false
  /** Failed-run sound path, or false to mute. Default: /System/Library/Sounds/Basso.aiff */
  failSoundFile?: string | false
  /** Interrupted-run sound path, or false to mute. Default: false */
  interruptedSoundFile?: string | false
  /** Sound when every test is skipped/todo, or false to mute. Default: false */
  skippedSoundFile?: string | false
  /** Sound for an allowed empty run, or false to mute. Default: false */
  emptySoundFile?: string | false
}

export interface ResolvedOptions extends Required<Pick<PowerModeReporterOptions,
  'sound' | 'soundFile' | 'failSoundFile' | 'interruptedSoundFile' | 'skippedSoundFile' | 'emptySoundFile'>> {
  interactive: boolean
  color: boolean
}
