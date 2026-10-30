// Regras de negócio com casos pequenos escritos à mão. Os valores esperados foram calculados
// no papel a partir da regra escrita, não copiados do código da página.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { carregarLogica } = require("./carregar-logica.cjs");

const Teia = carregarLogica();

// ---------- Carga ----------
const CAT = {
  redes: [
    { id: "a", nome: "Rede A", termos: ["alfa"], codigoProprio: false },
    { id: "b", nome: "Rede B", termos: ["beta"], codigoProprio: true },
  ],
  produtos: [
    { ean: "111", nome: "Limão", termos: ["limao"] },
    { ean: "222", nome: "Uva", termos: ["uva"] },
  ],
  semanas: [1, 2],
};
const DEPARA = { "B-1": "111", "B-2": "222" };
const ESTOQUE = { "a|111": 100, "a|222": 50, "b|111": 30, "b|222": 40 };
const so = (rede, semana, linhas, recebidoEm, totalDeclarado) => ({
  id: `so-${rede}-${semana}-${recebidoEm}`, rede, semana, recebidoEm, linhas,
  totalDeclarado: totalDeclarado ?? linhas.reduce((n, l) => n + l.unidades, 0),
});
const si = (semana, linhas, recebidoEm, totalDeclarado) => ({
  id: `si-${semana}-${recebidoEm}`, semana, recebidoEm, linhas,
  totalDeclarado: totalDeclarado ?? linhas.reduce((n, l) => n + l.unidades, 0),
});
const l = (produto, unidades, preco = 1) => ({ produto, unidades, preco });
const e = (rede, ean, unidades) => ({ rede, ean, unidades });
const SELL_IN = () => [
  si(1, [e("a", "111", 5), e("a", "222", 10), e("b", "111", 3), e("b", "222", 4)], 1),
  si(2, [e("a", "111", 6), e("a", "222", 9), e("b", "111", 2), e("b", "222", 4)], 2),
];
const SO_BASICO = () => [
  so("a", 1, [l("111", 10, 5), l("222", 20, 3)], 10),
  so("a", 2, [l("111", 12, 5.5), l("222", 18, 3.2)], 11),
  so("b", 1, [l("B-1", 7, 5.2), l("B-2", 8, 3.1)], 12),
  so("b", 2, [l("B-1", 6, 5.3), l("B-2", 5, 3.3)], 13),
];
const carregar = (sellOut, extra = {}) => Teia.carregar({ catalogo: CAT, sellOut, sellIn: SELL_IN(), depara: DEPARA, estoqueInicial: ESTOQUE, ...extra });
const linha = (base, rede, ean, semana) => base.find((r) => r.rede === rede && r.ean === ean && r.semana === semana);
const motivos = (controle) => controle.rejeitados.map((x) => x.motivo);

