import { describe, expect, test } from 'bun:test'
import { hashPassword, normalizeName, registerAccount, validName, validPassword, verifyLogin, type Accounts } from '../src/games/bedwars/client/login'

describe('login: names and passwords', () => {
  test('names are trimmed and matched case-insensitively', () => {
    expect(normalizeName('  Steve  ')).toBe('steve')
    expect(validName('Steve')).toBe(true)
    expect(validName('Big Builder 42')).toBe(true)
    expect(validName('  s  ')).toBe(false)
    expect(validName('no!punct?uation')).toBe(false)
    expect(validName('x'.repeat(17))).toBe(false)
  })

  test('passwords have a floor and a ceiling', () => {
    expect(validPassword('pass')).toBe(true)
    expect(validPassword('abc')).toBe(false)
    expect(validPassword('x'.repeat(65))).toBe(false)
  })
})

describe('login: accounts', () => {
  test('hashing is deterministic per salt and differs between salts', async () => {
    const a = await hashPassword('hunter2', 'salt1')
    const b = await hashPassword('hunter2', 'salt1')
    const c = await hashPassword('hunter2', 'salt2')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).not.toContain('hunter2')
  })

  test('register then log in with the same password; the display name survives the round trip', async () => {
    let accounts: Accounts = await registerAccount({}, 'Steve', 'blocky')
    const name = await verifyLogin(accounts, 'steve', 'blocky')
    expect(name).toBe('Steve')
    // The stored copy never contains the password itself.
    expect(JSON.stringify(accounts)).not.toContain('blocky')
  })

  test('a wrong password, an unknown name and a duplicate name all fail clearly', async () => {
    const accounts = await registerAccount({}, 'Steve', 'blocky')
    expect(await verifyLogin(accounts, 'Steve', 'wrong')).toBeNull()
    expect(await verifyLogin(accounts, 'Alex', 'blocky')).toBeNull()
    await expect(registerAccount(accounts, 'steve', 'other')).rejects.toThrow('taken')
    await expect(registerAccount(accounts, 'Bad!', 'longenough')).rejects.toThrow('3 to 16')
    await expect(registerAccount(accounts, 'Alex', 'abc')).rejects.toThrow('at least 4')
  })
})
