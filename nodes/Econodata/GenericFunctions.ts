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
			return 'The API key was rejected. Check that the key in the Econodata credential (ek_live_...) is correct and still active.';
		case 402:
			return 'The account does not have enough tokens. Top up the balance or request fewer data groups or fields.';
		case 403:
			return 'This API key cannot run this operation. Use an integration key (read-only) created in Econodata.';
		case 422:
			return 'Some input values are not valid. Check the identifiers or filters sent.';
		case 429:
			return 'Too many requests in a short time. Wait and try again; the Retry-After header shows how many seconds.';
		case 503:
			return 'The data source is temporarily unavailable. Try again in a few moments.';
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
			throw new NodeOperationError(node, 'Filters must be valid JSON, e.g. {"uf":["SP"],"porte":["MEDIO"]}');
		}
	}
	throw new NodeOperationError(node, 'Enter the filters to get companies by filters');
}
