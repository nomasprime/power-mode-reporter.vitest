import { expect, it } from 'vitest'
import { Dots, symbolWidth } from '../src/dots.js'
import type { PowerModeReporterOptions } from '../src/types.js'

function output(options: PowerModeReporterOptions = {}, columns = 80, color = false) {
  let text = ''
  const dots = new Dots(options, chunk => { text += chunk }, () => columns, color)
  dots.start()
  return { dots, text: () => text }
}

it('uses configurable symbols for pass, fail and skip, without pending results', () => {
  const { dots, text } = output({ dot: '💚', failDot: '💔', skipDot: '⏭️' })
  dots.result('1', 'pending')
  dots.result('1', 'passed')
  dots.result('2', 'failed')
  dots.result('3', 'skipped')
  expect(text()).toBe('💚 💔 ⏭️')
})

it('wraps wide symbols without truncating, including an odd-width terminal', () => {
  const { dots, text } = output({ dot: '💚' }, 5)
  for (let i = 0; i < 9; i++) dots.result(String(i), 'passed')
  expect(text()).toBe('💚 💚\n💚 💚\n💚 💚\n💚 💚\n💚')
})

it.each(['💚', '👩‍💻', '🇬🇧', '⏭️', '界', 'é', '·', 'OK'])('measures display width for %s', symbol => {
  expect(symbolWidth(symbol)).toBe(['é', '·'].includes(symbol) ? 1 : 2)
})

it('does not repeat a result when final modules are reconciled, and resets on reruns', () => {
  const { dots, text } = output()
  dots.result('1', 'passed')
  dots.result('1', 'passed')
  dots.start()
  dots.result('1', 'passed')
  expect(text()).toBe('··')
})

it('finishes a partial row before user console output', () => {
  const { dots, text } = output()
  dots.result('1', 'failed')
  dots.endLine()
  dots.endLine()
  dots.result('2', 'passed')
  expect(text()).toBe('x\n·')
})

it.each(['', '\n', '\u001b[32m.', '\t', '\u200b'])('rejects nonprinting/control symbols: %j', dot => {
  expect(() => output({ dot })).toThrow('nonempty printable text')
})

it('colours only the indicators', () => {
  const { dots, text } = output({ dot: '💚' }, 80, true)
  dots.result('1', 'passed')
  expect(text()).toBe('\u001b[32m💚\u001b[0m')
})
