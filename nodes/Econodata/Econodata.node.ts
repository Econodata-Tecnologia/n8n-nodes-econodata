import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { econodataApiRequest, parseFiltros, toStringArray } from './GenericFunctions';

/** Buckets opcionais de `incluir` (v4.1: 5 buckets por categoria de valor). Ordem A-Z p/ o lint. */
const bucketOptions = [
	{ name: 'Cadastro', value: 'cadastro' },
	{ name: 'Contatos Avançados', value: 'contatosAvancados' },
	{ name: 'Contatos Básicos', value: 'contatosBasicos' },
	{ name: 'Estratégico', value: 'estrategico' },
	{ name: 'Perfil Do Negócio', value: 'perfilNegocio' },
];

/** Opções compartilhadas (incluir/campos/limite) dos endpoints de enriquecimento/segmentação. */
const opcoesEnriquecimentoValues = [
	{
		displayName: 'Buckets a Incluir',
		name: 'incluir',
		type: 'multiOptions' as const,
		options: bucketOptions,
		default: [],
		description:
			'Buckets a expandir (v4.1): cadastro (razão social/fantasia/RFB), estratégico (porte/faturamento/tech), perfilNegocio (setor/matriz-filiais/dívidas), contatosBasicos (tel não-verificados/e-mails), contatosAvancados (tel verificados/decisores). Sem incluir, o lookup retorna só o cnpj. Cada bucket entregue cobra tokens',
	},
	{
		displayName: 'Campos (Dot-Path)',
		name: 'campos',
		type: 'string' as const,
		default: '',
		description:
			'Recorte de folhas por dot-path, separado por vírgula (ex.: cadastro.razaoSocial, contatosBasicos.telefones). Auto-inclui o bucket da folha.',
	},
	{
		displayName: 'Limite Por Lista',
		name: 'limite',
		type: 'number' as const,
		default: 5,
		description:
			'Máximo de itens por lista de cada empresa (telefones, e-mails, sócios…). 0 = todos (cobra tudo).',
	},
];

const onlyDigits = (value: string): string => value.replace(/\D/g, '');

/** Monta `criterios` a partir dos parâmetros informados, descartando vazios. */
function buildCriterios(
	ctx: IExecuteFunctions,
	index: number,
	fields: string[],
): IDataObject {
	const criterios: IDataObject = {};
	for (const field of fields) {
		const value = ctx.getNodeParameter(field, index, '') as string;
		if (typeof value === 'string' && value.trim() !== '') {
			criterios[field] = value.trim();
		}
	}
	return criterios;
}

/** Aplica incluir/campos/limite (da collection `opcoes`) num corpo de request. */
function applyOpcoes(ctx: IExecuteFunctions, index: number, body: IDataObject): void {
	const opcoes = ctx.getNodeParameter('opcoes', index, {}) as IDataObject;
	const incluir = opcoes.incluir as string[] | undefined;
	if (incluir && incluir.length > 0) {
		body.incluir = incluir;
	}
	const campos = toStringArray(opcoes.campos);
	if (campos) {
		body.campos = campos;
	}
	if (typeof opcoes.limite === 'number') {
		body.limite = opcoes.limite;
	}
}

