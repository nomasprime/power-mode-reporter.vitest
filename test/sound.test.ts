import { EventEmitter } from 'node:events'
import type { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SoundPlayer } from '../src/sound.js'

describe('macOS sound', () => {
  it('launches without a shell, releases the process handle, and prevents overlapping audio', () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    const launch = vi.fn(() => child)
    const sound = new SoundPlayer(launch as unknown as typeof spawn)
    const file = 'a sound; $(touch dangerous).aiff'
    sound.play(file)
    sound.play(file)
    expect(launch).toHaveBeenCalledTimes(1)
    expect(launch).toHaveBeenCalledWith('/usr/bin/afplay', [resolve(file)], { stdio: 'ignore', shell: false })
    expect(child.unref).toHaveBeenCalledOnce()
    child.emit('close', 0)
    sound.play(file)
    expect(launch).toHaveBeenCalledTimes(2)
  })

  it('silently handles missing players, invalid files, and spawn exceptions', () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    const launch = vi.fn().mockImplementationOnce(() => { throw new Error('unavailable') }).mockReturnValue(child)
    const sound = new SoundPlayer(launch as unknown as typeof spawn)
    expect(() => sound.play('/missing')).not.toThrow()
    expect(() => sound.play('/missing')).not.toThrow()
    expect(() => child.emit('error', new Error('ENOENT'))).not.toThrow()
    child.emit('close', 1)
    sound.play('/valid')
    expect(launch).toHaveBeenCalledTimes(3)
  })

  it('ignores a late close event from a failed playback after another sound starts', () => {
    const first = Object.assign(new EventEmitter(), { unref: vi.fn() })
    const second = Object.assign(new EventEmitter(), { unref: vi.fn() })
    const launch = vi.fn().mockReturnValueOnce(first).mockReturnValue(second)
    const sound = new SoundPlayer(launch as unknown as typeof spawn)
    sound.play('/missing')
    first.emit('error', new Error('ENOENT'))
    sound.play('/valid')
    first.emit('close', 1)
    sound.play('/another')
    expect(launch).toHaveBeenCalledTimes(2)
    second.emit('close', 0)
    sound.play('/another')
    expect(launch).toHaveBeenCalledTimes(3)
  })
})
