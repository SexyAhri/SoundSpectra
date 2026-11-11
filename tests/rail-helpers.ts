import type { Page } from '@playwright/test'

// Click the actual SVG stroke near its end, away from the hanging cards.
export async function clickCord(page: Page, twice = false) {
  const cord = page.locator('.rail-cord-hit')
  await cord.waitFor({ state: 'visible' })
  await page.locator('.startup-screen').waitFor({ state: 'hidden' })
  const point = await cord.evaluate(node => {
    const path = node as SVGPathElement
    const point = path.getPointAtLength(path.getTotalLength() * .025)
    const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!)
    return { x: screen.x, y: screen.y }
  })
  if (twice) await page.mouse.dblclick(point.x, point.y, { delay: 90 })
  else await page.mouse.click(point.x, point.y)
}
