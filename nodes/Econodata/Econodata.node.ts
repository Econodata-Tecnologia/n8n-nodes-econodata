import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeListSearchResult,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { econodataApiRequest, parseFiltros, simplifyCompany, toStringArray } from './GenericFunctions';

const bucketOptions = [
	{ name: 'Advanced Contacts', value: 'contatosAvancados' },
	{ name: 'Basic Contacts', value: 'contatosBasicos' },
	{ name: 'Business Profile', value: 'perfilNegocio' },
	{ name: 'Registration Data', value: 'cadastro' },
	{ name: 'Strategic', value: 'estrategico' },
];

const opcoesEnriquecimentoValues = [
	{
		displayName: 'Data Groups to Include',
		name: 'incluir',
		type: 'multiOptions' as const,
		options: bucketOptions,
		default: [],
		description:
			'Data groups to return for each company: registration data (legal and trade name), strategic (size, revenue, technologies), business profile (industry, headquarters and branches, debts), basic contacts (phones and emails) and advanced contacts (verified phones, decision makers). With none selected, only the CNPJ is returned. Each group delivered uses tokens.',
	},
	{
		displayName: 'Fields',
		name: 'campos',
		type: 'string' as const,
		default: '',
		description:
			'Comma-separated list of specific fields to return, e.g. cadastro.razaoSocial, contatosBasicos.telefones. The data group of each field is included automatically.',
	},
	{
		displayName: 'Limit per List',
		name: 'limite',
		type: 'number' as const,
		default: 5,
		description:
			'Max number of items in each list of a company (phones, emails, partners). Use 0 to return all items, which uses more tokens.',
	},
];

const onlyDigits = (value: string): string => value.replace(/\D/g, '');

