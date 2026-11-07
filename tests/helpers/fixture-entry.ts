import type { Route } from '@playwright/test'

/** Reuse Vite's exact optimized React URLs so routed fixtures share its singleton. */
export async function fulfillFixtureEntry(route: Route, body: string) {
  const source = await (await route.fetch()).text()
  const modules = new Map([...source.matchAll(/["'](\/node_modules\/\.vite\/deps\/[^"']+)["']/g)].map(match => [match[1].split('?')[0], match[1]]))
  const resolved = body.replace(/["'](\/node_modules\/\.vite\/deps\/[^"']+)["']/g, (match, url: string) => JSON.stringify(modules.get(url.split('?')[0]) ?? url))
  await route.fulfill({ contentType: 'text/javascript', body: resolved })
}