describe("carga dos arquivos", () => {
  test("caso básico: base, estoque e totais de sell-out e sell-in conferidos pelo cabeçalho", () => {
    const { base, controle } = carregar(SO_BASICO());
    assert.equal(base.length, 8);
    // estoque = anterior + sell-in − sell-out: 100+5−10 = 95; 95+6−12 = 89
    assert.deepEqual([linha(base, "a", "111", 1).estoque, linha(base, "a", "111", 2).estoque], [95, 89]);
    assert.deepEqual([linha(base, "a", "222", 1).estoque, linha(base, "a", "222", 2).estoque], [40, 31]);
    assert.deepEqual([linha(base, "b", "111", 1).estoque, linha(base, "b", "111", 2).estoque], [26, 22]);
    assert.deepEqual([linha(base, "b", "222", 1).estoque, linha(base, "b", "222", 2).estoque], [36, 35]);
    assert.equal(linha(base, "b", "111", 2).preco, 5.3);
    assert.equal(controle.totalBase, 86); // 10+20+12+18+7+8+6+5
    assert.equal(controle.totalControle, 86);
    assert.equal(controle.totalBaseSellIn, 43); // 5+10+3+4+6+9+2+4
    assert.equal(controle.totalControleSellIn, 43);
    assert.equal(controle.bate, true);
    assert.equal(controle.status, "aprovada");
    assert.deepEqual(controle.faltando, []);
  });

  test("semana que não chegou fica sem dado, nunca zero; o sell-in dela continua", () => {
    const { base, controle } = carregar(SO_BASICO().filter((f) => !(f.rede === "a" && f.semana === 2)));
    const r = linha(base, "a", "111", 2);
    assert.deepEqual([r.sellOut, r.preco, r.estoque, r.sellIn], [null, null, null, 6]);
    assert.deepEqual(controle.faltando, [{ rede: "a", semana: 2 }]);
    assert.equal(controle.totalBase, 56); // 86 − 30
    assert.equal(controle.status, "parcial");
  });

  test("depois de uma semana sem dado, o estoque não volta a ser calculado", () => {
    // Sell-in alto na semana 3: uma conta errada que ignorasse a lacuna daria estoque positivo.
    const { base, controle } = Teia.carregar({
      catalogo: { ...CAT, semanas: [1, 2, 3] }, depara: DEPARA, estoqueInicial: ESTOQUE,
      sellIn: [...SELL_IN(), si(3, [e("a", "111", 40), e("a", "222", 1), e("b", "111", 1), e("b", "222", 1)], 3)],
      sellOut: [so("a", 1, [l("111", 10), l("222", 20)], 10), so("a", 3, [l("111", 11), l("222", 1)], 12)],
    });
    assert.deepEqual(controle.rejeitados, []); // os arquivos usados no caso estão completos
    assert.deepEqual([1, 2, 3].map((w) => linha(base, "a", "111", w).estoque), [95, null, null]);
    assert.equal(linha(base, "a", "111", 3).sellOut, 11);
  });

  test("reenvio corrigido: vale o mais recente pela hora de chegada, não pela ordem da lista", () => {
    const { base, controle } = carregar([so("a", 2, [l("111", 15, 5.5), l("222", 18, 3.2)], 99), ...SO_BASICO()]);
    assert.equal(linha(base, "a", "111", 2).sellOut, 15);
    assert.equal(linha(base, "a", "111", 2).estoque, 95 + 6 - 15);
    assert.deepEqual(controle.substituidos, [{ rede: "a", semana: 2, linhasAlteradas: 1 }]);
    assert.equal(controle.totalBase, 89);
    assert.equal(controle.bate, true);
  });

  test("reenvio idêntico não soma duas vezes", () => {
    const { controle } = carregar([...SO_BASICO(), so("a", 2, [l("111", 12, 5.5), l("222", 18, 3.2)], 50)]);
    assert.equal(controle.totalBase, 86);
    assert.deepEqual(controle.substituidos, [{ rede: "a", semana: 2, linhasAlteradas: 0 }]);
  });

  test("dois arquivos na mesma hora com conteúdo diferente: a semana fica sem dado", () => {
    const { base, controle } = carregar([...SO_BASICO(), so("a", 2, [l("111", 99), l("222", 18)], 11)]);
    assert.equal(linha(base, "a", "111", 2).sellOut, null);
    assert.deepEqual(controle.empates, [{ fonte: "sellOut", chave: "a|2" }]);
    assert.deepEqual(controle.faltando, [{ rede: "a", semana: 2 }]);
  });

  test("empate desfeito por um arquivo mais novo", () => {
    const { base, controle } = carregar([...SO_BASICO(), so("a", 2, [l("111", 99), l("222", 18)], 11), so("a", 2, [l("111", 13), l("222", 18)], 30)]);
    assert.equal(linha(base, "a", "111", 2).sellOut, 13);
    assert.deepEqual(controle.empates, []);
  });

  test("dois arquivos na mesma hora e iguais não são empate", () => {
    const { controle } = carregar([...SO_BASICO(), so("a", 2, [l("111", 12, 5.5), l("222", 18, 3.2)], 11)]);
    assert.deepEqual(controle.empates, []);
    assert.equal(controle.totalBase, 86);
  });

  test("código sem de-para fica fora da base, é listado e o controle desconta", () => {
    const arquivos = SO_BASICO();
    arquivos[3] = so("b", 2, [l("B-1", 6), l("B-2", 5), l("B-9", 4)], 13);
    const { base, controle } = carregar(arquivos);
    assert.equal(base.length, 8);
    assert.deepEqual(controle.semCadastro.map((x) => [x.fonte, x.produto, x.unidades]), [["sellOut", "B-9", 4]]);
    assert.deepEqual([controle.totalDeclarado, controle.totalBase, controle.totalControle], [90, 86, 86]);
    assert.equal(controle.bate, true);
    assert.equal(controle.status, "parcial");
  });

  test("rede sem código próprio não aceita código de outra rede (e o produto fica faltando)", () => {
    const arquivos = SO_BASICO();
    arquivos[0] = so("a", 1, [l("B-1", 10), l("222", 20)], 10);
    const { base, controle } = carregar(arquivos);
    assert.equal(linha(base, "a", "111", 1).sellOut, null);
    assert.deepEqual(motivos(controle), ["produto esperado ausente: 111"]);
  });

  test("sell-out sem um produto esperado é rejeitado e diz qual faltou", () => {
    const arquivos = SO_BASICO();
    arquivos[1] = so("a", 2, [l("111", 12, 5.5)], 11);
    const { base, controle } = carregar(arquivos);
    assert.deepEqual(motivos(controle), ["produto esperado ausente: 222"]);
    assert.equal(linha(base, "a", "111", 2).sellOut, null); // o arquivo inteiro sai, não só a linha
    assert.deepEqual(controle.faltando, [{ rede: "a", semana: 2 }]);
    assert.equal(controle.status, "parcial");
  });

  test("sell-in sem uma combinação de rede e produto é rejeitado e diz qual faltou", () => {
    const sellIn = SELL_IN();
    sellIn[1] = si(2, [e("a", "111", 6), e("a", "222", 9), e("b", "111", 2)], 2);
    const { base, controle } = carregar(SO_BASICO(), { sellIn });
    assert.deepEqual(motivos(controle), ["produto esperado ausente: b|222"]);
    assert.equal(linha(base, "a", "111", 2).sellIn, null);
    assert.deepEqual(controle.semanasSemSellIn, [2]);
  });

  test("código extra sem cadastro não torna o arquivo incompleto", () => {
    const arquivos = SO_BASICO();
    arquivos[3] = so("b", 2, [l("B-1", 6), l("B-2", 5), l("B-9", 4)], 13);
    assert.deepEqual(carregar(arquivos).controle.rejeitados, []);
  });

  const invalido = (nome, arquivo, motivo) => test(`arquivo rejeitado inteiro: ${nome}`, () => {
    const arquivos = SO_BASICO();
    arquivos[0] = arquivo;
    const { base, controle } = carregar(arquivos);
    assert.deepEqual(motivos(controle), [motivo]);
    assert.equal(linha(base, "a", "111", 1).sellOut, null);
    assert.equal(linha(base, "a", "222", 1).sellOut, null);
    assert.ok(controle.faltando.some((f) => f.rede === "a" && f.semana === 1));
    assert.equal(controle.bate, true);
  });
  invalido("soma diferente do total declarado", so("a", 1, [l("111", 10), l("222", 20)], 10, 31), "soma diferente do total declarado");
  // −5 e +5 fecham o total: só a validação de valor pega.
  invalido("unidade negativa que fecha o total", so("a", 1, [l("111", -5), l("222", 35)], 10, 30), "unidades inválidas");
  invalido("unidade fracionada", so("a", 1, [l("111", 10.5), l("222", 19.5)], 10, 30), "unidades inválidas");
  invalido("unidade que não é número", so("a", 1, [l("111", NaN), l("222", 20)], 10, 20), "unidades inválidas");
  invalido("preço zero", so("a", 1, [l("111", 10, 0), l("222", 20)], 10), "preço inválido");
  invalido("preço negativo", so("a", 1, [l("111", 10, -1), l("222", 20)], 10), "preço inválido");
  invalido("preço infinito", so("a", 1, [l("111", 10, Infinity), l("222", 20)], 10), "preço inválido");
  invalido("produto repetido", so("a", 1, [l("111", 10), l("111", 10), l("222", 20)], 10), "produto repetido no arquivo");
  invalido("hora de chegada inválida", so("a", 1, [l("111", 10), l("222", 20)], NaN), "hora de chegada inválida");

  test("dois códigos da rede que levam ao mesmo EAN são produto repetido", () => {
    const arquivos = SO_BASICO();
    arquivos[2] = so("b", 1, [l("B-1", 7), l("B-1X", 8)], 12);
    const { controle } = carregar(arquivos, { depara: { ...DEPARA, "B-1X": "111" } });
    assert.deepEqual(motivos(controle), ["produto repetido no arquivo"]);
  });

  test("arquivo de semana ou rede fora do cadastro é rejeitado", () => {
    const { controle } = carregar([...SO_BASICO(), so("a", 9, [l("111", 1)], 20), so("z", 1, [l("111", 1)], 21)]);
    assert.deepEqual(motivos(controle).sort(), ["rede fora do cadastro", "semana fora do período"]);
    assert.equal(controle.totalBase, 86);
  });

  test("arquivo novo inválido não substitui o antigo válido", () => {
    const { base, controle } = carregar([...SO_BASICO(), so("a", 1, [l("111", 99), l("222", 20)], 98, 10)]);
    assert.equal(linha(base, "a", "111", 1).sellOut, 10);
    assert.equal(controle.rejeitados.length, 1);
  });

  test("sell-in com produto repetido é rejeitado inteiro, como o sell-out", () => {
    const sellIn = SELL_IN();
    sellIn[1] = si(2, [e("a", "111", 6), e("a", "111", 6), e("a", "222", 9), e("b", "111", 2), e("b", "222", 4)], 2);
    const { base, controle } = carregar(SO_BASICO(), { sellIn });
    assert.deepEqual(motivos(controle), ["produto repetido no arquivo"]);
    assert.equal(linha(base, "a", "111", 2).sellIn, null);
    assert.deepEqual(controle.semanasSemSellIn, [2]);
  });

  test("sell-in com unidade negativa que fecha o total é rejeitado", () => {
    const sellIn = SELL_IN();
    sellIn[0] = si(1, [e("a", "111", -5), e("a", "222", 20), e("b", "111", 3), e("b", "222", 4)], 1);
    const { controle } = carregar(SO_BASICO(), { sellIn });
    assert.deepEqual(motivos(controle), ["unidades inválidas"]);
  });

  test("sell-in de produto fora do cadastro fica fora e o controle do sell-in desconta", () => {
    const sellIn = SELL_IN();
    sellIn[0] = si(1, [e("a", "111", 5), e("a", "222", 10), e("b", "111", 3), e("b", "222", 4), e("a", "999", 7)], 1);
    const { controle } = carregar(SO_BASICO(), { sellIn });
    assert.deepEqual([controle.totalDeclaradoSellIn, controle.totalBaseSellIn, controle.totalControleSellIn], [50, 43, 43]);
    assert.equal(controle.bate, true);
  });

  test("estoque negativo é dado inconsistente: vira sem dado", () => {
    const { base } = carregar(SO_BASICO(), { estoqueInicial: { ...ESTOQUE, "a|111": 2 } });
    assert.equal(linha(base, "a", "111", 1).estoque, null); // 2 + 5 − 10 < 0
  });

  test("estoque negativo é listado e a carga não fica aprovada", () => {
    const { controle } = carregar(SO_BASICO(), { estoqueInicial: { ...ESTOQUE, "a|111": 2 } });
    assert.deepEqual(controle.estoqueNegativo[0], { rede: "a", ean: "111", semana: 1, estoque: -3 });
    assert.equal(controle.status, "parcial");
  });

  test("sem estoque inicial, não há estoque calculado", () => {
    const { base } = carregar(SO_BASICO(), { estoqueInicial: {} });
    assert.ok(base.every((r) => r.estoque === null));
  });

  test("semana sem sell-in deixa o sell-in e o estoque sem dado, e a carga fica parcial", () => {
    const { base, controle } = carregar(SO_BASICO(), { sellIn: [SELL_IN()[0]] });
    assert.equal(linha(base, "a", "111", 2).sellIn, null);
    assert.equal(linha(base, "a", "111", 2).estoque, null);
    assert.deepEqual(controle.semanasSemSellIn, [2]);
    assert.equal(controle.status, "parcial");
  });
});

