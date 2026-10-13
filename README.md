# n8n-nodes-econodata

[n8n](https://n8n.io) community node for **Econodata**. Enrich and segment Brazilian B2B companies (CNPJ, partners,
contacts, size and revenue, CNAE, debts, economic group) right inside your workflows, using the public Econodata API.

Build `[trigger in your CRM] → [Econodata enriches] → [update the CRM, sheet or email]` **without code**.

> **Read-only.** The node fetches data to use in your workflow. It does not write data back and has no triggers.

## Prerequisites

- An **n8n** instance (self-hosted or Cloud) with community nodes enabled.
- An **Econodata API key** (`ek_live_...`):
  - **Existing customers:** create one on the [API keys page](https://plat.econodata.com.br/#/integracoes-api)
    (Chaves e Integrações) of the Econodata platform. For automations, prefer a **read-only** key.
  - **New customers:** start with the [API trial](https://www.econodata.com.br/api-trial?utm_source=n8n).

## Installation

In n8n, go to **Settings → Community nodes → Install**, enter `n8n-nodes-econodata` and select **Install**.
The **Econodata** node then shows up in the node search of the editor.

Self-hosted alternative: run `npm install n8n-nodes-econodata` in the n8n folder and restart n8n.

## Credentials

Create an **Econodata API** credential:

| Field | Value |
|---|---|
| **API Key** | your `ek_live_...` key |
| **Base URL** | `https://api.econodata.com.br` (default) |

The key is sent as `Authorization: Bearer ...`. The connection test reads the token balance (HTTP 200 means the key
works). One credential can be reused in many workflows.

## Quick start

1. Add the **Econodata** node, choose the **Company** resource and the **Find** operation.
2. Select the credential.
3. Enter a **CNPJ**, for example `47960950000121` (with or without punctuation).
4. Under **Options → Data Groups to Include**, pick what to return, for example **Registration Data**.
5. Run the node. The output can feed the next node of the workflow.

Without data groups, the node returns only the CNPJ, which is the cheapest call. Each group adds fields and uses tokens.

## Operations

**Company**

| Operation | What it does |
|---|---|
| **Find** | finds one company by CNPJ, website or email |
| **Match by Name** | finds the company that best matches a name and other details, with a score |
| **Enrich Many** | enriches a list of 1 to 100 CNPJs at once |
| **Get Many by Filters** | returns the companies that match filters (size, state, CNAE, revenue...) |
| **Get Many by Saved Search** | returns the companies of a saved search, picked from a list |
| **Count by Filters** | returns only the number of companies that match the filters |
| **Count by Saved Search** | returns only the number of companies in a saved search, picked from a list |
| **Get Economic Group** | returns the companies linked through shared partners |
| **Get Saved Searches** | lists the saved searches of the account |
| **Get People** | returns the decision makers or employees of a company |

**Account**

| Operation | What it does |
|---|---|
| **Get Balance** | returns the token balance of the account, free of charge |

## Choosing what to return

- **Data Groups to Include** (each group delivered uses tokens):
  - **Registration Data**: legal and trade name, legal nature, address, CNAE, partners.
  - **Strategic**: size, revenue, headcount, technologies.
  - **Business Profile**: industry, headquarters and branches, debts, NCM.
  - **Basic Contacts**: phones and emails.
  - **Advanced Contacts**: verified phones, social networks, score.
- **Fields**: a comma-separated list of specific fields, for example `cadastro.razaoSocial, contatosBasicos.telefones`.
  Returns only what you need and costs less.
- **Scope** (in **Find**): **Single Unit** (default), **Branches** or **Headquarters and Branches**.
- **Limit per List**: max items in each list (phones, partners, decision makers). `0` returns all.
- **Simplify** (on by default): returns up to 10 key fields per company (CNPJ, legal and trade name, status, state,
  main CNAE, size, first phone, email). It only trims the output; turn it off to get every field of the data groups
  you requested. The data groups requested are charged either way.
- **Return All** and **Limit** (in **Get Many**, **Get People** and **Get Economic Group**): each company or person
  is one output item, and the node goes through the pages for you. Every page uses tokens.

Workflows created with version 1.1.0 or earlier keep working as before: the node keeps their settings and output
format (one item with the whole page and a manual cursor). New nodes added to a workflow use the current version.

## Example workflow

New deal in the CRM → **Econodata: Find** (CNPJ from the deal, groups **Registration Data** and **Basic Contacts**) →
update the deal with the legal name, CNAE and phones.

To size a segment before pulling it, run **Count by Filters** first and only then **Get Many by Filters** with the same
filters and a **Limit**.

## Token usage

Calls are charged in **tokens** (endpoint base cost plus the fields delivered for each company):

- A lookup **without data groups is cheap**; each group delivered adds cost.
- **Get Many** operations charge on **every call**. To only know the size of a segment, use **Count**.
- Looking up the same company again within 24 hours does not charge again for what was already charged.
- Every response has the **`X-Tokens-Charged`** header. Track the balance with **Get Balance**.

## HTTP status codes

| Status | Meaning | What to do |
|---|---|---|
| **401** | invalid, revoked or expired key | check the API key |
| **402** | not enough tokens | top up or check the balance |
| **403** | the key cannot run this operation | use a key with the right scope |
| **422** | invalid input (CNPJ, filter, cursor) | fix the input |
| **429** | rate limit (60 per minute per key) | wait for the time in the `Retry-After` header |
| **503** | service temporarily unavailable | try again (use *Retry On Fail*) |

Tip: in lists and batches, turn on **Continue On Fail** so one item does not stop the whole workflow.

## Compatibility

Tested with n8n 2.41. Requires community nodes enabled.

## Version history

- **1.2.0**: English interface; node version 2 with saved search list, Simplify, Return All and Limit, one item per
  company or person.
- **1.1.0**: public repository and npm provenance.
- **1.0.2**: documentation links and User-Agent.

## Support

Econodata is a B2B sales intelligence and prospecting platform: [econodata.com.br](https://www.econodata.com.br).
API keys: [API keys page](https://plat.econodata.com.br/#/integracoes-api) (Chaves e Integrações) on the platform.
API v4 documentation (Portuguese): [econodata-tecnologia.github.io/api-v4-docs](https://econodata-tecnologia.github.io/api-v4-docs/).

## Development

```bash
npm ci
npm run build
npm run lint
npm test
```

Publishing: run the **Publish (npm)** workflow (`workflow_dispatch`) on `main`. It builds, lints, tests and publishes
to npm with provenance.

## License

[MIT](./LICENSE) © Econodata