function buildCriterios(ctx: IExecuteFunctions, index: number, fields: string[]): IDataObject {
	const criterios: IDataObject = {};
	for (const field of fields) {
		const value = ctx.getNodeParameter(field, index, '') as string;
		if (typeof value === 'string' && value.trim() !== '') {
			criterios[field] = value.trim();
		}
	}
	return criterios;
}

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
		icon: {
			light: 'file:../../icons/econodata.svg',
			dark: 'file:../../icons/econodata.dark.svg',
		},
		group: ['transform'],
		version: [1, 2],
		defaultVersion: 2,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Enrich and segment Brazilian B2B companies with the Econodata API',
		defaults: { name: 'Econodata' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'econodataApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Account', value: 'account' },
					{ name: 'Company', value: 'company' },
				],
				default: 'company',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['company'] } },
				options: [
					{
						name: 'Count by Filters',
						value: 'calcList',
						action: 'Count companies by filters',
						description: 'Get only the number of companies that match the filters',
					},
					{
						name: 'Count by Saved Search',
						value: 'calcListById',
						action: 'Count companies in a saved search',
						description: 'Get only the number of companies in a saved search',
					},
					{
						name: 'Enrich Many',
						value: 'lookupBatch',
						action: 'Enrich many companies',
						description: 'Enrich up to 100 companies by CNPJ at once',
					},
					{
						name: 'Find',
						value: 'search',
						action: 'Find company',
						description: 'Find and enrich one company by CNPJ, website or email',
					},
					{
						name: 'Get Economic Group',
						value: 'economicGroup',
						action: 'Get economic group of company',
						description: 'Get the companies linked to a company through shared partners',
					},
					{
						name: 'Get Many by Filters',
						value: 'searchList',
						action: 'Get many companies by filters',
						description: 'Get a page of companies that match the filters',
					},
					{
						name: 'Get Many by Saved Search',
						value: 'searchListById',
						action: 'Get many companies from a saved search',
						description: 'Get a page of companies from a saved search',
					},
					{
						name: 'Get People',
						value: 'people',
						action: 'Get people of company',
						description: 'Get the decision makers or employees of a company',
					},
					{
						name: 'Get Saved Searches',
						value: 'savedSearches',
						action: 'Get saved searches of account',
						description: 'Get the saved searches shared with the account. Free of charge.',
					},
					{
						name: 'Match by Name',
						value: 'match',
						action: 'Match company by name',
						description: 'Find the company that best matches a name and other details, with a score',
					},
				],
				default: 'search',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['account'] } },
				options: [
					{
						name: 'Get Balance',
						value: 'balance',
						action: 'Get token balance',
						description: 'Get the token balance of the account. Free of charge.',
					},
				],
				default: 'balance',
			},
			{
				displayName: 'CNPJ',
				name: 'cnpj',
				type: 'string',
				default: '',
				displayOptions: {
					show: { resource: ['company'], operation: ['search', 'match'] },
				},
				description: 'Brazilian company ID (CNPJ), with or without punctuation',
			},
			{
				displayName: 'Website',
				name: 'site',
				type: 'string',
				default: '',
				displayOptions: {
					show: { resource: ['company'], operation: ['search', 'match'] },
				},
				placeholder: 'e.g. econodata.com.br',
				description: 'Website or domain of the company',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'e.g. name@example.com',
				default: '',
				displayOptions: {
					show: { resource: ['company'], operation: ['search', 'match'] },
				},
				description: 'Email address of the company. Its domain is used to find the company.',
			},
			{
				displayName: 'CNPJ Root',
				name: 'raizCnpj',
				type: 'string',
				default: '',
				displayOptions: {
					show: { resource: ['company'], operation: ['search'] },
				},
				description: 'First 8 digits of the CNPJ, shared by the headquarters and its branches',
			},
			{
				displayName: 'Scope',
				name: 'escopo',
				type: 'options',
				options: [
					{ name: 'Branches', value: 'filiais' },
					{ name: 'Headquarters and Branches', value: 'matrizFiliais' },
					{ name: 'Single Unit', value: 'unidade' },
				],
				default: 'unidade',
				displayOptions: {
					show: { resource: ['company'], operation: ['search'] },
				},
				description:
					'Whether to return only the unit found, its branches, or the headquarters and all branches with the same CNPJ root',
			},
			{
				displayName: 'Company Name',
				name: 'nomeEmpresa',
				type: 'string',
				default: '',
				displayOptions: {
					show: { resource: ['company'], operation: ['match'] },
				},
				description: 'Legal or trade name of the company',
			},
			{
				displayName: 'State',
				name: 'uf',
				type: 'string',
				default: '',
				displayOptions: {
					show: { resource: ['company'], operation: ['match'] },
				},
				placeholder: 'e.g. SP',
				description: 'Brazilian state code (2 letters) to tell similar names apart',
			},
			{
				displayName: 'Phone',
				name: 'telefone',
				type: 'string',
				default: '',
				displayOptions: {
					show: { resource: ['company'], operation: ['match'] },
				},
				description: 'Phone number of the company, in any format',
			},
			{
				displayName: 'CNPJs',
				name: 'cnpjs',
				type: 'string',
				default: '',
				required: true,
				typeOptions: { rows: 3 },
				displayOptions: {
					show: { resource: ['company'], operation: ['lookupBatch'] },
				},
				description: 'Up to 100 CNPJs, separated by commas or line breaks',
			},
			{
				displayName: 'CNPJ',
				name: 'cnpjEmpresa',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['company'],
						operation: ['people', 'economicGroup'],
					},
				},
				description: 'CNPJ of the company, with or without punctuation',
			},
			{
				displayName: 'Saved Search Name',
				name: 'nomePesquisa',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						'@version': [1],
						resource: ['company'],
						operation: ['searchListById', 'calcListById'],
					},
				},
				description: "Exact name of the saved search. Use the 'Get Saved Searches' operation to see the names.",
			},
			{
				displayName: 'Saved Search',
				name: 'pesquisaSalva',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				displayOptions: {
					show: {
						'@version': [2],
						resource: ['company'],
						operation: ['searchListById', 'calcListById'],
					},
				},
				description: 'Saved search of the account to use',
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						placeholder: 'Select a saved search...',
						typeOptions: {
							searchListMethod: 'getSavedSearches',
							searchable: true,
						},
					},
					{
						displayName: 'By Name',
						name: 'name',
						type: 'string',
						placeholder: 'e.g. Software companies in SP',
					},
				],
			},
			{
				displayName: 'Filters (JSON)',
				name: 'filtros',
				type: 'json',
				default: '={}',
				required: true,
				displayOptions: {
					show: {
						resource: ['company'],
						operation: ['searchList', 'calcList'],
					},
				},
				description: 'Filters for the segment, e.g. {"uf":["SP"],"porte":["MEDIO"],"cnaePrimario":["6201-5/01"]}',
			},
			{
				displayName: 'Options',
				name: 'opcoes',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: {
					show: {
						resource: ['company'],
						operation: ['search', 'match', 'lookupBatch', 'searchList', 'searchListById'],
					},
				},
				options: opcoesEnriquecimentoValues,
			},
			{
				displayName: 'Role',
				name: 'papel',
				type: 'options',
				options: [
					{ name: 'Decision Makers', value: 'decisores' },
					{ name: 'Employees', value: 'colaboradores' },
				],
				default: 'decisores',
				displayOptions: {
					show: {
						'@version': [2],
						resource: ['company'],
						operation: ['people'],
					},
				},
				description: 'Which people to return',
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						'@version': [2],
						resource: ['company'],
						operation: ['searchList', 'searchListById', 'people', 'economicGroup'],
					},
				},
				description: 'Whether to return all results or only up to a given limit',
				hint: 'Every page of results uses tokens. Use a Count operation first to see the size of a segment.',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				displayOptions: {
					show: {
						'@version': [2],
						resource: ['company'],
						operation: ['searchList', 'searchListById', 'people', 'economicGroup'],
						returnAll: [false],
					},
				},
				description: 'Max number of results to return',
			},
			{
				displayName: 'Simplify',
				name: 'simplify',
				type: 'boolean',
				default: true,
				displayOptions: {
					show: {
						'@version': [2],
						resource: ['company'],
						operation: ['search', 'match', 'lookupBatch', 'searchList', 'searchListById'],
					},
				},
				description:
					'Whether to return a simplified version of the response instead of the raw data. It only trims the output: the data groups requested are still charged.',
			},
			{
				displayName: 'Pagination',
				name: 'paginacao',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: {
					show: {
						'@version': [1],
						resource: ['company'],
						operation: ['searchList', 'searchListById'],
					},
				},
				options: [
					{
						displayName: 'Cursor',
						name: 'cursor',
						type: 'string',
						default: '',
						description: 'Value of cursorProximo from the previous page. Leave empty to get the first page.',
					},
					{
						displayName: 'Page Size',
						name: 'tamanho',
						type: 'number',
						default: 50,
						description: 'Number of items per page, from 1 to 200',
					},
				],
			},
			{
				displayName: 'Options',
				name: 'opcoesPessoas',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: {
					show: {
						'@version': [1],
						resource: ['company'],
						operation: ['people'],
					},
				},
				options: [
					{
						displayName: 'Page',
						name: 'pagina',
						type: 'number',
						default: 1,
						description: 'Page number, starting at 1',
					},
					{
						displayName: 'Role',
						name: 'papel',
						type: 'options',
						options: [
							{ name: 'Decision Makers', value: 'decisores' },
							{ name: 'Employees', value: 'colaboradores' },
						],
						default: 'decisores',
						description: 'Which people to return',
					},
					{
						displayName: 'Page Size',
						name: 'tamanho',
						type: 'number',
						default: 50,
						description: 'Number of items per page, from 1 to 200',
					},
				],
			},
			{
				displayName: 'Options',
				name: 'opcoesGrupo',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: {
					show: {
						'@version': [1],
						resource: ['company'],
						operation: ['economicGroup'],
					},
				},
				options: [
					{
						displayName: 'Page',
						name: 'pagina',
						type: 'number',
						default: 1,
						description: 'Page number, starting at 1',
					},
					{
						displayName: 'Page Size',
						name: 'tamanho',
						type: 'number',
						default: 20,
						description: 'Number of items per page, from 1 to 100',
					},
				],
			},
		],
	};

	methods = {
		listSearch: {
			async getSavedSearches(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
				const response = await econodataApiRequest.call(this, 'GET', '/v4/companies/saved_searches');
				const termo = (filter ?? '').trim().toLowerCase();
				const results = ((response.pesquisasSalvas ?? []) as IDataObject[])
					.map((pesquisa) => String(pesquisa.nome ?? ''))
					.filter((nome) => nome !== '' && nome.toLowerCase().includes(termo))
					.map((nome) => ({ name: nome, value: nome }));
				return { results };
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const v2 = this.getNode().typeVersion >= 2;

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const results = v2
					? await executeV2.call(this, resource, operation, i)
					: [await executeV1.call(this, resource, operation, i)];
				for (const json of results) {
					returnData.push({ json, pairedItem: { item: i } });
				}
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
				throw new NodeOperationError(this.getNode(), error as Error, {
					itemIndex: i,
				});
			}
		}

		return [returnData];
	}
}

