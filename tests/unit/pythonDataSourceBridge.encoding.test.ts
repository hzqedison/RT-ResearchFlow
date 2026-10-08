import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MultiSourcePreference } from '../../electron/shared/dataSourceTypes'

const mocked = vi.hoisted(() => ({ spawn: vi.fn(), mkdir: vi.fn(), input: '', envelope: {} as unknown }))
vi.mock('electron', () => ({ app: { getPath: () => 'D:/rt-data-source-unit' } }))
vi.mock('node:child_process', () => ({ spawn: mocked.spawn }))
vi.mock('node:fs/promises', () => ({ mkdir: mocked.mkdir }))

import { callPythonDataSource, dataBridgeMessage, installSelectedDataSourceExtensions } from '../../electron/main/services/pythonDataSourceBridge'

const config: MultiSourcePreference = {
  dailyProviders: ['akshare'], reportProviders: [], wencaiEnabled: false, pythonPath: 'D:/Python/python.exe',
}

beforeEach(() => {
  mocked.spawn.mockReset()
  mocked.mkdir.mockReset().mockResolvedValue(undefined)
  mocked.envelope = { ok: true, data: [{ '代码': '000001', '名称': '平安银行' }] }
  mocked.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(),
      stdin: Object.assign(new EventEmitter(), { end: (input: string) => {
        mocked.input = input
        queueMicrotask(() => {
          const bytes = Buffer.from(JSON.stringify(mocked.envelope), 'utf8')
          const split = Math.max(1, bytes.indexOf(Buffer.from('代', 'utf8')) + 1)
          child.stdout.emit('data', bytes.subarray(0, split))
          child.stdout.emit('data', bytes.subarray(split))
          child.emit('close', 0)
        })
      } }),
      kill: vi.fn(),
    })
    return child
  })
})

describe('Python data bridge encoding and source requirements', () => {
  it('uses an explicit UTF-8 flag even when isolated mode ignores environment variables', async () => {
    await expect(callPythonDataSource(config, { operation: 'akshare-limit-pool', tradeDate: '20261008' }))
      .resolves.toEqual([{ '代码': '000001', '名称': '平安银行' }])
    expect(mocked.spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['-X', 'utf8', '-I']))
    expect(mocked.spawn.mock.calls[0][2]).toMatchObject({ shell: false, windowsHide: true })
  })
  it('preserves Chinese request text and response characters split across output chunks', async () => {
    const result = await callPythonDataSource(config, { operation: 'iwencai', query: '昨日涨停' })
    expect(JSON.parse(mocked.input).query).toBe('昨日涨停')
    expect(result).toEqual([{ '代码': '000001', '名称': '平安银行' }])
  })
  it('rejects Python 3.10 for selected AKShare before creating a venv or running pip', async () => {
    mocked.envelope = { ok: true, data: { python: '3.10.9' } }
    await expect(installSelectedDataSourceExtensions(config)).rejects.toThrow('AKSHARE_PYTHON_VERSION_UNSUPPORTED')
    expect(mocked.spawn).toHaveBeenCalledTimes(1)
    expect(mocked.spawn.mock.calls[0][1]).not.toContain('venv')
    expect(dataBridgeMessage(new Error('AKSHARE_PYTHON_VERSION_UNSUPPORTED'))).toContain('3.11')
  })
  it('keeps arbitrary backend errors out of the user-facing message', () => {
    expect(dataBridgeMessage(new Error('secret-key=private'))).not.toContain('private')
  })
})
