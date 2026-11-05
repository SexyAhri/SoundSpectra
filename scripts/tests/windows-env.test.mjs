import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { windowsBuildEnvironment } from '../windows-env.mjs'

test('Windows child environment keeps npm reachable without duplicate Path spellings', { skip: process.platform !== 'win32' }, () => {
  const { env } = windowsBuildEnvironment()
  assert.deepEqual(Object.keys(env).filter(k => k.toLowerCase() === 'path'), ['PATH'])
  const version = execFileSync('cmd.exe', ['/d', '/c', 'npm --version'], { env, encoding: 'utf8', windowsHide: true }).trim()
  assert.match(version, /^\d+\.\d+\.\d+$/)
})
