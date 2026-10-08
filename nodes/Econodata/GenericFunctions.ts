import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	INode,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { version } from '../../package.json';

export const USER_AGENT = `econodata-n8n/${version}`;

function statusHint(status?: number): string | undefined {
	switch (status) {
		case 401:
			return 'Credencial inválida ou revogada — reveja a API key (ek_live_…) na credencial Econodata.';
		case 402:
			return 'Saldo de tokens insuficiente — recarregue ou reduza os campos pedidos (incluir/campos).';
		case 403:
			return 'A chave não tem escopo para esta operação — use uma chave de integração (somente leitura).';
		case 422:
			return 'Dado de entrada inválido — confira os identificadores/filtros enviados.';
		case 429:
			return 'Limite de requisições excedido — aguarde e repita (o cabeçalho Retry-After indica os segundos).';
		case 503:
			return 'Fonte de dados temporariamente indisponível — repita com backoff.';
		default:
			return undefined;
	}
}

/**
 * Chamada à API pública v4 da Econodata usando a credencial `econodataApi`
 * (Authorization: Bearer + baseUrl). Envia/recebe JSON; erros HTTP viram NodeApiError
 * com um hint por status.
 */
export async function econodataApiRequest(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	resource: string,
	body: IDataObject = {},
	qs: IDataObject = {},
): Promise<IDataObject> {
	const credentials = await this.getCredentials('econodataApi');
	const baseUrl = String(credentials.baseUrl ?? 'https://api.econodata.com.br').replace(/\/+$/, '');

	const options: IHttpRequestOptions = {
		method,
		url: `${baseUrl}${resource}`,
		headers: { 'User-Agent': USER_AGENT },
		json: true,
	};
	if (Object.keys(body).length > 0) {
		options.body = body;
	}
	if (Object.keys(qs).length > 0) {
		options.qs = qs;
	}

	try {
		return (await this.helpers.httpRequestWithAuthentication.call(
			this,
			'econodataApi',
			options,
		)) as IDataObject;
	} catch (error) {
		const raw = error as { httpCode?: string | number; response?: { statusCode?: number } };
		const status = Number(raw.httpCode ?? raw.response?.statusCode ?? NaN);
		const hint = statusHint(Number.isNaN(status) ? undefined : status);
		throw new NodeApiError(this.getNode(), error as JsonObject, hint ? { message: hint } : {});
	}
}

/**
 * Normaliza uma entrada de lista: array → limpa; string "a, b\nc" → split por vírgula/quebra.
 * Vazio → `undefined` (para não enviar a chave no corpo).
 */
export function toStringArray(value: unknown): string[] | undefined {
	let arr: string[] = [];
	if (Array.isArray(value)) {
		arr = value.map((v) => String(v).trim());
	} else if (typeof value === 'string' && value.trim() !== '') {
		arr = value.split(/[,\n]/).map((s) => s.trim());
	}
	const clean = arr.filter((s) => s !== '');
	return clean.length > 0 ? clean : undefined;
}

/**
 * Faz o parse de um campo de filtros (JSON) do `search_list`/`calc_list`. Aceita objeto
 * (quando vem por expressão n8n) ou string JSON. Objeto vazio/ inválido → erro claro.
 */
export function parseFiltros(node: INode, value: unknown): IDataObject {
	if (value && typeof value === 'object') {
		return value as IDataObject;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		try {
			return JSON.parse(value) as IDataObject;
		} catch {
			throw new NodeOperationError(node, "Filtros: JSON inválido. Ex.: {\"uf\":[\"SP\"],\"porte\":[\"MEDIO\"]}");
		}
	}
	throw new NodeOperationError(node, 'Filtros são obrigatórios na segmentação por filtros diretos.');
}