// ---------- Recomendações ----------
const CAT_R = {
  redes: [{ id: "a" }, { id: "b" }, { id: "c" }],
  produtos: [{ ean: "111" }, { ean: "222" }],
  semanas: [1, 2, 3, 4, 5, 6],
};
// Série escrita à mão: [semana, sellOut, estoque, preco]
const serie = (rede, ean, pontos) => pontos.map(([semana, sellOut, estoque = null, preco = null]) => ({ rede, ean, semana, sellIn: 0, sellOut, estoque, preco }));
const avaliar = (base, semanaAtual = 6) => Teia.recomendar(base, { catalogo: CAT_R, semanaAtual });
const rec = (base, semanaAtual) => avaliar(base, semanaAtual).recomendacoes;

describe("recomendações", () => {
  test("cobertura exatamente 1 semana não é ruptura; 0,99 é", () => {
    assert.deepEqual(rec(serie("a", "111", [[5, 100], [6, 100, 100]])), []);
    const r = rec(serie("a", "111", [[5, 100], [6, 100, 99]]));
    assert.deepEqual(r.map((x) => [x.tipo, x.cobertura]), [["ruptura", 0.99]]);
  });

  test("cobertura usa a média das 2 últimas semanas, não só a última", () => {
    // média (200 + 100) ÷ 2 = 150; 140 ÷ 150 = 0,93 → ruptura. Só com a última daria 1,4.
    const r = rec(serie("a", "111", [[5, 200], [6, 100, 140]]));
    assert.equal(r.length, 1);
    assert.equal(r[0].tipo, "ruptura");
    assert.ok(Math.abs(r[0].cobertura - 140 / 150) < 1e-9);
  });

  test("ruptura não depende de o sell-out estar crescendo", () => {
    const r = rec(serie("a", "111", [[2, 200], [3, 150], [4, 120], [5, 100], [6, 100, 50]]));
    assert.equal(r[0].tipo, "ruptura");
    assert.equal(r[0].tendencia, -0.5); // 100 ÷ 200 − 1
  });

  test("estoque parado: cobertura exatamente 3 não entra; acima de 3 entra", () => {
    const pontos = (estoque) => [[2, 100], [3, 90], [4, 85], [5, 80], [6, 80, estoque]];
    assert.deepEqual(rec(serie("a", "111", pontos(240))), []); // 240 ÷ 80 = 3,0
    const r = rec(serie("a", "111", pontos(241)));
    assert.equal(r[0].tipo, "parado");
    assert.ok(Math.abs(r[0].tendencia - -0.2) < 1e-9); // 80 ÷ 100 − 1
  });

  test("estoque parado: queda de exatamente 10% não entra; 10,1% entra", () => {
    assert.deepEqual(rec(serie("a", "111", [[2, 1000], [5, 900], [6, 900, 5000]])), []);
    assert.equal(rec(serie("a", "111", [[2, 1000], [5, 899], [6, 899, 5000]]))[0].tipo, "parado");
  });

  test("sem a semana de 4 semanas antes, não há tendência e não há estoque parado", () => {
    assert.deepEqual(rec(serie("a", "111", [[4, 100], [5, 50], [6, 50, 5000]])), []);
  });

  test("ausência no meio da série: a semana de referência faltando anula a tendência", () => {
    assert.deepEqual(rec(serie("a", "111", [[1, 100], [2, null], [3, 100], [4, 100], [5, 50], [6, 50, 5000]])), []);
  });

  test("duas semanas sem venda com estoque: parado por falta de giro", () => {
    const r = rec(serie("a", "111", [[5, 0], [6, 0, 50]]));
    assert.deepEqual(r.map((x) => [x.tipo, x.semVenda]), [["parado", true]]);
    assert.deepEqual(rec(serie("a", "111", [[5, 0], [6, 0, 0]])), []);
  });

  test("sem estoque conhecido: não avaliado, com motivo, em vez de 'sem alerta'", () => {
    const r = avaliar(serie("a", "111", [[5, 100], [6, 100, null]]));
    assert.deepEqual(r.recomendacoes, []);
    assert.ok(r.naoAvaliados.some((x) => x.rede === "a" && x.ean === "111" && x.motivo === "estoque desconhecido"));
  });

  test("uma só semana com dado: não avaliado", () => {
    const r = avaliar(serie("a", "111", [[6, 100, 10]]));
    assert.deepEqual(r.recomendacoes, []);
    assert.ok(r.naoAvaliados.some((x) => x.rede === "a" && x.ean === "111" && x.motivo === "menos de 2 semanas com sell-out"));
  });

  test("combinação sem nenhuma linha na base também aparece como não avaliada", () => {
    const r = avaliar(serie("a", "111", [[5, 100], [6, 100, 500]]));
    // estoque: 3 redes × 2 produtos, menos a avaliada; preço: os 2 produtos, sem 2 redes com preço
    assert.equal(r.naoAvaliados.filter((x) => x.rede !== null).length, 5);
    assert.deepEqual(r.naoAvaliados.filter((x) => x.rede === null).map((x) => x.ean), ["111", "222"]);
  });

  test("preço sem 2 redes para comparar aparece como não avaliado, não como 'sem alerta'", () => {
    const base = [...serie("a", "222", [[6, 10, null, 20]]), ...serie("b", "222", [[6, null]])];
    const r = avaliar(base);
    assert.deepEqual(r.recomendacoes, []);
    assert.ok(r.naoAvaliados.some((x) => x.rede === null && x.ean === "222" && x.motivo.startsWith("preço")));
  });

  test("rede atrasada usa a última semana que chegou e é marcada", () => {
    const r = rec(serie("a", "111", [[4, 100], [5, 100, 50], [6, null]]));
    assert.deepEqual([r[0].semana, r[0].atrasada], [5, true]);
  });

  test("semana pedida no passado: só olha a base até ela", () => {
    // Na semana 4 o estoque cobria 0,5 semana (ruptura); na 6 já cobre 5 semanas.
    const base = serie("a", "111", [[3, 100], [4, 100, 50], [5, 100, 300], [6, 100, 500]]);
    assert.deepEqual(rec(base, 6), []);
    assert.deepEqual(rec(base, 4).map((x) => [x.tipo, x.semana, x.atrasada]), [["ruptura", 4, false]]);
  });

  const precos = (pa, pb, pc, semana = 6) => [
    ...serie("a", "222", [[semana, 10, null, pa]]),
    ...serie("b", "222", [[semana, 10, null, pb]]),
    ...serie("c", "222", [[semana, 10, null, pc]]),
  ];
  test("preço exatamente 10% acima não entra; 10,1% entra", () => {
    assert.deepEqual(rec(precos(11, 10, 10)), []);
    assert.deepEqual(rec(precos(11.01, 10, 10)).map((x) => [x.tipo, x.rede]), [["preco", "a"]]);
  });

  test("9,90 contra 9,00 é exatamente 10%: não entra (sem erro de arredondamento)", () => {
    assert.deepEqual(rec(precos(9.9, 9, 9)), []);
  });

  test("preço só se compara entre redes com dado na mesma semana", () => {
    assert.deepEqual(rec(precos(20, null, null)), []); // só uma rede com preço
    const base = [...serie("a", "222", [[6, 10, null, 12]]), ...serie("b", "222", [[6, 10, null, 10]]), ...serie("c", "222", [[5, 10, null, 5], [6, null]])];
    const r = rec(base);
    assert.equal(r.length, 1); // a contra b apenas: 12 ÷ 10 = +20%; c não entra
    assert.equal(r[0].media, 10);
  });

  test("preço da semana pedida no passado, não da atual", () => {
    const base = [...precos(15, 10, 10, 4), ...precos(10, 10, 10, 6)];
    assert.deepEqual(rec(base, 6), []);
    assert.deepEqual(rec(base, 4).map((x) => [x.rede, x.semana]), [["a", 4]]);
  });

  test("ordem: ruptura, depois estoque parado, depois preço", () => {
    const base = [
      ...precos(15, 10, 10),
      ...serie("b", "111", [[2, 100], [5, 80], [6, 80, 400]]),
      ...serie("c", "111", [[5, 100], [6, 100, 10]]),
    ];
    assert.deepEqual(rec(base).map((x) => x.tipo), ["ruptura", "parado", "preco"]);
  });
});

