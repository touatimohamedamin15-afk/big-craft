import { expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : []
  })
}

test('the engine never imports a game, so other games can reuse it unchanged', () => {
  const offenders = files(join(import.meta.dir, '../src/engine')).filter((f) => /from '[^']*games\//.test(readFileSync(f, 'utf8')))
  expect(offenders).toEqual([])
})
