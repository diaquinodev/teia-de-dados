# Teia de Dados Comercial

Demonstração com dados fictícios para um processo seletivo: arquivos de sell-in e sell-out
chegam de fornecedores, passam por uma carga conferida e viram uma base única. Dessa base saem
as recomendações para vendas e as respostas de um agente de pedidos de dados.

Publicada em https://claude.ai/artifact/QypidgWmGtmVi2o64aZft9 (página única, sem servidor).

## Como está organizado

- `pagina/teia-de-dados.html` — a página. As regras de negócio ficam no bloco
  `<teia-logica>`, em funções puras (`carregar`, `recomendar`, `interpretar`, `consultar`),
  sem acesso à tela.
- `testes/regras.test.cjs` — regras com casos escritos à mão, inclusive os limites.
- `testes/mutantes.cjs` — planta 20 erros de regra, um por vez, e exige que os testes falhem.
- `testes/tela.cjs` — 10 aparelhos (Chrome, Edge, Firefox, Safari/WebKit; computador, iPhone,
  iPad, Android) em tema claro e escuro; números conferidos contra os arquivos brutos; segurança
  e acessibilidade (axe).

## Rodar

```
npm install
npm test
```

`test:tela` usa o Chrome e o Edge instalados no Windows e o Firefox e o WebKit do Playwright
(`npx playwright-core install firefox webkit`).

## Regras

1. Semana sem arquivo válido = "sem dado", nunca zero.
2. Reenvio: o arquivo mais recente da rede e semana substitui o anterior inteiro; dois com a
   mesma hora e conteúdo diferente deixam a semana sem dado.
3. Na entrada, o arquivo é rejeitado inteiro (com o motivo) se: rede ou semana fora do cadastro,
   unidade que não seja inteiro ≥ 0, preço que não seja positivo, soma das linhas diferente do
   total declarado, produto repetido ou produto esperado ausente (uma linha por produto, todos
   os produtos do cadastro; vale para sell-in e sell-out). Linha ausente pode ser venda zero ou
   falha de extração: sem o fornecedor dizer qual, o arquivo não entra.
4. Código sem de-para fica fora da base e é listado.
5. Totais de sell-out e de sell-in conferidos pelo cabeçalho dos arquivos, menos o que ficou
   sem cadastro. Se não bater, a carga fica bloqueada; se bater com lacunas, fica "parcial".
6. Estoque = anterior + sell-in − sell-out; deixa de existir depois de uma lacuna.
7. Ruptura: cobertura abaixo de 1 semana (média das 2 últimas semanas com dado).
8. Estoque parado: cobertura acima de 3 semanas e queda maior que 10% contra 4 semanas antes,
   ou estoque sem venda nas 2 últimas semanas.
9. Preço: só redes com dado na mesma semana; mais de 10% acima da média das outras.
10. Recomendação de uma semana olha só a base até ela. O que não dá para avaliar (estoque
    desconhecido, menos de 2 semanas) aparece com o motivo: "sem alerta" nunca esconde "sem dado".
11. Agente: só aceita palavras e nomes que conhece; entende semana, lista e intervalo de semanas;
    "vendas" pede esclarecimento; preço sai por produto; pedidos financeiros, pessoais ou de
    concorrência não são respondidos. A conferência da tabela é de consistência (cálculo contra
    tabela), não uma fonte independente.