function searchCriterios(ctx: IExecuteFunctions, i: number): IDataObject {
	const criterios = buildCriterios(ctx, i, ['cnpj', 'site', 'email', 'raizCnpj']);
	if (Object.keys(criterios).length === 0) {
		throw new NodeOperationError(ctx.getNode(), 'Enter at least one identifier: CNPJ, website, email or CNPJ root', {
			itemIndex: i,
		});
	}
	const body: IDataObject = { criterios };
	const escopo = ctx.getNodeParameter('escopo', i, 'unidade') as string;
	if (escopo && escopo !== 'unidade') {
		body.escopo = escopo;
	}
	applyOpcoes(ctx, i, body);
	return body;
}

function matchBody(ctx: IExecuteFunctions, i: number): IDataObject {
	const criterios = buildCriterios(ctx, i, ['cnpj', 'site', 'email', 'uf', 'telefone']);
	const nome = (ctx.getNodeParameter('nomeEmpresa', i, '') as string).trim();
	if (nome !== '') {
		criterios.nome = nome;
	}
	if (Object.keys(criterios).length === 0) {
		throw new NodeOperationError(
			ctx.getNode(),
			'Enter at least one detail to match: company name, CNPJ, website, email or phone',
			{ itemIndex: i },
		);
	}
	const body: IDataObject = { criterios };
	applyOpcoes(ctx, i, body);
	return body;
}

