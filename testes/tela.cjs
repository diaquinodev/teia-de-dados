// Teste da tela: navegadores, celulares, temas, fluxo do agente, segurança e acessibilidade.
// Os números da tela são conferidos contra os arquivos brutos do fornecedor, com uma conta
// simples feita aqui (o "oráculo"), e não contra a base calculada pela própria página.
const pw = require("playwright-core");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

const grupos = {};
const conf = (categoria, onde, cond, msg) => {
  const k = `${categoria} · ${onde}`;
  grupos[k] = grupos[k] || { categoria, ok: 0, falhas: [] };
  if (cond) grupos[k].ok++; else grupos[k].falhas.push(msg);
};
const sp = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
const br = (n) => Math.round(n).toLocaleString("pt-BR");

// Abre o arquivo publicado como está: o que o teste vê é o que o GitHub Pages serve.
const PAGINA = process.env.TEIA_HTML || path.join(RAIZ, "docs", "index.html");
// TEIA_URL roda a mesma suíte contra o site no ar.
const URL = process.env.TEIA_URL || "file:///" + PAGINA.replace(/\\/g, "/");
const TELAS = path.join(__dirname, "telas");
fs.mkdirSync(TELAS, { recursive: true });

const ALVOS = [
  { nome: "Chrome computador", tipo: "chromium", exe: CHROME, ctx: { viewport: { width: 1366, height: 800 } } },
  { nome: "Edge computador", tipo: "chromium", exe: EDGE, ctx: { viewport: { width: 1280, height: 800 } } },
  { nome: "Firefox computador", tipo: "firefox", ctx: { viewport: { width: 1280, height: 800 } } },
  { nome: "Safari (WebKit) computador", tipo: "webkit", ctx: { viewport: { width: 1440, height: 900 } } },
  { nome: "iPhone 13 (Safari)", tipo: "webkit", ctx: { ...pw.devices["iPhone 13"] } },
  { nome: "iPhone SE (Safari)", tipo: "webkit", ctx: { ...pw.devices["iPhone SE"] } },
  { nome: "iPad (Safari)", tipo: "webkit", ctx: { ...pw.devices["iPad (gen 7)"] } },
  { nome: "Android Pixel 7 (Chrome)", tipo: "chromium", exe: CHROME, ctx: { ...pw.devices["Pixel 7"] } },
  { nome: "Android Galaxy S9+ (Chrome)", tipo: "chromium", exe: CHROME, ctx: { ...pw.devices["Galaxy S9+"] } },
  { nome: "Firefox celular 360 px", tipo: "firefox", ctx: { viewport: { width: 360, height: 740 } } },
];

async function abrir(browser, alvo, tema) {
  const ctx = await browser.newContext({ ...alvo.ctx, colorScheme: tema, locale: "pt-BR" });
  const p = await ctx.newPage();
  const erros = [], externos = [];
  p.on("pageerror", (e) => erros.push(e.message));
  p.on("console", (m) => m.type() === "error" && erros.push(m.text()));
  p.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith("file:") && !u.startsWith("data:") && !(process.env.TEIA_URL && u.startsWith(process.env.TEIA_URL)) && !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u)) externos.push(u);
  });
  await p.goto(URL);
  await p.waitForLoadState("networkidle").catch(() => {});
  await p.waitForTimeout(500);
  return { ctx, p, erros, externos };
}

