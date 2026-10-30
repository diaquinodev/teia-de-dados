// Prova de que os testes de regra pegam erro: planta um erro por vez numa cópia da página e
// exige que os testes falhem. Mutante que sobrevive = regra sem teste.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { PAGINA } = require("./carregar-logica.cjs");

const MUTANTES = [
  // Limites das regras
  ["ruptura com cobertura exatamente 1", "if (bp(cobertura) < 10000)", "if (bp(cobertura) <= 10000)"],
  ["estoque parado com cobertura exatamente 3", "else if (bp(cobertura) > 30000", "else if (bp(cobertura) >= 30000"],
  ["queda de exatamente 10% conta como parado", "bp(tendencia) < -1000", "bp(tendencia) <= -1000"],
  ["preço exatamente 10% acima entra", "if (bp(acima) > 1000)", "if (bp(acima) >= 1000)"],
  ["preço comparado sem pontos-base (erro de arredondamento)", "if (bp(acima) > 1000)", "if (acima > 0.1)"],
  ["tendência contra 3 semanas antes", "x.semana === ult.semana - 4", "x.semana === ult.semana - 3"],
  ["cobertura só com a última semana", "const media2 = (ult.sellOut + pen.sellOut) / 2;", "const media2 = ult.sellOut;"],
  // Carga
  ["semana que não chegou vira zero", "const sellOutW = c ? c.sellOut : null;", "const sellOutW = c ? c.sellOut : 0;"],
  ["reenvio pela ordem da lista, não pela hora", "[...lista].sort((a, b) => a.recebidoEm - b.recebidoEm)", "[...lista]"],
  ["arquivo com soma diferente aceito", 'if (f.linhas.reduce((n, l) => n + l.unidades, 0) !== f.totalDeclarado) return "soma diferente do total declarado";', ""],
  ["unidade negativa ou fracionada aceita", 'if (f.linhas.some((l) => !unidadeValida(l.unidades))) return "unidades inválidas";', ""],
  ["preço zero ou negativo aceito", ' || !(Number.isFinite(l.preco) && l.preco > 0)', ""],
  ["semana fora do período aceita", 'if (!ehSemana.has(f.semana)) return "semana fora do período";', ""],
  ["produto repetido no sell-out aceito", 'if (repetido(f.linhas.map((l) => eanSO(f, l.produto) ?? `sem-cadastro:${l.produto}`))) return "produto repetido no arquivo";', ""],
  ["produto repetido no sell-in aceito", 'if (repetido(f.linhas.map((l) => `${l.rede}|${l.ean}`))) return "produto repetido no arquivo";', ""],
  ["empate de horário ignorado", "for (const k of empates) m.delete(k);", ""],
  ["controle não desconta o que ficou sem cadastro", 'const totalControle = totalDeclarado - foraDaBase("sellOut");', "const totalControle = totalDeclarado;"],
  ["estoque volta a ser calculado depois de uma lacuna", "estoque = estoque === null || sellIn === null", "estoque = sellIn === null"],
  ["carga com lacunas marcada como aprovada", 'lacunas ? "parcial" : "aprovada"', '"aprovada"'],
  ["sell-out sem um produto aceito", "const faltam = ausentes(new Set(f.linhas.map((l) => eanSO(f, l.produto))), produtos.map((p) => p.ean));", "const faltam = [];"],
  ["sell-in sem uma combinação aceito", "const faltam = ausentes(new Set(f.linhas.map((l) => `${l.rede}|${l.ean}`)), redes.flatMap(", "const faltam = [] || ausentes(new Set(f.linhas.map((l) => `${l.rede}|${l.ean}`)), redes.flatMap("],
  // Recomendação
  ["recomendação olha semanas depois da pedida", "const ate = base.filter((x) => x.semana <= semanaAtual);", "const ate = base;"],
  ["preço compara semanas diferentes", "x.ean === p.ean && x.semana === semanaAtual)?.preco", "x.ean === p.ean && x.preco !== null)?.preco"],
  ["preço sem comparação some em vez de ser listado", '{ naoAvaliados.push({ rede: null, ean: p.ean, motivo: "preço: menos de 2 redes com preço na semana" }); continue; }', "continue;"],
  ["estoque desconhecido some em vez de ser listado", 'naoAvaliados.push({ rede: r.id, ean: p.ean, motivo: "estoque desconhecido" });', ""],
  // Agente
  ["palavra desconhecida aceita", "if (desconhecidas.length) return", "if (false) return"],
  ["'vendas' vira sell-out sem perguntar", String.raw`if (/\bsell[- ]?out\b|\bsellout\b|\bconsumidor\b/.test(q))`, String.raw`if (/\bsell[- ]?out\b|\bsellout\b|\bconsumidor\b|\bvend/.test(q))`],
  ["intervalo de semanas vira lista", "const intervalo = ", "const intervalo = false && "],
  ["recomendação ignora a semana pedida", "semana: semanasPedidas ? semanasPedidas[0] : catalogo.semanas.at(-1)", "semana: catalogo.semanas.at(-1)"],
  ["preço não forçado por produto", `|| metricas.includes("preco") ||`, "||"],
  ["pedido fora do padrão respondido", `if (FORA.test(q)) return { tipo: "fora" };`, ""],
  // Consulta
  ["grupo sem dado somado como zero", "if (linhas.some((r) => r[m] === null)) return null;", ""],
  ["tabela fora da ordem do ORDER BY", ".sort((x, y) => (x.chave[0] ?? 0) - (y.chave[0] ?? 0))", ""],
];

const original = fs.readFileSync(PAGINA, "utf8");
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "teia-mutantes-"));
let sobreviventes = 0, invalidos = 0;
for (const [nome, de, para] of MUTANTES) {
  const n = original.split(de).length - 1;
  if (n !== 1) { invalidos++; console.log(`INVÁLIDO   ${nome}: trecho aparece ${n} vezes`); continue; }
  const arquivo = path.join(pasta, "mutante.html");
  fs.writeFileSync(arquivo, original.replace(de, para));
  const r = spawnSync(process.execPath, ["--test", path.join(__dirname, "regras.test.cjs")], { env: { ...process.env, TEIA_HTML: arquivo }, encoding: "utf8" });
  // Sem conseguir abrir o processo (ex.: sandbox), o resultado não prova nada: para aqui.
  if (r.error || r.stdout === undefined) { console.log(`NÃO RODOU  ${nome}: ${r.error?.message ?? "sem saída"}`); process.exit(2); }
  const falhas = (r.stdout.match(/^# fail (\d+)|^ℹ fail (\d+)/m) || []).slice(1).find(Boolean);
  if (r.status === 0) { sobreviventes++; console.log(`SOBREVIVEU ${nome}`); }
  else console.log(`pego       ${nome} (${falhas ?? "?"} teste(s) falharam)`);
}
fs.rmSync(pasta, { recursive: true, force: true });
console.log(`\n${MUTANTES.length - sobreviventes - invalidos} de ${MUTANTES.length} erros plantados foram pegos; ${sobreviventes} sobreviveram; ${invalidos} inválidos.`);
process.exit(sobreviventes || invalidos ? 1 : 0);
