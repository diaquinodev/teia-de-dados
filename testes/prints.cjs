"use strict";
// Gera os prints do README a partir da página publicada.
const path = require("node:path");
const pw = require("playwright-core");

const RAIZ = path.join(__dirname, "..");
const URL = "file:///" + path.join(RAIZ, "docs", "index.html").replace(/\\/g, "/");
const SAIDA = path.join(RAIZ, "docs", "prints");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

(async () => {
  require("node:fs").mkdirSync(SAIDA, { recursive: true });
  const b = await pw.chromium.launch({ executablePath: CHROME });
  const pc = await (await b.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light", locale: "pt-BR" })).newPage();
  await pc.goto(URL);
  await pc.waitForLoadState("networkidle").catch(() => {});
  await pc.screenshot({ path: path.join(SAIDA, "inicio.png") });
  for (const [id, nome] of [["s-recs", "recomendacoes"], ["s-agent", "agente"]]) {
    await pc.locator(`#${id}`).evaluate((e) => e.scrollIntoView({ block: "start", behavior: "instant" }));
    if (id === "s-agent") {
      await pc.fill("#q", "sell-out da Rede Cerrado na semana 42 por produto");
      await pc.click('#ask button[type="submit"]');
      await pc.locator("#s-agent").evaluate((e) => e.scrollIntoView({ block: "start", behavior: "instant" }));
    }
    await pc.waitForTimeout(300);
    await pc.screenshot({ path: path.join(SAIDA, `${nome}.png`) });
  }
  const cel = await (await b.newContext({ ...pw.devices["Pixel 7"], colorScheme: "light", locale: "pt-BR" })).newPage();
  await cel.goto(URL + "#s-recs");
  await cel.waitForLoadState("networkidle").catch(() => {});
  await cel.waitForTimeout(300);
  await cel.screenshot({ path: path.join(SAIDA, "celular.png") });
  await b.close();
})();