export class Econodata implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Econodata',
		name: 'econodata',
		icon: { light: 'file:../../icons/econodata.svg', dark: 'file:../../icons/econodata.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Enriquecimento e segmentação de empresas B2B via API v4 da Econodata',
		defaults: { name: 'Econodata' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'econodataApi', required: true }],
		properties: [
			{
				displayName: 'Recurso',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Conta', value: 'account' },
					{ name: 'Empresa', value: 'company' },
				],
				default: 'company',
			},
			// ── Operações de Empresa ──
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['company'] } },
				options: [
					{
						name: 'Buscar Decisores',
						value: 'people',
						action: 'Buscar decisores e colaboradores de uma empresa',
						description: 'Organograma paginado de uma empresa (GET /v4/companies/{cnpj}/people)',
					},
					{
						name: 'Contar Segmento Por Filtros',
						value: 'calcList',
						action: 'Contar empresas de um segmento por filtros',
						description: 'Só o total do segmento por filtros diretos (POST /v4/companies/calc_list)',
					},
					{
						name: 'Contar Segmento Por Pesquisa Salva',
						value: 'calcListById',
						action: 'Contar empresas de uma pesquisa salva',
						description: 'Só o total do segmento de uma pesquisa salva (POST /v4/companies/calc_list_by_id)',
					},
					{
						name: 'Encontrar Empresa',
						value: 'search',
						action: 'Encontrar empresa por CNPJ site ou email',
						description: 'Enriquece 1 empresa por identificador forte (POST /v4/companies/search)',
					},
					{
						name: 'Enriquecer Lote',
						value: 'lookupBatch',
						action: 'Enriquecer um lote de empresas',
						description: 'Enriquece até 100 CNPJs de uma vez (POST /v4/companies)',
					},
					{
						name: 'Grupo Econômico',
						value: 'economicGroup',
						action: 'Listar empresas do grupo economico',
						description: 'Empresas relacionadas de 1ª ordem por sócios (POST /v4/companies/economic-group)',
					},
					{
						name: 'Listar Pesquisas Salvas',
						value: 'savedSearches',
						action: 'Listar as pesquisas salvas da conta',
						description: 'Metadado das pesquisas salvas compartilhadas — grátis (GET /v4/companies/saved_searches)',
					},
					{
						name: 'Match Por Nome',
						value: 'match',
						action: 'Encontrar empresa por nome aproximado',
						description: 'Casa uma empresa por nome/identificadores, com score (POST /v4/companies/match)',
					},
					{
						name: 'Segmentar Por Filtros',
						value: 'searchList',
						action: 'Listar empresas de um segmento por filtros',
						description: 'Segmentação paginada por filtros diretos (POST /v4/companies/search_list)',
					},
					{
						name: 'Segmentar Por Pesquisa Salva',
						value: 'searchListById',
						action: 'Listar empresas de uma pesquisa salva',
						description: 'Segmentação paginada por pesquisa salva (POST /v4/companies/search_list_by_id)',
					},
				],
				default: 'search',
			},
			// ── Operação de Conta ──
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['account'] } },
				options: [
					{
						name: 'Ver Saldo',
						value: 'balance',
						action: 'Ver o saldo de tokens da conta',
						description: 'Saldo de tokens da conta autenticada (GET /v4/account/balance)',
					},
				],
				default: 'balance',
			},
			// ── Identificadores (search + match) ──
			{
				displayName: 'CNPJ',
				name: 'cnpj',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['company'], operation: ['search', 'match'] } },
				description: 'CNPJ com ou sem máscara (normalizado no servidor)',
			},
			{
				displayName: 'Site',
				name: 'site',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['company'], operation: ['search', 'match'] } },
				description: 'Site/domínio da empresa (ex.: econodata.com.br)',
			},
			{
				displayName: 'E-Mail',
				name: 'email',
				type: 'string',
				placeholder: 'name@email.com',
				default: '',
				displayOptions: { show: { resource: ['company'], operation: ['search', 'match'] } },
				description: 'E-mail da empresa (o domínio é usado no casamento)',
			},
			{
				displayName: 'Raiz Do CNPJ',
				name: 'raizCnpj',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['company'], operation: ['search'] } },
				description: 'Raiz do CNPJ (8 primeiros dígitos), com ou sem máscara',
			},
			{
				displayName: 'Escopo',
				name: 'escopo',
				type: 'options',
				options: [
					{ name: 'Filiais', value: 'filiais' },
					{ name: 'Matriz E Filiais', value: 'matrizFiliais' },
					{ name: 'Unidade', value: 'unidade' },
				],
				default: 'unidade',
				displayOptions: { show: { resource: ['company'], operation: ['search'] } },
				description: 'Traz só a unidade, as filiais, ou a matriz + filiais da mesma raiz (v4.1: grupo virou matrizFiliais)',
			},
			{
				displayName: 'Nome Da Empresa',
				name: 'nomeEmpresa',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['company'], operation: ['match'] } },
				description: 'Razão social ou nome fantasia para o casamento aproximado',
			},
			{
				displayName: 'UF',
				name: 'uf',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['company'], operation: ['match'] } },
				description: 'UF (2 letras) para desambiguar o match — ex.: SP',
			},
			{
				displayName: 'Telefone',
				name: 'telefone',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['company'], operation: ['match'] } },
				description: 'Telefone em qualquer formato (casamento exato após normalização)',
			},
			// ── Lote ──
			{
				displayName: 'CNPJs',
				name: 'cnpjs',
				type: 'string',
				default: '',
				required: true,
				typeOptions: { rows: 3 },
				displayOptions: { show: { resource: ['company'], operation: ['lookupBatch'] } },
				description: 'Até 100 CNPJs separados por vírgula ou quebra de linha',
			},
			// ── CNPJ único obrigatório (people + economicGroup) ──
			{
				displayName: 'CNPJ',
				name: 'cnpjEmpresa',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['company'], operation: ['people', 'economicGroup'] } },
				description: 'CNPJ da empresa (com ou sem máscara)',
			},
			// ── Nome de pesquisa salva (searchListById + calcListById) ──
			{
				displayName: 'Nome Da Pesquisa Salva',
				name: 'nomePesquisa',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: { resource: ['company'], operation: ['searchListById', 'calcListById'] },
				},
				description: 'Nome exato da pesquisa salva (dica: use "Listar Pesquisas Salvas")',
			},
			// ── Filtros (searchList + calcList) ──
			{
				displayName: 'Filtros (JSON)',
				name: 'filtros',
				type: 'json',
				default: '={}',
				required: true,
				displayOptions: { show: { resource: ['company'], operation: ['searchList', 'calcList'] } },
				description: 'Filtros diretos, ex.: {"uf":["SP"],"porte":["MEDIO"],"cnaePrimario":["6201-5/01"]}',
			},
			// ── Opções de enriquecimento (search/match/lote/segmentações) ──
			{
				displayName: 'Opções',
				name: 'opcoes',
				type: 'collection',
				placeholder: 'Adicionar opção',
				default: {},
				displayOptions: {
					show: {
						resource: ['company'],
						operation: ['search', 'match', 'lookupBatch', 'searchList', 'searchListById'],
					},
				},
				options: opcoesEnriquecimentoValues,
			},
			// ── Paginação das segmentações ──
			{
				displayName: 'Paginação',
				name: 'paginacao',
				type: 'collection',
				placeholder: 'Adicionar opção',
				default: {},
				displayOptions: {
					show: { resource: ['company'], operation: ['searchList', 'searchListById'] },
				},
				options: [
					{
						displayName: 'Cursor',
						name: 'cursor',
						type: 'string',
						default: '',
						description: 'Cursor opaco da página anterior (cursorProximo). Vazio = primeira página.',
					},
					{
						displayName: 'Tamanho Da Página',
						name: 'tamanho',
						type: 'number',
						default: 50,
						description: 'Itens por página (1–200)',
					},
				],
			},
			// ── Opções de "Buscar Decisores" ──
			{
				displayName: 'Opções',
				name: 'opcoesPessoas',
				type: 'collection',
				placeholder: 'Adicionar opção',
				default: {},
				displayOptions: { show: { resource: ['company'], operation: ['people'] } },
				options: [
					{
						displayName: 'Página',
						name: 'pagina',
						type: 'number',
						default: 1,
						description: 'Número da página (a partir de 1)',
					},
					{
						displayName: 'Papel',
						name: 'papel',
						type: 'options',
						options: [
							{ name: 'Colaboradores', value: 'colaboradores' },
							{ name: 'Decisores', value: 'decisores' },
						],
						default: 'decisores',
						description: 'Quais pessoas trazer',
					},
					{
						displayName: 'Tamanho Da Página',
						name: 'tamanho',
						type: 'number',
						default: 50,
						description: 'Itens por página (1–200)',
					},
				],
			},
			// ── Opções de "Grupo Econômico" ──
			{
				displayName: 'Opções',
				name: 'opcoesGrupo',
				type: 'collection',
				placeholder: 'Adicionar opção',
				default: {},
				displayOptions: { show: { resource: ['company'], operation: ['economicGroup'] } },
				options: [
					{
						displayName: 'Página',
						name: 'pagina',
						type: 'number',
						default: 1,
						description: 'Número da página (a partir de 1)',
					},
					{
						displayName: 'Tamanho Da Página',
						name: 'tamanho',
						type: 'number',
						default: 20,
						description: 'Itens por página (1–100)',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				let response: IDataObject;

				if (resource === 'account') {
					// balance
					response = await econodataApiRequest.call(this, 'GET', '/v4/account/balance');
				} else if (operation === 'search') {
					const criterios = buildCriterios(this, i, ['cnpj', 'site', 'email', 'raizCnpj']);
					if (Object.keys(criterios).length === 0) {
						throw new NodeOperationError(
							this.getNode(),
							'Informe ao menos um identificador (CNPJ, site, e-mail ou raiz do CNPJ).',
							{ itemIndex: i },
						);
					}
					const body: IDataObject = { criterios };
					const escopo = this.getNodeParameter('escopo', i, 'unidade') as string;
					if (escopo && escopo !== 'unidade') {
						body.escopo = escopo;
					}
					applyOpcoes(this, i, body);
					response = await econodataApiRequest.call(this, 'POST', '/v4/companies/search', body);
				} else if (operation === 'match') {
					const criterios = buildCriterios(this, i, ['cnpj', 'site', 'email', 'uf', 'telefone']);
					const nome = (this.getNodeParameter('nomeEmpresa', i, '') as string).trim();
					if (nome !== '') {
						criterios.nome = nome;
					}
					if (Object.keys(criterios).length === 0) {
						throw new NodeOperationError(
							this.getNode(),
							'Informe ao menos um critério de match (nome, CNPJ, site, e-mail ou telefone).',
							{ itemIndex: i },
						);
					}
					const body: IDataObject = { criterios };
					applyOpcoes(this, i, body);
					response = await econodataApiRequest.call(this, 'POST', '/v4/companies/match', body);
				} else if (operation === 'lookupBatch') {
					const cnpjs = toStringArray(this.getNodeParameter('cnpjs', i, '') as string);
					if (!cnpjs) {
						throw new NodeOperationError(this.getNode(), 'Informe ao menos um CNPJ.', {
							itemIndex: i,
						});
					}
					const body: IDataObject = { cnpjs };
					applyOpcoes(this, i, body);
					response = await econodataApiRequest.call(this, 'POST', '/v4/companies', body);
				} else if (operation === 'people') {
					const cnpj = onlyDigits(this.getNodeParameter('cnpjEmpresa', i) as string);
					const opts = this.getNodeParameter('opcoesPessoas', i, {}) as IDataObject;
					const qs: IDataObject = {};
					if (opts.papel) qs.papel = opts.papel;
					if (opts.pagina) qs.pagina = opts.pagina;
					if (opts.tamanho) qs.tamanho = opts.tamanho;
					response = await econodataApiRequest.call(
						this,
						'GET',
						`/v4/companies/${cnpj}/people`,
						{},
						qs,
					);
				} else if (operation === 'searchList' || operation === 'searchListById') {
					const body: IDataObject = {};
					if (operation === 'searchList') {
						body.filtros = parseFiltros(this.getNode(), this.getNodeParameter('filtros', i));
					} else {
						body.nome = (this.getNodeParameter('nomePesquisa', i) as string).trim();
					}
					const paginacao = this.getNodeParameter('paginacao', i, {}) as IDataObject;
					const pagina: IDataObject = {};
					if (typeof paginacao.tamanho === 'number') pagina.tamanho = paginacao.tamanho;
					if (paginacao.cursor) pagina.cursor = paginacao.cursor;
					if (Object.keys(pagina).length > 0) body.pagina = pagina;
					applyOpcoes(this, i, body);
					const path =
						operation === 'searchList'
							? '/v4/companies/search_list'
							: '/v4/companies/search_list_by_id';
					response = await econodataApiRequest.call(this, 'POST', path, body);
				} else if (operation === 'calcList') {
					const body: IDataObject = { filtros: parseFiltros(this.getNode(), this.getNodeParameter('filtros', i)) };
					response = await econodataApiRequest.call(this, 'POST', '/v4/companies/calc_list', body);
				} else if (operation === 'calcListById') {
					const body: IDataObject = {
						nome: (this.getNodeParameter('nomePesquisa', i) as string).trim(),
					};
					response = await econodataApiRequest.call(
						this,
						'POST',
						'/v4/companies/calc_list_by_id',
						body,
					);
				} else if (operation === 'savedSearches') {
					response = await econodataApiRequest.call(
						this,
						'GET',
						'/v4/companies/saved_searches',
					);
				} else if (operation === 'economicGroup') {
					const body: IDataObject = {
						cnpj: (this.getNodeParameter('cnpjEmpresa', i) as string).trim(),
					};
					const opts = this.getNodeParameter('opcoesGrupo', i, {}) as IDataObject;
					if (opts.pagina) body.pagina = opts.pagina;
					if (opts.tamanho) body.tamanho = opts.tamanho;
					response = await econodataApiRequest.call(
						this,
						'POST',
						'/v4/companies/economic-group',
						body,
					);
				} else {
					throw new NodeOperationError(this.getNode(), `Operação não suportada: ${operation}`, {
						itemIndex: i,
					});
				}

				returnData.push({ json: response, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				if (error instanceof NodeApiError) {
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex: i });
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
