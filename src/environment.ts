import type { PowerModeReporterOptions, ResolvedOptions } from './types.js'

type Env = Readonly<Record<string, string | undefined>>

export interface Environment {
  env: Env
  isTTY: boolean
  platform: string
}

export function parseBoolean(value: string | undefined): boolean | undefined {
  switch (value?.trim().toLowerCase()) {
    case '1': case 'true': case 'on': return true
    case '0': case 'false': case 'off': return false
    default: return undefined
  }
}

export function isCI(env: Env): boolean {
  return [
    'CI', 'CONTINUOUS_INTEGRATION', 'GITHUB_ACTIONS', 'GITLAB_CI',
    'BUILDKITE', 'CIRCLECI', 'JENKINS_URL', 'JENKINS_HOME',
    'TEAMCITY_VERSION', 'TF_BUILD', 'TRAVIS', 'APPVEYOR', 'BITBUCKET_BUILD_NUMBER',
  ].some(key => {
    const value = env[key]?.trim()
    return Boolean(value) && parseBoolean(value) !== false
  })
}

export function resolveOptions(options: PowerModeReporterOptions, environment: Environment): ResolvedOptions {
  const { env, isTTY, platform } = environment
  const interactive = isTTY && options.isTTY !== false && !isCI(env) && env.TERM !== 'dumb'
  const file = (value: string | false | undefined, suffix: string, fallback: string | false) => {
    const override = env[`VITEST_HYPE_${suffix}`]?.trim()
    if (override) return parseBoolean(override) === false ? false : override
    return value ?? fallback
  }

  return {
    interactive,
    sound: interactive && platform === 'darwin' && (parseBoolean(env.VITEST_HYPE_SOUND) ?? options.sound ?? false),
    soundFile: file(options.soundFile, 'SOUND_FILE', '/System/Library/Sounds/Glass.aiff'),
    failSoundFile: file(options.failSoundFile, 'FAIL_SOUND_FILE', '/System/Library/Sounds/Basso.aiff'),
    interruptedSoundFile: file(options.interruptedSoundFile, 'INTERRUPTED_SOUND_FILE', false),
    skippedSoundFile: file(options.skippedSoundFile, 'SKIPPED_SOUND_FILE', false),
    emptySoundFile: file(options.emptySoundFile, 'EMPTY_SOUND_FILE', false),
    color: interactive && !env.NO_COLOR && parseBoolean(env.FORCE_COLOR) !== false,
  }
}
