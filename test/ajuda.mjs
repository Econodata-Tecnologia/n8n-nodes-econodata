import { createRequire } from 'node:module';

export const exigir = createRequire(import.meta.url);

export const NO = {
	id: '1',
	name: 'Econodata',
	type: 'n8n-nodes-econodata.econodata',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

export function contexto({ capturadas = [], parametros = {}, falha, continuarSeFalhar = false } = {}) {
	return {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (nome, _i, padrao) => {
			if (typeof parametros === 'function') return parametros(nome, padrao);
			return nome in parametros ? parametros[nome] : padrao;
		},
		getNode: () => NO,
		continueOnFail: () => continuarSeFalhar,
		getCredentials: async () => ({ apiKey: 'ek_live_teste', baseUrl: 'https://hmlapi.econodata.com.br/' }),
		helpers: {
			httpRequestWithAuthentication: async (_credencial, options) => {
				capturadas.push(options);
				if (falha) throw falha;
				return {};
			},
		},
	};
}
