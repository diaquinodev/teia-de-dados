// Tira da página o bloco de regras (entre <teia-logica> e </teia-logica>) e roda fora do
// navegador: as regras não dependem da tela.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// TEIA_HTML permite rodar os mesmos testes contra uma cópia com erro plantado (mutantes.cjs).
const PAGINA = process.env.TEIA_HTML || path.join(__dirname, "..", "pagina", "teia-de-dados.html");

function extrair(html) {
  const ini = html.indexOf("// <teia-logica>");
  const fim = html.indexOf("// </teia-logica>");
  if (ini < 0 || fim < ini) throw new Error("bloco <teia-logica> não encontrado na página");
  return html.slice(ini, fim);
}

function carregarLogica(html = fs.readFileSync(PAGINA, "utf8")) {
  // Mesmo contexto do Node (listas comparáveis nos testes), dentro de uma função: nada vaza.
  return vm.runInThisContext(`(function () { ${extrair(html)}; return Teia; })`, { filename: "teia-logica.js" })();
}

module.exports = { carregarLogica, extrair, PAGINA };