// ---------- Interpretação do pedido ----------
const CAT_I = {
  redes: [
    { id: "aurora", nome: "Rede Aurora", termos: ["aurora"] },
    { id: "boapraca", nome: "Rede Boa Praça", termos: ["boa praca", "boapraca"] },
    { id: "cerrado", nome: "Rede Cerrado", termos: ["cerrado"] },
  ],
  produtos: [
    { ean: "L", nome: "Chá gelado limão 1,5 L", termos: ["limao"], familias: ["cha gelado", "gelado", "gelada", "cha", "chas"] },
    { ean: "U", nome: "Suco de uva 1 L", termos: ["uva"], familias: ["suco", "sucos"] },
    { ean: "C", nome: "Água de coco 1 L", termos: ["coco"], familias: ["agua"] },
    { ean: "V", nome: "Chá verde 1,5 L", termos: ["cha verde", "verde"], familias: ["cha", "chas"] },
  ],
  semanas: [36, 37, 38, 39, 40, 41, 42, 43],
};
const ler = (t) => Teia.interpretar(t, CAT_I);
// Resposta inteira esperada: nenhum campo a mais, nenhum a menos.
const consulta = (o) => {
  const c = { tipo: "consulta", metricas: ["sellOut"], redes: [], produtos: [], semanas: [43], ...o };
  return { porSemana: c.semanas.length > 1, porRede: c.redes.length !== 1, porProduto: false, ...c };
};
const recs = (o) => ({ tipo: "recs", tipos: ["ruptura", "parado", "preco"], redes: [], produtos: [], semana: 43, ...o });

