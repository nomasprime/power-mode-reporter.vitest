import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

export class SoundPlayer {
  private playing: symbol | undefined

  constructor(private readonly launch: typeof spawn = spawn) {}

  play(file: string): void {
    if (this.playing) return
    const playback = Symbol('playback')
    this.playing = playback
    try {
      const child = this.launch('/usr/bin/afplay', [resolve(file)], {
        stdio: 'ignore',
        shell: false,
      })
      const done = () => { if (this.playing === playback) this.playing = undefined }
      child.once('error', done)
      child.once('close', done)
      child.unref()
    } catch {
      this.playing = undefined
    }
  }
}