function batchBody(ctx: IExecuteFunctions, i: number): IDataObject {
	const cnpjs = toStringArray(ctx.getNodeParameter('cnpjs', i, '') as string);
	if (!cnpjs) {
		throw new NodeOperationError(ctx.getNode(), 'Enter at least one CNPJ', {
			itemIndex: i,
		});
	}
	const body: IDataObject = { cnpjs };
	applyOpcoes(ctx, i, body);
	return body;
}

function savedSearchName(ctx: IExecuteFunctions, i: number, v2: boolean): string {
	const nome = v2
		? (ctx.getNodeParameter('pesquisaSalva', i, '', {
				extractValue: true,
			}) as string)
		: (ctx.getNodeParameter('nomePesquisa', i) as string);
	return String(nome ?? '').trim();
}

async function executeV1(
	this: IExecuteFunctions,
	resource: string,
	operation: string,
	i: number,
): Promise<IDataObject> {
	if (resource === 'account') {
		return await econodataApiRequest.call(this, 'GET', '/v4/account/balance');
	}
	if (operation === 'search') {
		return await econodataApiRequest.call(this, 'POST', '/v4/companies/search', searchCriterios(this, i));
	}
	if (operation === 'match') {
		return await econodataApiRequest.call(this, 'POST', '/v4/companies/match', matchBody(this, i));
	}
	if (operation === 'lookupBatch') {
		return await econodataApiRequest.call(this, 'POST', '/v4/companies', batchBody(this, i));
	}
	if (operation === 'people') {
		const cnpj = onlyDigits(this.getNodeParameter('cnpjEmpresa', i) as string);
		const opts = this.getNodeParameter('opcoesPessoas', i, {}) as IDataObject;
		const qs: IDataObject = {};
		if (opts.papel) qs.papel = opts.papel;
		if (opts.pagina) qs.pagina = opts.pagina;
		if (opts.tamanho) qs.tamanho = opts.tamanho;
		return await econodataApiRequest.call(this, 'GET', `/v4/companies/${cnpj}/people`, {}, qs);
	}
	if (operation === 'searchList' || operation === 'searchListById') {
		const body: IDataObject = {};
		if (operation === 'searchList') {
			body.filtros = parseFiltros(this.getNode(), this.getNodeParameter('filtros', i));
		} else {
			body.nome = savedSearchName(this, i, false);
		}
		const paginacao = this.getNodeParameter('paginacao', i, {}) as IDataObject;
		const pagina: IDataObject = {};
		if (typeof paginacao.tamanho === 'number') pagina.tamanho = paginacao.tamanho;
		if (paginacao.cursor) pagina.cursor = paginacao.cursor;
		if (Object.keys(pagina).length > 0) body.pagina = pagina;
		applyOpcoes(this, i, body);
		const path = operation === 'searchList' ? '/v4/companies/search_list' : '/v4/companies/search_list_by_id';
		return await econodataApiRequest.call(this, 'POST', path, body);
	}
	if (operation === 'calcList') {
		const body: IDataObject = {
			filtros: parseFiltros(this.getNode(), this.getNodeParameter('filtros', i)),
		};
		return await econodataApiRequest.call(this, 'POST', '/v4/companies/calc_list', body);
	}
	if (operation === 'calcListById') {
		const body: IDataObject = { nome: savedSearchName(this, i, false) };
		return await econodataApiRequest.call(this, 'POST', '/v4/companies/calc_list_by_id', body);
	}
	if (operation === 'savedSearches') {
		return await econodataApiRequest.call(this, 'GET', '/v4/companies/saved_searches');
	}
	if (operation === 'economicGroup') {
		const body: IDataObject = {
			cnpj: (this.getNodeParameter('cnpjEmpresa', i) as string).trim(),
		};
		const opts = this.getNodeParameter('opcoesGrupo', i, {}) as IDataObject;
		if (opts.pagina) body.pagina = opts.pagina;
		if (opts.tamanho) body.tamanho = opts.tamanho;
		return await econodataApiRequest.call(this, 'POST', '/v4/companies/economic-group', body);
	}
	throw new NodeOperationError(this.getNode(), `The operation "${operation}" is not supported`, {
		itemIndex: i,
	});
}