describe("interpretação do pedido", () => {
  const casos = [
    ["Sell-out da Rede Aurora na semana 43, por produto", consulta({ redes: ["aurora"], porProduto: true })],
    ["sell out da aurora s42", consulta({ redes: ["aurora"], semanas: [42], porProduto: true })],
    ["sell-out geral", consulta({})],
    ["Compare sell-in e sell-out do suco de uva nas últimas 4 semanas", consulta({ metricas: ["sellIn", "sellOut"], produtos: ["U"], semanas: [40, 41, 42, 43], porProduto: true })],
    ["sell-out entre semana 40 e 42", consulta({ semanas: [40, 41, 42] })],
    ["sell-out semanas 40 a 42", consulta({ semanas: [40, 41, 42] })],
    ["sell-out da semana 40 até a 42", consulta({ semanas: [40, 41, 42] })],
    ["sell-out s40 a s42", consulta({ semanas: [40, 41, 42] })],
    ["sell-out semanas 40, 42 e 43", consulta({ semanas: [40, 42, 43] })],
    ["sell-out semana 40 e 42", consulta({ semanas: [40, 42] })],
    ["sell-out semanas 42 a 40", consulta({ semanas: [40, 41, 42] })],
    ["Preço da água de coco por rede", consulta({ metricas: ["preco"], produtos: ["C"], porProduto: true })],
    ["preço nas redes semana 43", consulta({ metricas: ["preco"], porProduto: true })],
    ["estoque da Rede Boa Praça por produto", consulta({ metricas: ["estoque"], redes: ["boapraca"], porProduto: true })],
    ["sell-out da rede cerrado e da rede aurora", consulta({ redes: ["aurora", "cerrado"] })],
    ["sell-out do chá verde", consulta({ produtos: ["V"], porProduto: true })],
    ["evolução do sell-out da aurora", consulta({ redes: ["aurora"], semanas: [40, 41, 42, 43], porProduto: true })],
    ["vendas", { tipo: "esclarecer" }],
    ["vendas da Rede Aurora", { tipo: "esclarecer" }],
    ["Rede Aurora semana 43", { tipo: "esclarecer" }],
    ["preço e sell-out da aurora", { tipo: "esclarecer", motivo: "preco-misturado" }],
    ["ruptura nas semanas 40 a 42", { tipo: "esclarecer", motivo: "recs-uma-semana" }],
    ["estoque parado nas últimas 4 semanas", { tipo: "esclarecer", motivo: "recs-uma-semana" }],
    ["sell-out do Atacadão", { tipo: "desconhecido", termos: ["atacadao"] }],
    ["sell-out de Fanta", { tipo: "desconhecido", termos: ["fanta"] }],
    ["ruptura na Rede Dalva", { tipo: "desconhecido", termos: ["dalva"] }],
    ["sell-out do suco de manga", { tipo: "desconhecido", termos: ["manga"] }],
    ["Me manda os preços da concorrência", { tipo: "fora" }],
    ["qual a margem da Rede Aurora", { tipo: "fora" }],
    ["me passa o CPF do comprador", { tipo: "fora" }],
    ["sell-out da aurora semana 30", { tipo: "semanaFora", semana: 30 }],
    ["sell-out semana 5", { tipo: "semanaFora", semana: 5 }],
    ["sell-out semanas 41 a 45", { tipo: "semanaFora", semana: 44 }],
    ["Quais redes estão com estoque parado?", recs({ tipos: ["parado"] })],
    ["tem risco de ruptura na Rede Aurora?", recs({ tipos: ["ruptura"], redes: ["aurora"] })],
    ["ruptura na semana 42", recs({ tipos: ["ruptura"], semana: 42 })],
    ["o que fazer hoje", recs({})],
    ["preço acima das outras redes", recs({ tipos: ["preco"] })],
    // Família de produtos filtra; nome específico vence.
    ["sell-out de água", consulta({ produtos: ["C"], porProduto: true })],
    ["sell-out de suco", consulta({ produtos: ["U"], porProduto: true })],
    ["sell-out de chá", consulta({ produtos: ["L", "V"], porProduto: true })],
    ["sell-out de chá gelado", consulta({ produtos: ["L"], porProduto: true })],
    ["sell-out de chá verde", consulta({ produtos: ["V"], porProduto: true })],
    ["sell-out de água de coco", consulta({ produtos: ["C"], porProduto: true })],
    ["ruptura de chá", recs({ tipos: ["ruptura"], produtos: ["L", "V"] })],
    // Volume restringe produto escolhido; sozinho ou sem combinar, pergunta.
    ["sell-out de chá 1,5 L", consulta({ produtos: ["L", "V"], porProduto: true })],
    ["sell-out do suco de uva 1 L", consulta({ produtos: ["U"], porProduto: true })],
    ["sell-out de 1 L", { tipo: "esclarecer", motivo: "volume-sem-produto" }],
    ["sell-out do suco de uva 450 ml", { tipo: "esclarecer", motivo: "volume-nao-bate" }],
    // Período nunca é trocado.
    ["sell-out da 40 até a 42", consulta({ semanas: [40, 41, 42] })],
    ["sell-out de 40 a 42", consulta({ semanas: [40, 41, 42] })],
    ["sell-out entre 40 e 42", consulta({ semanas: [40, 41, 42] })],
    ["sell-out da aurora 42", { tipo: "esclarecer", motivo: "numero-solto" }],
    ["sell-out da aurora na 42", { tipo: "esclarecer", motivo: "numero-solto" }],
    ["sell-out da aurora em 2025", { tipo: "esclarecer", motivo: "numero-solto" }],
    ["ruptura 42", { tipo: "esclarecer", motivo: "numero-solto" }],
    ["sell-out nas últimas 99 semanas", { tipo: "esclarecer", motivo: "ultimas-fora" }],
    ["sell-out nas últimas 0 semanas", { tipo: "esclarecer", motivo: "ultimas-fora" }],
    // Nome pela metade e exclusão não viram "todas" nem o contrário do pedido.
    ["sell-out da boa", { tipo: "esclarecer", motivo: "rede-incompleta" }],
    ["boa tarde, sell-out geral", consulta({})],
    ["sell-out sem a aurora", { tipo: "esclarecer", motivo: "exclusao" }],
    ["sell-out de sucos sem 1 L", { tipo: "esclarecer", motivo: "exclusao" }],
    // Volume não derruba nome citado; período misturado não vira intervalo.
    ["sell-out do suco de uva e chá verde 1,5 L", { tipo: "esclarecer", motivo: "volume-nao-bate" }],
    ["sell-out de suco e chá 1,5 L", { tipo: "esclarecer", motivo: "volume-nao-bate" }],
    ["sell-out de 40 a 41 e 43", { tipo: "esclarecer", motivo: "periodo-misturado" }],
    ["sell-out semanas 40 a 41 e 43", { tipo: "esclarecer", motivo: "periodo-misturado" }],
    ["sell-out menos suco", { tipo: "esclarecer", motivo: "exclusao" }],
    ["", { tipo: "vazio" }],
    ["bom dia", { tipo: "naoEntendi" }],
  ];
  for (const [texto, esperado] of casos) {
    test(`"${texto}"`, () => assert.deepEqual(ler(texto), esperado));
  }

  test("texto com código vira palavra desconhecida, não consulta", () => {
    assert.equal(ler('<img src=x onerror="alert(1)">').tipo, "desconhecido");
  });

  test("as opções de esclarecimento são entendidas", () => {
    for (const [sufixo, m] of [["(sell-in)", "sellIn"], ["(sell-out)", "sellOut"], ["(estoque)", "estoque"], ["(preço)", "preco"]]) {
      assert.deepEqual(ler(`Vendas da Rede Boa Praça ${sufixo}`), consulta({ metricas: [m], redes: ["boapraca"], porProduto: true }), sufixo);
    }
  });
});

