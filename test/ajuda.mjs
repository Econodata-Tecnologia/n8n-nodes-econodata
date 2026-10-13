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

export function contexto({
	capturadas = [],
	parametros = {},
	falha,
	continuarSeFalhar = false,
	versao = 1,
	respostas = () => ({}),
} = {}) {
	return {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (nome, _i, padrao, opcoes) => {
			const valor =
				typeof parametros === 'function' ? parametros(nome, padrao) : nome in parametros ? parametros[nome] : padrao;
			if (opcoes?.extractValue && valor && typeof valor === 'object') return valor.value;
			return valor;
		},
		getNode: () => ({ ...NO, typeVersion: versao }),
		continueOnFail: () => continuarSeFalhar,
		getCredentials: async () => ({ apiKey: 'ek_live_teste', baseUrl: 'https://hmlapi.econodata.com.br/' }),
		helpers: {
			httpRequestWithAuthentication: async (_credencial, options) => {
				capturadas.push(options);
				if (falha) throw falha;
				return respostas(options, capturadas.length);
			},
		},
	};
}
