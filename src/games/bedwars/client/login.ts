/**
 * Local accounts: the menu opens behind a name and password. Credentials
 * never leave the device — each account is stored in localStorage as a salted
 * SHA-256 hash. This is a gate for a shared machine, not online
 * authentication: anyone with the device can read or clear the storage.
 */

export interface Account {
  name: string
  salt: string
  hash: string
}

export type Accounts = Record<string, Account>

const ACCOUNTS_KEY = 'bigcraft-accounts'
const SESSION_KEY = 'bigcraft-session'

/** The lookup key for an account: trimmed and lowercased. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

export function validName(name: string): boolean {
  const n = name.trim()
  return n.length >= 3 && n.length <= 16 && /^[\w \-]+$/.test(n)
}

export function validPassword(password: string): boolean {
  return password.length >= 4 && password.length <= 64
}

/** Salted SHA-256 as hex; a simple fallback where Web Crypto is unavailable. */
export async function hashPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`)
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    const digest = await subtle.digest('SHA-256', data)
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  let h = 5381
  for (const b of data) h = ((h * 33) ^ b) >>> 0
  return `fb${h.toString(16)}`
}

export function randomSalt(): string {
  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** A copy of `accounts` with a new account; throws an Error whose message is fit to show a player. */
export async function registerAccount(accounts: Accounts, name: string, password: string): Promise<Accounts> {
  if (!validName(name)) throw new Error('Names are 3 to 16 letters, numbers, spaces or dashes.')
  if (!validPassword(password)) throw new Error('Passwords are at least 4 characters.')
  const key = normalizeName(name)
  if (accounts[key]) throw new Error('That name is taken. Log in instead, or pick another.')
  const salt = randomSalt()
  return { ...accounts, [key]: { name: name.trim(), salt, hash: await hashPassword(password, salt) } }
}

/** The account's display name when the password matches, otherwise null. */
export async function verifyLogin(accounts: Accounts, name: string, password: string): Promise<string | null> {
  const account = accounts[normalizeName(name)]
  if (!account) return null
  return (await hashPassword(password, account.salt)) === account.hash ? account.name : null
}

// Storage: localStorage, guarded, since private modes and tests may lack it. --

export function loadAccounts(): Accounts {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY)
    return raw ? (JSON.parse(raw) as Accounts) : {}
  } catch {
    return {}
  }
}

export function saveAccounts(accounts: Accounts): void {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts))
  } catch {}
}

/** The logged-in account's display name, if the stored session still matches an account. */
export function sessionName(): string | null {
  try {
    const key = localStorage.getItem(SESSION_KEY)
    if (!key) return null
    return loadAccounts()[key]?.name ?? null
  } catch {
    return null
  }
}

export function saveSession(name: string): void {
  try {
    localStorage.setItem(SESSION_KEY, normalizeName(name))
  } catch {}
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {}
}

// The screen ------------------------------------------------------------------

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/**
 * The login card: log in, or create an account. `onDone` receives the display
 * name once a password checks out. `background` is the menu's dirt tile URL.
 */
export function showLogin(container: HTMLElement, onDone: (name: string) => void, background = ''): void {
  let mode: 'login' | 'create' = 'login'
  const render = (error = '') => {
    const creating = mode === 'create'
    container.innerHTML = `
      <div class="menu"${background ? ` style="background-image:url(${background})"` : ''}>
        <div class="menu-wrap">
          <h1 class="menu-title">Big Craft</h1>
          <p class="menu-tagline">Protect your bed. Break theirs.</p>
          <div class="menu-card">
            <div class="auth-tabs">
              <button class="btn${creating ? '' : ' primary'}" data-auth="login">Log in</button>
              <button class="btn${creating ? ' primary' : ''}" data-auth="create">Create account</button>
            </div>
            <form id="auth-form">
              <label class="field"><span>Name</span><input id="auth-name" maxlength="16" autocomplete="username" placeholder="Your name" required></label>
              <label class="field"><span>Password</span><input id="auth-password" type="password" maxlength="64" autocomplete="${creating ? 'new-password' : 'current-password'}" placeholder="${creating ? 'At least 4 characters' : 'Your password'}" required></label>
              ${error ? `<p class="auth-error">${esc(error)}</p>` : ''}
              <div class="menu-buttons"><button class="btn primary" type="submit">${creating ? 'Create account' : 'Log in'}</button></div>
            </form>
            <p class="menu-foot">Accounts live on this device only: your name and password never leave your computer.</p>
          </div>
        </div>
      </div>`
    for (const b of container.querySelectorAll<HTMLButtonElement>('[data-auth]'))
      b.addEventListener('click', () => {
        mode = b.dataset.auth as 'login' | 'create'
        render()
      })
    container.querySelector<HTMLFormElement>('#auth-form')!.addEventListener('submit', (e) => {
      e.preventDefault()
      void submit()
    })
    container.querySelector<HTMLInputElement>('#auth-name')!.focus()
  }
  const submit = async () => {
    const name = container.querySelector<HTMLInputElement>('#auth-name')!.value
    const password = container.querySelector<HTMLInputElement>('#auth-password')!.value
    try {
      const accounts = loadAccounts()
      let who: string | null
      if (mode === 'create') {
        const next = await registerAccount(accounts, name, password)
        saveAccounts(next)
        who = name.trim()
      } else who = await verifyLogin(accounts, name, password)
      if (!who) {
        render('No account with that name and password. Check both, or create the account.')
        return
      }
      saveSession(who)
      onDone(who)
    } catch (error) {
      render(error instanceof Error ? error.message : 'Something went wrong. Try again.')
    }
  }
  render()
}