// ---------- Consulta ----------
const row = (rede, ean, semana, sellIn, sellOut, preco, estoque) => ({ rede, ean, semana, sellIn, sellOut, preco, estoque });
const BASE_C = [
  row("a", "111", 1, 5, 10, 5.0, 95), row("a", "111", 2, 6, 12, 5.5, 89),
  row("a", "222", 1, 10, 20, 3.0, 40), row("a", "222", 2, 9, 18, 3.2, 31),
  row("b", "111", 1, 3, 7, 5.2, 26), row("b", "111", 2, 2, null, null, null),
  row("b", "222", 1, 4, 8, 3.1, 36), row("b", "222", 2, 4, null, null, null),
];
const pedido = (extra) => ({ metricas: ["sellOut"], redes: [], produtos: [], semanas: [2], porSemana: false, porRede: true, porProduto: false, ...extra });
const valores = (r) => r.tabela.map((t) => [...t.chave.filter((x) => x !== null), ...t.valores]);

describe("consulta na base única", () => {
  test("sell-out por rede: a rede sem a semana sai sem dado, e a soma não conta zero", () => {
    const r = Teia.consultar(BASE_C, pedido());
    assert.deepEqual(valores(r), [["a", 30], ["b", null]]);
    assert.deepEqual(r.conferencia, [{ metrica: "sellOut", ok: true, tipo: "soma", total: 30, direto: 30 }]);
    assert.equal(r.semDado, true);
  });

  test("sell-in por rede existe mesmo sem o sell-out da semana", () => {
    assert.deepEqual(valores(Teia.consultar(BASE_C, pedido({ metricas: ["sellIn"] }))), [["a", 15], ["b", 6]]);
  });

  test("sell-out por semana e rede, na ordem do ORDER BY", () => {
    const r = Teia.consultar(BASE_C, pedido({ semanas: [1, 2], porSemana: true }));
    assert.deepEqual(valores(r), [[1, "a", 30], [1, "b", 15], [2, "a", 30], [2, "b", null]]);
    assert.equal(r.conferencia[0].total, 75);
  });

  test("preço por rede e produto (médias escritas à mão)", () => {
    const r = Teia.consultar(BASE_C, pedido({ metricas: ["preco"], semanas: [1], porProduto: true }));
    assert.deepEqual(valores(r), [["a", "111", 5], ["a", "222", 3], ["b", "111", 5.2], ["b", "222", 3.1]]);
    assert.equal(r.conferencia[0].ok, true);
  });

  test("preço médio de duas semanas do mesmo produto: (5,00 + 5,50) ÷ 2", () => {
    const r = Teia.consultar(BASE_C, pedido({ metricas: ["preco"], semanas: [1, 2], redes: ["a"], produtos: ["111"], porRede: false, porProduto: true }));
    assert.deepEqual(valores(r), [["111", 5.25]]);
  });

  test("preço de grupo com semana sem dado sai sem dado", () => {
    const r = Teia.consultar(BASE_C, pedido({ metricas: ["preco"], semanas: [1, 2], redes: ["b"], produtos: ["111"], porRede: false, porProduto: true }));
    assert.deepEqual(valores(r), [["111", null]]);
  });

  test("estoque por produto de uma rede", () => {
    const r = Teia.consultar(BASE_C, pedido({ metricas: ["estoque"], redes: ["a"], porRede: false, porProduto: true }));
    assert.deepEqual(valores(r), [["111", 89], ["222", 31]]);
  });

  test("filtro por produto e duas métricas juntas", () => {
    const r = Teia.consultar(BASE_C, pedido({ metricas: ["sellIn", "sellOut"], produtos: ["111"], semanas: [1], porProduto: true }));
    assert.deepEqual(valores(r), [["a", "111", 5, 10], ["b", "111", 3, 7]]);
    assert.deepEqual(r.conferencia.map((c) => [c.total, c.ok]), [[8, true], [17, true]]);
  });
});