// Oráculo: a partir dos arquivos como chegaram, a conta mais simples possível.
function oraculo(T) {
  const validos = T.arquivos.sellOut.filter((f) => f.linhas.reduce((n, l) => n + l.unidades, 0) === f.totalDeclarado);
  const ultimo = new Map();
  for (const f of validos) {
    const k = `${f.rede}|${f.semana}`;
    if (!ultimo.has(k) || ultimo.get(k).recebidoEm < f.recebidoEm) ultimo.set(k, f);
  }
  const eans = new Set(T.catalogo.produtos.map((p) => p.ean));
  const sellOut = new Map();
  for (const f of ultimo.values()) for (const l of f.linhas) {
    const ean = f.rede === "aurora" ? T.depara[l.produto] : l.produto;
    if (ean && eans.has(ean)) sellOut.set(`${f.rede}|${ean}|${f.semana}`, l.unidades);
  }
  const sellIn = new Map();
  for (const f of T.arquivos.sellIn) for (const l of f.linhas) sellIn.set(`${l.rede}|${l.ean}|${f.semana}`, l.unidades);
  // Estoque na semana w: inicial + soma do sell-in − soma do sell-out até w, se nada faltou.
  const estoque = (rede, ean, w) => {
    let e = T.estoqueInicial[`${rede}|${ean}`];
    for (const s of T.catalogo.semanas.filter((x) => x <= w)) {
      const k = `${rede}|${ean}|${s}`;
      if (!sellOut.has(k) || !sellIn.has(k)) return null;
      e += sellIn.get(k) - sellOut.get(k);
    }
    return e;
  };
  const primeiro = (rede, semana) => T.arquivos.sellOut.filter((f) => f.rede === rede && f.semana === semana).sort((a, b) => a.recebidoEm - b.recebidoEm)[0];
  const preco = (rede, ean, w) => {
    const f = ultimo.get(`${rede}|${w}`);
    const cod = rede === "aurora" ? Object.keys(T.depara).find((c) => T.depara[c] === ean) : ean;
    return f ? f.linhas.find((x) => x.produto === cod)?.preco ?? null : null;
  };
  return { sellOut, sellIn, estoque, preco, total: [...sellOut.values()].reduce((n, v) => n + v, 0), primeiro };
}
const dec1 = (n) => n.toFixed(1).replace(".", ",");
const pct = (n) => `${n > 0 ? "+" : ""}${Math.round(n * 100)}%`;
const brl = (n) => sp(n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

const pede = async (p, texto, toque) => {
  await p.fill("#q", texto);
  if (toque) await p.locator("#ask button[type=submit]").tap(); else await p.press("#q", "Enter");
  await p.waitForTimeout(150);
  return ultimaResposta(p);
};
const ultimaResposta = (p) => p.$$eval(".msg.bot", (els) => {
  const e = els.at(-1);
  return { linhas: [...e.querySelectorAll("tbody tr")].map((tr) => [...tr.cells].map((c) => c.textContent.replace(/\s+/g, " ").trim())), texto: e.innerText.replace(/\s+/g, " ") };
});

async function testarTela(alvo, tema, browser) {
  const onde = `${alvo.nome} · ${tema === "dark" ? "escuro" : "claro"}`;
  const { ctx, p, erros, externos } = await abrir(browser, alvo, tema);
  const celular = !!alvo.ctx.isMobile || alvo.ctx.viewport.width < 500;
  const toque = !!alvo.ctx.hasTouch;

  const lay = await p.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const fora = [...document.querySelectorAll("body *")].filter((e) => {
      if (e.closest(".files-wrap, .result-wrap, pre, .agent-log")) return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && (r.right > vw + 1 || r.left < -1);
    }).map((e) => `${e.tagName}.${e.className}`).slice(0, 5);
    const cortados = [...document.querySelectorAll("h1,h2,h3,p,button,label,td,th,span,a")]
      .filter((e) => !e.classList.contains("sr-only") && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflow === "hidden").map((e) => e.tagName);
    return {
      sw: document.documentElement.scrollWidth, vw, fora, cortados,
      bg: getComputedStyle(document.body).backgroundColor,
      fonte: document.fonts.check('700 20px "Bricolage Grotesque"'),
      recs: document.querySelectorAll(".rec").length, checks: document.querySelectorAll(".check").length,
      celulasRotuladas: [...document.querySelectorAll(".grid-files .cell")].filter((c) => c.getAttribute("aria-label")).length,
      alvosPequenos: [...document.querySelectorAll(".chips button, .atalhos a, #ask button, #q")].filter((e) => e.getBoundingClientRect().height < 44).length,
    };
  });
  conf("Tela", onde, lay.sw <= lay.vw, `rolagem lateral: página ${lay.sw}px em tela ${lay.vw}px`);
  conf("Tela", onde, lay.fora.length === 0, `elementos saindo da tela: ${lay.fora.join(", ")}`);
  conf("Tela", onde, lay.cortados.length === 0, `textos cortados: ${lay.cortados.join(", ")}`);
  conf("Tela", onde, lay.checks === 5 && lay.recs >= 1, `seções incompletas: ${lay.checks} conferências, ${lay.recs} recomendações`);
  conf("Tela", onde, tema === "dark" ? lay.bg !== "rgb(242, 245, 243)" : lay.bg === "rgb(242, 245, 243)", `fundo não segue o tema: ${lay.bg}`);
  conf("Tela", onde, lay.fonte, "fonte do título não carregou");
  conf("Tela", onde, lay.celulasRotuladas === 24, `quadrados de arquivo sem descrição: ${24 - lay.celulasRotuladas}`);
  if (celular) conf("Tela", onde, lay.alvosPequenos === 0, `${lay.alvosPequenos} botões menores que 44 px para o dedo`);

  // Atalho do topo leva ao agente.
  const atalho = p.locator(".atalhos a[href='#s-agent']");
  if (toque) await atalho.tap(); else await atalho.click();
  await p.waitForTimeout(700);
  conf("Fluxo", onde, await p.evaluate(() => { const r = document.getElementById("s-agent").getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }), "atalho 'Testar o agente' não levou à seção");

  // Pedido de exemplo pelo toque ou clique.
  const chip = p.locator("#chips button", { hasText: "suco de uva" });
  if (toque) await chip.tap(); else await chip.click();
  await p.waitForTimeout(150);
  conf("Fluxo", onde, (await ultimaResposta(p)).linhas.length === 12, "exemplo de comparação não devolveu 12 linhas");

  // "Vendas" pede esclarecimento; o botão de opção responde.
  const vendas = p.locator("#chips button", { hasText: "Vendas da Rede Boa Praça" });
  if (toque) await vendas.tap(); else await vendas.click();
  await p.waitForTimeout(150);
  const opc = p.locator(".msg.bot >> nth=-1").locator(".opcoes button", { hasText: "(sell-out)" });
  conf("Fluxo", onde, (await opc.count()) === 1, "esclarecimento de 'vendas' não apareceu");
  if (await opc.count()) {
    if (toque) await opc.tap(); else await opc.click();
    await p.waitForTimeout(150);
    const r = await ultimaResposta(p);
    conf("Fluxo", onde, r.linhas.length === 6 && /Consistência conferida/.test(r.texto), "opção sell-out não trouxe 6 produtos conferidos");
  }

  // Teclado: digitar e Enter.
  await p.focus("#q");
  await p.keyboard.type("estoque da Rede Boa Praça por produto");
  await p.keyboard.press("Enter");
  await p.waitForTimeout(150);
  conf("Fluxo", onde, (await ultimaResposta(p)).linhas.length === 6, "pedido pelo teclado não devolveu 6 linhas");

  // Nome desconhecido.
  const desc = await pede(p, "sell-out do Atacadão", toque);
  conf("Fluxo", onde, desc.linhas.length === 0 && desc.texto.includes('Não reconheço "atacadao"'), "nome desconhecido não foi recusado");

  // Quadrado de arquivo: toque, clique ou foco mostram o detalhe por escrito.
  const falta = p.locator(".grid-files .cell.miss").first();
  if (toque) await falta.tap(); else await falta.click();
  conf("Fluxo", onde, sp(await p.textContent("#detalhe-arquivo")).includes("não chegou"), "toque no quadrado não mostrou o detalhe");
  await p.locator(".grid-files .cell.dup").first().focus();
  conf("Fluxo", onde, sp(await p.textContent("#detalhe-arquivo")).includes("reenviado"), "foco no quadrado não mostrou o detalhe");

  // Campos de horas: o que aparece no campo é o que entra na conta, nos cinco campos.
  const CAMPOS = ["t-arq", "t-narq", "t-rep", "t-ped", "t-mped"];
  const contaEsperada = async () => {
    const [arq, narq, rep, ped, mped] = await Promise.all(CAMPOS.map(async (id) => Number(await p.inputValue(`#${id}`))));
    return `${((arq * narq / 60 + rep + ped * mped / 60) * 4.3).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} h`;
  };
  for (const id of CAMPOS) {
    for (const [digitado, mostrado] of [["0", "0"], ["999", "999"], ["1000", "999"], ["-5", "0"], ["2.5", "2.5"]]) {
      await p.fill(`#${id}`, digitado);
      await p.locator(`#${id}`).dispatchEvent("change");
      const visto = await p.inputValue(`#${id}`);
      const total = sp(await p.textContent("#t-total"));
      conf("Fluxo", onde, visto === mostrado && total === await contaEsperada(), `campo ${id} com "${digitado}": mostrou "${visto}", total ${total}`);
    }
    await p.fill(`#${id}`, { "t-arq": "15", "t-narq": "4", "t-rep": "3", "t-ped": "12", "t-mped": "20" }[id]);
    await p.locator(`#${id}`).dispatchEvent("change");
  }
  conf("Fluxo", onde, sp(await p.textContent("#t-total")) === "34 h", `tempo com os valores iniciais: ${await p.textContent("#t-total")}`);

  conf("Tela", onde, await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "rolagem lateral depois de usar o agente");
  // A página só pode buscar as fontes do Google Fonts (dito no texto dela); qualquer outro
  // endereço de fora é falha.
  const pub = await p.evaluate(() => ({ modo: document.compatMode, cs: document.characterSet, vp: !!document.querySelector('meta[name="viewport"]') }));
  conf("Publicação", onde, pub.modo === "CSS1Compat" && pub.cs === "UTF-8" && pub.vp, `página não se sustenta sozinha: ${JSON.stringify(pub)}`);
  conf("Segurança", onde, externos.length === 0, `requisições para fora além das fontes: ${externos.join(", ")}`);
  conf("Tela", onde, erros.length === 0, `erros no console: ${erros.join(" | ")}`);
  await p.evaluate(() => window.scrollTo(0, 0));
  // scale "css": em celular com densidade 3 ou 4, a captura inteira passava do limite de imagem
  // do Chrome e repetia pedaços da página (a página em si estava certa).
  await p.screenshot({ path: path.join(TELAS, `${onde.replace(/[^\w]+/g, "-")}.png`), fullPage: true, scale: "css" });
  await ctx.close();
}

