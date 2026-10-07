import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'
import { icons } from './lib/icons.svelte'

icons.load()
openOtherSitesInBrowser()

export default mount(App, { target: document.getElementById('app')! })

// In the Windows app window (WebView2), links to other sites open in the
// user's own browser, where they are logged in, and not inside the app.
function openOtherSitesInBrowser() {
  if (!(window as Window & { chrome?: { webview?: unknown } }).chrome?.webview) return

  const otherSite = (href: string | URL | null | undefined) => {
    if (!href) return null
    try {
      const u = new URL(href, location.href)
      const web = u.protocol === 'https:' || u.protocol === 'http:'
      return web && u.origin !== location.origin ? u.href : null
    } catch {
      return null
    }
  }
  const openInBrowser = (url: string) => {
    fetch('/api/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }).catch(() => {})
  }

  const onClick = (e: MouseEvent) => {
    if (e.button !== 0 && e.button !== 1) return
    const link = e.target instanceof Element ? e.target.closest('a[href]') : null
    const url = otherSite(link?.getAttribute('href'))
    if (!url) return
    e.preventDefault()
    openInBrowser(url)
  }
  document.addEventListener('click', onClick, true)
  document.addEventListener('auxclick', onClick, true)

  const open = window.open.bind(window)
  window.open = (href?: string | URL, target?: string, features?: string) => {
    const url = otherSite(href)
    if (!url) return open(href, target, features)
    openInBrowser(url)
    return null
  }
}