function listOf(response: IDataObject, key: string): IDataObject[] {
	return Array.isArray(response[key]) ? (response[key] as IDataObject[]) : [];
}

function limitOf(ctx: IExecuteFunctions, i: number): number {
	return ctx.getNodeParameter('returnAll', i, false) ? Infinity : (ctx.getNodeParameter('limit', i, 50) as number);
}

async function executeV2(
	this: IExecuteFunctions,
	resource: string,
	operation: string,
	i: number,
): Promise<IDataObject[]> {
	const simplify = (empresas: IDataObject[]): IDataObject[] =>
		this.getNodeParameter('simplify', i, true) ? empresas.map(simplifyCompany) : empresas;

	if (resource === 'account') {
		return [await econodataApiRequest.call(this, 'GET', '/v4/account/balance')];
	}
	if (operation === 'search') {
		const response = await econodataApiRequest.call(this, 'POST', '/v4/companies/search', searchCriterios(this, i));
		return response.empresa ? simplify([response.empresa as IDataObject]) : [];
	}
	if (operation === 'match') {
		const response = await econodataApiRequest.call(this, 'POST', '/v4/companies/match', matchBody(this, i));
		const correspondencias = listOf(response, 'correspondencias');
		if (!this.getNodeParameter('simplify', i, true)) return correspondencias;
		return correspondencias.map((c) => ({
			confianca: c.confianca,
			...simplifyCompany({
				...((c.empresa ?? {}) as IDataObject),
				cnpj: c.cnpj,
				razaoSocial: c.razaoSocial,
				nomeFantasia: c.nomeFantasia,
			}),
		}));
	}
	if (operation === 'lookupBatch') {
		const response = await econodataApiRequest.call(this, 'POST', '/v4/companies', batchBody(this, i));
		return [...simplify(listOf(response, 'empresas')), ...listOf(response, 'erros')];
	}
	if (operation === 'searchList' || operation === 'searchListById') {
		const base: IDataObject = {};
		if (operation === 'searchList') {
			base.filtros = parseFiltros(this.getNode(), this.getNodeParameter('filtros', i));
		} else {
			base.nome = savedSearchName(this, i, true);
		}
		applyOpcoes(this, i, base);
		const path = operation === 'searchList' ? '/v4/companies/search_list' : '/v4/companies/search_list_by_id';
		const limit = limitOf(this, i);
		const empresas: IDataObject[] = [];
		let cursor: string | undefined;
		do {
			const pagina: IDataObject = {
				tamanho: Math.min(200, limit - empresas.length),
			};
			if (cursor) pagina.cursor = cursor;
			const response = await econodataApiRequest.call(this, 'POST', path, {
				...base,
				pagina,
			});
			const resultados = listOf(response, 'resultados');
			empresas.push(...resultados);
			cursor = ((response.pagina ?? {}) as IDataObject).cursorProximo as string | undefined;
			if (resultados.length === 0) break;
		} while (cursor && empresas.length < limit);
		return simplify(empresas.slice(0, limit));
	}
	if (operation === 'people') {
		const cnpj = onlyDigits(this.getNodeParameter('cnpjEmpresa', i) as string);
		const papel = this.getNodeParameter('papel', i, 'decisores') as string;
		const limit = limitOf(this, i);
		const pessoas: IDataObject[] = [];
		let pagina = 1;
		let totalPaginas = 1;
		do {
			const qs: IDataObject = {
				papel,
				pagina,
				tamanho: Math.min(200, limit - pessoas.length),
			};
			const response = await econodataApiRequest.call(this, 'GET', `/v4/companies/${cnpj}/people`, {}, qs);
			const itens = listOf(response, 'itens');
			pessoas.push(...itens);
			totalPaginas = Number(response.totalPaginas ?? 1);
			pagina++;
			if (itens.length === 0) break;
		} while (pagina <= totalPaginas && pessoas.length < limit);
		return pessoas.slice(0, limit);
	}
	if (operation === 'economicGroup') {
		const cnpj = (this.getNodeParameter('cnpjEmpresa', i) as string).trim();
		const limit = limitOf(this, i);
		const empresas: IDataObject[] = [];
		let pagina = 1;
		let temMais = false;
		do {
			const body: IDataObject = {
				cnpj,
				pagina,
				tamanho: Math.min(100, limit - empresas.length),
			};
			const response = await econodataApiRequest.call(this, 'POST', '/v4/companies/economic-group', body);
			const lista = listOf(response, 'empresas');
			empresas.push(...lista);
			temMais = response.temMais === true;
			pagina++;
			if (lista.length === 0) break;
		} while (temMais && empresas.length < limit);
		return empresas.slice(0, limit);
	}
	if (operation === 'savedSearches') {
		const response = await econodataApiRequest.call(this, 'GET', '/v4/companies/saved_searches');
		return listOf(response, 'pesquisasSalvas');
	}
	if (operation === 'calcListById') {
		const body: IDataObject = { nome: savedSearchName(this, i, true) };
		return [await econodataApiRequest.call(this, 'POST', '/v4/companies/calc_list_by_id', body)];
	}
	return [await executeV1.call(this, resource, operation, i)];
}
