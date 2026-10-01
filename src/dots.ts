import type { PowerModeReporterOptions } from './types.js'

type State = 'passed' | 'failed' | 'skipped' | 'pending'
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Terminal cells, counting a combined emoji as one two-cell glyph. */
export function symbolWidth(text: string): number {
  let width = 0
  for (const { segment } of segmenter.segment(text)) {
    if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(segment)) {
      width += 2
      continue
    }
    for (const char of segment) {
      if (/\p{Mark}|\p{Format}/u.test(char)) continue
      const code = char.codePointAt(0)!
      const wide = code >= 0x1100 && (
        code <= 0x115f || code === 0x2329 || code === 0x232a
        || (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f)
        || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff)
        || (code >= 0xfe10 && code <= 0xfe19) || (code >= 0xfe30 && code <= 0xfe6f)
        || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6)
        || (code >= 0x20000 && code <= 0x3fffd)
      )
      width += wide ? 2 : 1
    }
  }
  return width
}

export class Dots {
  private column = 0
  private readonly seen = new Set<string>()
  private readonly symbols: Record<Exclude<State, 'pending'>, { text: string; width: number }>

  constructor(
    options: PowerModeReporterOptions,
    private readonly write: (text: string) => void,
    private readonly columns: () => number,
    private readonly color: boolean,
  ) {
    const symbols = { passed: options.dot ?? '·', failed: options.failDot ?? 'x', skipped: options.skipDot ?? '-' }
    this.symbols = Object.fromEntries(Object.entries(symbols).map(([state, text]) => {
      const width = symbolWidth(text)
      if (!width || /[\p{Control}\p{Surrogate}\p{Line_Separator}\p{Paragraph_Separator}]/u.test(text)) {
        throw new TypeError(`The ${state} symbol must be nonempty printable text`)
      }
      return [state, { text, width }]
    })) as typeof this.symbols
  }

  start(): void {
    this.column = 0
    this.seen.clear()
  }

  result(id: string, state: State): void {
    if (state === 'pending' || this.seen.has(id)) return
    this.seen.add(id)
    const { text, width } = this.symbols[state]
    const columns = Math.max(1, this.columns() || 80)
    if (this.column && this.column + 1 + width > columns) this.endLine()
    if (this.column) {
      this.write(' ')
      this.column++
    }
    const color = state === 'passed' ? 32 : state === 'failed' ? 31 : 90
    this.write(this.color ? `\u001b[${color}m${text}\u001b[0m` : text)
    this.column += width
    if (this.column >= columns) this.endLine()
  }

  endLine(): void {
    if (this.column) this.write('\n')
    this.column = 0
  }
}
