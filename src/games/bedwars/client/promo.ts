/**
 * The Freebuff promotion on the hosted copy of the game: a sponsor card on the
 * menu, a Remix button in the pause menu and a line on the round summary, all
 * linking to freebuff.com. Shown only when the page is served over https (or
 * with ?promo=1 to preview it locally); the desktop app and local runs are
 * http, so a copy made from this template never shows it unless it is hosted.
 * Delete this file and its three call sites to remove it.
 */
const SITE = 'https://freebuff.com/'

/** freebuff.com with campaign tags, so visits from the game can be counted. */
export function freebuffUrl(content: string): string {
  return `${SITE}?utm_source=buffcraft&utm_medium=game&utm_campaign=templates&utm_content=${content}`
}

export function promoShown(): boolean {
  return location.protocol === 'https:' || new URLSearchParams(location.search).get('promo') === '1'
}

const link = (content: string, className: string, label: string) =>
  `<a class="${className}" href="${freebuffUrl(content)}" target="_blank" rel="noopener">${label}</a>`

/** The Freebuff F, drawn as two blocks of the sage ramp. */
export const FREEBUFF_MARK = `<svg class="fb-mark" viewBox="0 0 77.18 77.19" aria-hidden="true"><polygon fill="#b5cea5" points="77.18 0 77.18 19.3 19.3 19.3 19.3 77.19 0 77.19 0 0 77.18 0"/><polygon fill="#82966f" points="63.62 24.89 63.62 44.19 44.32 44.19 44.32 77.19 25.03 77.19 25.03 24.89 63.62 24.89"/></svg>`

/** The sponsor card under the menu. */
export function promoCard(): string {
  if (!promoShown()) return ''
  return `<aside class="promo">
    <div class="promo-head">${FREEBUFF_MARK}<div><p class="promo-kicker">Built with Freebuff</p><h2>The 100% free AI app builder</h2></div></div>
    <p>Start from one of Freebuff's templates (a store, a CRM, or soon a game like this one), then describe what you want and Freebuff builds, previews and deploys it. No subscription, no API keys.</p>
    <ul class="promo-points"><li>Built from a sentence</li><li>Live preview</li><li>One-click deploy</li><li>Starter templates</li></ul>
    <div class="menu-pair">${link('menu-remix', 'btn primary', 'Remix this game')}${link('menu-build', 'btn', 'Build your own')}</div>
  </aside>`
}

/** A Remix button for the pause menu. */
export function remixButton(): string {
  return promoShown() ? link('pause-remix', 'btn remix', 'Remix in Freebuff') : ''
}

/** A line for the end-of-round summary. */
export function summaryLine(): string {
  return promoShown() ? `<p class="promo-line">${FREEBUFF_MARK}Want your own version? ${link('summary-remix', '', 'Remix Buffcraft in Freebuff')}, free.</p>` : ''
}
