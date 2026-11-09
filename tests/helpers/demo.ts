import type { Page } from '@playwright/test'

/** Rendering tests explicitly opt in; the product starts with real input. */
export async function setDemo(page:Page,enabled=true){
  await page.getByRole('switch',{name:'模拟预览',exact:true}).setChecked(enabled)
}
