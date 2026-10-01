import { describe, expect, it } from 'vitest'
import { isCI, parseBoolean, resolveOptions } from '../src/environment.js'
import type { PowerModeReporterOptions } from '../src/types.js'

const environment = { env: {}, isTTY: true, platform: 'darwin' }

describe('environment restrictions', () => {
  it.each(['CI', 'CONTINUOUS_INTEGRATION', 'GITHUB_ACTIONS', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI', 'JENKINS_URL', 'JENKINS_HOME', 'TEAMCITY_VERSION', 'TF_BUILD', 'TRAVIS', 'APPVEYOR', 'BITBUCKET_BUILD_NUMBER'])(
    'detects %s independently', key => {
      expect(isCI({ [key]: 'true' })).toBe(true)
      expect(isCI({ CI: 'false', [key]: 'true' })).toBe(true)
    },
  )

  it('handles false and empty CI values', () => {
    expect(isCI({ CI: 'false', GITHUB_ACTIONS: '0', TF_BUILD: 'off', BUILDKITE: '' })).toBe(false)
    expect(isCI({ JENKINS_URL: 'https://ci.example.com', TEAMCITY_VERSION: '2026.1' })).toBe(true)
  })

  it.each([
    { env: { CI: '1' }, isTTY: true },
    { env: {}, isTTY: false },
    { env: { TERM: 'dumb' }, isTTY: true },
  ])('hard-disables interactive effects: %j', overrides => {
    const resolved = resolveOptions({ sound: true }, {
      ...environment, ...overrides,
    })
    expect(resolved).toMatchObject({ sound: false, color: false, interactive: false })
  })

  it('honours NO_COLOR and FORCE_COLOR=0', () => {
    for (const env of [{ NO_COLOR: '1' }, { NO_COLOR: 'false' }, { FORCE_COLOR: '0' }]) {
      expect(resolveOptions({}, { ...environment, env }).color).toBe(false)
    }
    expect(resolveOptions({}, { ...environment, env: { NO_COLOR: '' } }).color).toBe(true)
  })

  it('keeps sound macOS-only', () => {
    expect(resolveOptions({ sound: true }, { ...environment, platform: 'linux' }).sound).toBe(false)
    expect(resolveOptions({ sound: true }, { ...environment, platform: 'win32' }).sound).toBe(false)
  })

  it('disables interactive effects when isTTY is explicitly false', () => {
    expect(resolveOptions({ isTTY: false, sound: true }, environment))
      .toMatchObject({ interactive: false, color: false, sound: false })
  })

})

describe('configuration', () => {
  it.each(['1', 'true', 'on', ' TRUE '])('parses enabled value %s', value => expect(parseBoolean(value)).toBe(true))
  it.each(['0', 'false', 'off', ' OFF '])('parses disabled value %s', value => expect(parseBoolean(value)).toBe(false))
  it.each(['', 'yes', 'nope', undefined])('ignores invalid value %s', value => expect(parseBoolean(value)).toBeUndefined())

  it.each([
    ['sound', 'SOUND'],
  ] as const)('overrides %s through its environment variable', (key, suffix) => {
    const initial: PowerModeReporterOptions = { [key]: true }
    const env = { [`VITEST_HYPE_${suffix}`]: '0' }
    expect(resolveOptions(initial, { ...environment, env })[key]).toBe(false)
    expect(resolveOptions({ [key]: false }, { ...environment, env: { ...env, [`VITEST_HYPE_${suffix}`]: 'on' } })[key]).toBe(true)
    expect(resolveOptions(initial, { ...environment, env: { ...env, [`VITEST_HYPE_${suffix}`]: 'invalid' } })[key]).toBe(true)
  })

  it('resolves sound paths without enabling sound implicitly', () => {
    const result = resolveOptions({ soundFile: '/one.aiff' }, { ...environment, env: { VITEST_HYPE_SOUND_FILE: '/two.aiff' } })
    expect(result.soundFile).toBe('/two.aiff')
    expect(result.sound).toBe(false)
  })
})

it.each([
  ['soundFile', 'SOUND_FILE'], ['failSoundFile', 'FAIL_SOUND_FILE'],
  ['interruptedSoundFile', 'INTERRUPTED_SOUND_FILE'], ['skippedSoundFile', 'SKIPPED_SOUND_FILE'],
  ['emptySoundFile', 'EMPTY_SOUND_FILE'],
] as const)('resolves paths and mute overrides for %s', (key, suffix) => {
  expect(resolveOptions({ [key]: false }, environment)[key]).toBe(false)
  expect(resolveOptions({ [key]: '/option' }, { ...environment, env: { [`VITEST_HYPE_${suffix}`]: '/env' } })[key]).toBe('/env')
  for (const mute of ['false', '0', 'off']) {
    expect(resolveOptions({ [key]: '/option' }, { ...environment, env: { [`VITEST_HYPE_${suffix}`]: mute } })[key]).toBe(false)
  }
  expect(resolveOptions({ [key]: '/option' }, { ...environment, env: { [`VITEST_HYPE_${suffix}`]: ' ' } })[key]).toBe('/option')
})