// Números da tela contra o oráculo dos arquivos brutos.
async function testarNumeros(alvo, browser) {
  const onde = alvo.nome;
  const { ctx, p } = await abrir(browser, alvo, "light");
  const T = await p.evaluate(() => window.__teia);
  const O = oraculo(T);
  const nomeProduto = Object.fromEntries(T.catalogo.produtos.map((x) => [x.nome, x.ean]));
  const ean = (nome) => nomeProduto[nome];

  const checks = sp(await p.$eval("#checks", (e) => e.innerText));
  conf("Números", onde, T.controle.totalBase === O.total && checks.includes(br(O.total)), `total: página ${T.controle.totalBase}, arquivos ${O.total}`);
  conf("Números", onde, checks.includes("AUR-0007") && checks.includes("2 linhas") && checks.includes(br(64 + 71)), "de-para sem cadastro na tela");
  conf("Números", onde, checks.includes("Rede Boa Praça") && checks.includes("1 linha corrigida"), "reenvio corrigido na tela");
  conf("Números", onde, checks.includes("Rede Cerrado") && checks.includes("sem dado"), "semana faltando na tela");

  // Reenvio: a tela mostra o valor corrigido, não o do primeiro arquivo.
  let a = await pede(p, "sell-out da Rede Boa Praça semana 42 por produto");
  const limao = a.linhas.find((l) => l[0].startsWith("Chá gelado limão"));
  const certo = O.sellOut.get(`boapraca|${ean("Chá gelado limão 1,5 L")}|42`);
  const errado = O.primeiro("boapraca", 42).linhas.find((l) => l.produto === ean("Chá gelado limão 1,5 L")).unidades;
  conf("Números", onde, limao && limao[1] === br(certo) && certo !== errado, `reenvio: tela ${limao && limao[1]}, corrigido ${certo}, primeiro arquivo ${errado}`);

  a = await pede(p, "Sell-out da Rede Aurora na semana 43, por produto");
  conf("Números", onde, a.linhas.length === 6 && a.linhas.every((l) => l[1] === br(O.sellOut.get(`aurora|${ean(l[0])}|43`))), `Aurora S43: ${JSON.stringify(a.linhas)}`);
  conf("Números", onde, a.texto.includes(br(a.linhas.reduce((n, l) => n + Number(l[1].replace(/\./g, "")), 0))), "total da Aurora S43 na frase de conferência");

  a = await pede(p, "Sell-out da Rede Cerrado na semana 43");
  conf("Números", onde, a.linhas.length === 6 && a.linhas.every((l) => l.at(-1) === "sem dado") && !/\b0\b/.test(a.linhas.flat().join(" ")), "semana que não chegou como sem dado");
  a = await pede(p, "Sell-in da Rede Cerrado na semana 43");
  conf("Números", onde, a.linhas.length === 6 && a.linhas.every((l) => /^\d/.test(l.at(-1))), "sell-in da semana 43 existe");

  a = await pede(p, "Compare sell-in e sell-out do suco de uva nas últimas 4 semanas");
  const semanas = a.linhas.map((l) => l[0]);
  conf("Números", onde, JSON.stringify(semanas) === JSON.stringify([...semanas].sort()), `tabela fora da ordem do ORDER BY: ${semanas}`);

  a = await pede(p, "preço nas redes semana 43");
  conf("Números", onde, a.linhas.length === 18 && /refeito/.test(a.texto), `preço por produto conferido (${a.linhas.length} linhas)`);
  const precoCoco = a.linhas.find((l) => l[0] === "Rede Aurora" && l[1] === "Água de coco 1 L");
  conf("Números", onde, precoCoco && precoCoco[2] === brl(O.preco("aurora", ean("Água de coco 1 L"), 43)), `preço da água de coco na Aurora: ${precoCoco}`);

  // Intervalo de semanas: as três semanas pedidas, nem mais nem menos.
  a = await pede(p, "sell-out da Rede Aurora semanas 40 a 42 por produto");
  const semanasVistas = [...new Set(a.linhas.map((l) => l[0]))];
  conf("Números", onde, JSON.stringify(semanasVistas) === JSON.stringify(["S40", "S41", "S42"]) && a.linhas.length === 18 && a.texto.includes("BETWEEN 40 AND 42"), `intervalo 40 a 42 trouxe ${semanasVistas}`);
  // Semanas salteadas: o resumo e o SQL mostram exatamente as semanas pedidas.
  a = await pede(p, "sell-out da Rede Aurora semanas 40, 42 e 43 por produto");
  const salteadas = [...new Set(a.linhas.map((l) => l[0]))];
  conf("Números", onde, JSON.stringify(salteadas) === JSON.stringify(["S40", "S42", "S43"]) && a.texto.includes("semana IN (40, 42, 43)") && a.texto.includes("semanas: 40, 42, 43") && !a.texto.includes("BETWEEN"), `semanas salteadas: ${salteadas}, texto ${a.texto.slice(0, 200)}`);

  // Recomendações conferidas contra os arquivos brutos, com a regra escrita no README.
  const cartoes = await p.$$eval(".rec", (els) => els.map((e) => ({ titulo: e.querySelector("h3").textContent, texto: e.innerText.replace(/\s+/g, " ") })));
  const cartao = (rede, produto) => cartoes.find((c) => c.titulo === `${rede} · ${produto}`);
  {
    const u = ean("Suco de uva 1 L");
    const cob = O.estoque("boapraca", u, 43) / ((O.sellOut.get(`boapraca|${u}|43`) + O.sellOut.get(`boapraca|${u}|42`)) / 2);
    const c = cartao("Rede Boa Praça", "Suco de uva 1 L");
    conf("Números", onde, cob < 1 && c && c.texto.includes("Risco de ruptura") && c.texto.includes(`cobre ${dec1(cob)} semana`), `ruptura da uva: cobertura ${cob}, cartão ${c && c.texto}`);
  }
  {
    const s = ean("Chá gelado pêssego 450 ml");
    const cob = O.estoque("aurora", s, 43) / ((O.sellOut.get(`aurora|${s}|43`) + O.sellOut.get(`aurora|${s}|42`)) / 2);
    const tend = O.sellOut.get(`aurora|${s}|43`) / O.sellOut.get(`aurora|${s}|39`) - 1;
    const c = cartao("Rede Aurora", "Chá gelado pêssego 450 ml");
    conf("Números", onde, cob > 3 && tend < -0.1 && c && c.texto.includes("Estoque parado") && c.texto.includes(pct(tend)) && c.texto.includes(dec1(cob)), `estoque parado do pêssego: cobertura ${cob}, tendência ${tend}, cartão ${c && c.texto}`);
  }
  {
    const k = ean("Água de coco 1 L");
    const pa = O.preco("aurora", k, 43), pb = O.preco("boapraca", k, 43);
    const c = cartao("Rede Aurora", "Água de coco 1 L");
    conf("Números", onde, O.preco("cerrado", k, 43) === null && pa / pb - 1 > 0.1 && c && c.texto.includes(brl(pa)) && c.texto.includes(brl(pb)) && c.texto.includes(pct(pa / pb - 1)), `preço do coco: Aurora ${pa}, Boa Praça ${pb}, cartão ${c && c.texto}`);
  }
  conf("Números", onde, cartoes.length === 3, `a demonstração deveria ter 3 recomendações: ${cartoes.map((c) => c.titulo)}`);

  // Semana antiga: a situação daquela semana, calculada com os dados até ela.
  a = await pede(p, "ruptura na semana 42");
  conf("Números", onde, a.texto.includes("semana: 42") && a.linhas.every((l) => l[3] !== "S43"), `ruptura na semana 42 usou dado da 43: ${JSON.stringify(a.linhas)}`);
  a = await pede(p, "ruptura nas semanas 40 a 42");
  conf("Números", onde, a.linhas.length === 0 && /Diga qual semana/.test(a.texto), "recomendação com várias semanas não pediu uma só");
  const acao = sp(await p.$eval("#recs", (e) => e.innerText));
  conf("Números", onde, !/lojas com mais estoque/.test(acao), "recomendação ainda fala de lojas sem dado de loja");

  // Segurança: texto digitado nunca vira código.
  await p.evaluate(() => { window.__xss = 0; });
  for (const q of ['<img src=x onerror="window.__xss=1">', 'vendas <img src=x onerror="window.__xss=2">', "'\"><svg onload=window.__xss=3>"]) {
    await pede(p, q);
    const opc = p.locator(".msg.bot >> nth=-1").locator(".opcoes button").first();
    if (await opc.count()) { await opc.click(); await p.waitForTimeout(100); }
  }
  await p.waitForTimeout(200);
  const xss = await p.evaluate(() => ({ v: window.__xss, el: document.querySelectorAll(".agent img, .agent svg[onload]").length }));
  conf("Segurança", onde, xss.v === 0 && xss.el === 0, `texto virou código: ${JSON.stringify(xss)}`);
  conf("Segurança", onde, (await p.$eval("#q", (e) => e.maxLength)) === 200, "campo do agente sem limite de 200");
  for (const q of ["Me manda os preços da concorrência", "qual a margem da Rede Aurora"]) {
    a = await pede(p, q);
    conf("Segurança", onde, a.linhas.length === 0 && /Nesta demonstração, nada foi enviado/.test(a.texto), `pedido fora do padrão: ${q}`);
  }
  const promessas = sp(await p.evaluate(() => document.body.innerText));
  conf("Honestidade", onde, !/Encaminhei|aviso quando houver|recebe um aviso\.|o cadastro recebe/.test(promessas), "a página ainda afirma uma ação que não acontece");
  await ctx.close();
}

