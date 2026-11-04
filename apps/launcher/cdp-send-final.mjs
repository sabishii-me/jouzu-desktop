import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser.contexts()[0].pages()[0];
const composer=page.getByLabel("Message Jouzu");
await composer.fill("继续");
await page.getByRole("button",{name:"Send"}).first().click();
await page.waitForTimeout(12000);
console.log((await page.locator("body").innerText()).slice(-220));
await browser.close();
