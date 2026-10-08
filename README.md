# n8n-nodes-econodata

Node de comunidade [n8n](https://n8n.io) da **Econodata** — enriqueça e segmente empresas B2B do Brasil
(CNPJ, sócios, contatos, porte/faturamento, CNAE, dívidas, grupo econômico) direto nos seus fluxos,
via a API pública da Econodata.

Ligue `[gatilho no seu CRM] → [Econodata enriquece] → [atualiza no CRM/planilha/e-mail]` **sem código**.

> **v1 é somente leitura** (enriquecimento e segmentação): você *consulta* dados para usar no fluxo.
> Não há gravação de volta nem gatilhos (triggers) nesta versão.

## Pré-requisitos

- Um **n8n** (self-host ou Cloud) com **Community nodes** habilitado.
- Uma **API key da Econodata** no formato `ek_live_…`:
  - **Já é cliente:** gere em [Chaves e Integrações](https://plat.econodata.com.br/#/integracoes-api), na
    plataforma Econodata. Para automações, prefira uma chave **somente leitura**.
  - **Novo cliente:** comece pelo [trial da API](https://www.econodata.com.br/api-trial?utm_source=n8n).

## Instalação

No n8n: **Settings → Community nodes → Install** → informe `n8n-nodes-econodata` → **Install**.
O node **Econodata** passa a aparecer na busca de nodes do editor.

_(Self-host, alternativa manual: `npm install n8n-nodes-econodata` no diretório do n8n e reinicie.)_

## Credencial

Crie uma credencial **"Econodata API"**:

| Campo | Valor |
|---|---|
| **API Key** | sua chave `ek_live_…` |
| **Base URL** | `https://api.econodata.com.br` (padrão) |

A chave é enviada como `Authorization: Bearer …`. O teste de conexão faz um `GET` de saldo (200 = chave
válida). Uma credencial pode ser reusada em vários fluxos.

## Início rápido

1. Adicione o node **Econodata** → recurso **Empresa** → operação **Encontrar Empresa**.
2. Selecione a credencial.
3. Informe um **CNPJ** (ex.: `47960950000121`, com ou sem máscara).
4. Em **Incluir**, marque os *buckets* que quer trazer (ex.: `cadastro`).
5. Execute — a saída já pode alimentar o próximo node do fluxo.

Sem **Incluir**, o lookup devolve só o `cnpj` (mais barato). Cada bucket adicionado traz mais campos
(e cobra tokens — veja abaixo).

## Operações

**Recurso Empresa**

| Operação | O que faz |
|---|---|
| **Encontrar Empresa** | busca por CNPJ, site ou e-mail → 1 empresa |
| **Match Por Nome** | busca aproximada por nome (fuzzy) |
| **Enriquecer Lote** | lista de 1–100 CNPJs → empresas + erros |
| **Segmentar Por Filtros** | lista paginada por filtros (porte, UF, CNAE, faturamento…) |
| **Segmentar Por Pesquisa Salva** | segmentação a partir de uma pesquisa salva da conta (pelo nome) |
| **Contar Segmento Por Filtros** | só a contagem de um segmento (barato) |
| **Contar Segmento Por Pesquisa Salva** | só a contagem, a partir de uma pesquisa salva |
| **Grupo Econômico** | empresas de 1ª ordem ligadas por sócios (paginado) |
| **Listar Pesquisas Salvas** | pesquisas salvas da conta (para usar no "por pesquisa salva") |
| **Buscar Decisores** | organograma paginado: decisores ou colaboradores da empresa |

**Recurso Conta**

| Operação | O que faz |
|---|---|
| **Ver Saldo** | saldo de tokens da conta (não cobra) |

## Enriquecimento: o que trazer

- **Incluir** — expande a empresa em **buckets** (cada um entregue cobra tokens):
  - `cadastro` — dados cadastrais (RFB): razão social/fantasia, natureza, endereço, CNAE, sócios.
  - `estrategico` — porte, faturamento, headcount, tecnologias.
  - `perfilNegocio` — setor, matriz + filiais, dívidas, NCM.
  - `contatosBasicos` — telefones e e-mails.
  - `contatosAvancados` — telefones verificados, redes sociais, score.
- **Campos** — recorte fino por *dot-path* (ex.: `cadastro.razaoSocial, contatosBasicos.telefones`);
  traz só o que precisa (e paga menos).
- **Escopo** (no Encontrar Empresa) — `unidade` (padrão), `filiais` ou `matrizFiliais`.
- **Limite** — teto de itens por lista (telefones, sócios, decisores…). `0` = todos.

## Custo em tokens

A cobrança é em **tokens** (base do endpoint + campos entregues por empresa). Na prática:

- Lookup **sem `Incluir` é barato**; cada bucket entregue adiciona custo.
- **Segmentar** cobra o funil **a cada chamada** — para só saber o tamanho, use **Contar Segmento**.
- Re-consultar a mesma empresa em 24h **não recobra** o que já foi cobrado.
- Toda resposta traz o header **`X-Tokens-Charged`**. Acompanhe o saldo com **Ver Saldo**.

## Erros

| Status | Significado | O que fazer |
|---|---|---|
| **401** | chave inválida/revogada/expirada | confira a API key |
| **402** | sem saldo de tokens | recarregue / veja o saldo |
| **403** | a chave não tem o escopo da operação | use uma chave com o escopo certo |
| **422** | parâmetro inválido (CNPJ, filtro, cursor) | ajuste a entrada |
| **429** | rate limit (60/min por chave) | respeite o header `Retry-After` |
| **503** | serviço momentaneamente indisponível | tente de novo (use *Retry On Fail*) |

Dica: em lotes/listas, ative **"Continue On Fail"** no node para um item com erro não derrubar o fluxo.

## Suporte

Econodata — plataforma de *sales intelligence* / prospecção B2B: [econodata.com.br](https://www.econodata.com.br).
Dúvidas sobre a API e chaves: [Chaves e Integrações](https://plat.econodata.com.br/#/integracoes-api), na plataforma.
Documentação da API v4: [econodata-tecnologia.github.io/api-v4-docs](https://econodata-tecnologia.github.io/api-v4-docs/).

## Contribuindo

```bash
npm ci
npm run build
npm run lint
npm test
```

Publicação: uma GitHub Release na tag `v<versão>` publica no npm pela Action `publish-npm.yml`.

## Licença

[MIT](./LICENSE) © Econodata