async function testarAcessibilidade(browser) {
  for (const tema of ["light", "dark"]) {
    const onde = `axe, tema ${tema === "dark" ? "escuro" : "claro"}`;
    const { ctx, p } = await abrir(browser, ALVOS[0], tema);
    await pede(p, "Vendas da Rede Boa Praça");
    await p.addScriptTag({ content: AXE });
    const r = await p.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.map((v) => ({ id: v.id, impacto: v.impact, n: v.nodes.length, ex: v.nodes[0]?.target?.join(" ") })));
    conf("Acessibilidade", onde, r.filter((v) => v.impacto === "serious" || v.impacto === "critical").length === 0, `graves: ${JSON.stringify(r)}`);
    conf("Acessibilidade", onde, r.length === 0, `avisos menores: ${JSON.stringify(r)}`);
    await ctx.close();
  }
}

(async () => {
  const abertos = {};
  const lancar = async (alvo) => {
    const k = alvo.tipo + (alvo.exe || "");
    if (!abertos[k]) abertos[k] = await pw[alvo.tipo].launch(alvo.exe ? { executablePath: alvo.exe } : {});
    return abertos[k];
  };
  for (const alvo of ALVOS) for (const tema of ["light", "dark"]) {
    try { await testarTela(alvo, tema, await lancar(alvo)); } catch (e) { conf("Tela", `${alvo.nome} · ${tema}`, false, `teste quebrou: ${e.message.split("\n")[0]}`); }
  }
  for (const alvo of [ALVOS[0], ALVOS[2], ALVOS[3], ALVOS[4]]) {
    try { await testarNumeros(alvo, await lancar(alvo)); } catch (e) { conf("Números", alvo.nome, false, `teste quebrou: ${e.message.split("\n")[0]}`); }
  }
  await testarAcessibilidade(await lancar(ALVOS[0]));
  for (const b of Object.values(abertos)) await b.close();

  const porCategoria = {};
  for (const [k, g] of Object.entries(grupos)) {
    const c = (porCategoria[g.categoria] = porCategoria[g.categoria] || { ok: 0, falhas: 0, onde: new Set() });
    c.ok += g.ok; c.falhas += g.falhas.length; c.onde.add(k.split(" · ").slice(1).join(" · "));
    if (g.falhas.length) { console.log(`FALHOU ${k}`); g.falhas.forEach((f) => console.log("   -", f)); }
  }
  console.log("\nResumo por categoria:");
  for (const [c, v] of Object.entries(porCategoria)) console.log(`  ${c.padEnd(15)} ${v.ok} certas, ${v.falhas} falhas, em ${v.onde.size} combinações`);
  const falhas = Object.values(porCategoria).reduce((n, v) => n + v.falhas, 0);
  process.exit(falhas ? 1 : 0);
})();
