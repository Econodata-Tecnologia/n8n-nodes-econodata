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
				displayOptions: { show: { resource: ['company'], operation: ['search', 'match'] } },
				description: 'Brazilian company ID (CNPJ), with or without punctuation',
			},
			{
				displayName: 'Website',
				name: 'site',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['company'], operation: ['search', 'match'] } },
				placeholder: 'e.g. econodata.com.br',
				description: 'Website or domain of the company',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'e.g. name@example.com',
				default: '',
				displayOptions: { show: { resource: ['company'], operation: ['search', 'match'] } },
				description: 'Email address of the company. Its domain is used to find the company.',
			},
			{
				displayName: 'CNPJ Root',
				name: 'raizCnpj',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['company'], operation: ['search'] } },
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
				displayOptions: { show: { resource: ['company'], operation: ['search'] } },
				description: 'Whether to return only the unit found, its branches, or the headquarters and all branches with the same CNPJ root',
			},
			{
				displayName: 'Company Name',
				name: 'nomeEmpresa',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['company'], operation: ['match'] } },
				description: 'Legal or trade name of the company',
			},
			{
				displayName: 'State',
				name: 'uf',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['company'], operation: ['match'] } },
				placeholder: 'e.g. SP',
				description: 'Brazilian state code (2 letters) to tell similar names apart',
			},
			{
				displayName: 'Phone',
				name: 'telefone',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['company'], operation: ['match'] } },
				description: 'Phone number of the company, in any format',
			},
			{
				displayName: 'CNPJs',
				name: 'cnpjs',
				type: 'string',
				default: '',
				required: true,
				typeOptions: { rows: 3 },
				displayOptions: { show: { resource: ['company'], operation: ['lookupBatch'] } },
				description: 'Up to 100 CNPJs, separated by commas or line breaks',
			},
			{
				displayName: 'CNPJ',
				name: 'cnpjEmpresa',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['company'], operation: ['people', 'economicGroup'] } },
				description: 'CNPJ of the company, with or without punctuation',
			},
			{
				displayName: 'Saved Search Name',
				name: 'nomePesquisa',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: { resource: ['company'], operation: ['searchListById', 'calcListById'] },
				},
				description: "Exact name of the saved search. Use the 'Get Saved Searches' operation to see the names.",
			},
			{
				displayName: 'Filters (JSON)',
				name: 'filtros',
				type: 'json',
				default: '={}',
				required: true,
				displayOptions: { show: { resource: ['company'], operation: ['searchList', 'calcList'] } },
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
				displayName: 'Pagination',
				name: 'paginacao',
				type: 'collection',
				placeholder: 'Add Option',
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
				displayOptions: { show: { resource: ['company'], operation: ['people'] } },
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
				displayOptions: { show: { resource: ['company'], operation: ['economicGroup'] } },
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

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				let response: IDataObject;

				if (resource === 'account') {
					response = await econodataApiRequest.call(this, 'GET', '/v4/account/balance');
				} else if (operation === 'search') {
					const criterios = buildCriterios(this, i, ['cnpj', 'site', 'email', 'raizCnpj']);
					if (Object.keys(criterios).length === 0) {
						throw new NodeOperationError(
							this.getNode(),
							'Enter at least one identifier: CNPJ, website, email or CNPJ root',
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
							'Enter at least one detail to match: company name, CNPJ, website, email or phone',
							{ itemIndex: i },
						);
					}
					const body: IDataObject = { criterios };
					applyOpcoes(this, i, body);
					response = await econodataApiRequest.call(this, 'POST', '/v4/companies/match', body);
				} else if (operation === 'lookupBatch') {
					const cnpjs = toStringArray(this.getNodeParameter('cnpjs', i, '') as string);
					if (!cnpjs) {
						throw new NodeOperationError(this.getNode(), 'Enter at least one CNPJ', {
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
					throw new NodeOperationError(this.getNode(), `The operation "${operation}" is not supported`, {
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
