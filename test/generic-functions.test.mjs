import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { contexto, exigir, NO } from './ajuda.mjs';

const { econodataApiRequest, parseFiltros, USER_AGENT } = exigir('../dist/nodes/Econodata/GenericFunctions.js');
const { NodeApiError, NodeOperationError } = exigir('n8n-workflow');
const { version } = exigir('../package.json');

describe('econodataApiRequest', () => {
	it('identifica a chamada como econodata-n8n/<versão do pacote>', async () => {
		const capturadas = [];
		await econodataApiRequest.call(contexto({ capturadas }), 'GET', '/v4/account/balance');

		assert.equal(USER_AGENT, `econodata-n8n/${version}`);
		assert.equal(capturadas[0].headers['User-Agent'], USER_AGENT);
	});

	it('mantém url, body e qs da chamada', async () => {
		const capturadas = [];
		await econodataApiRequest.call(
			contexto({ capturadas }),
			'POST',
			'/v4/companies/search',
			{ cnpj: '47960950000121' },
			{ pagina: 2 },
		);

		assert.equal(capturadas[0].url, 'https://hmlapi.econodata.com.br/v4/companies/search');
		assert.deepEqual(capturadas[0].body, { cnpj: '47960950000121' });
		assert.deepEqual(capturadas[0].qs, { pagina: 2 });
		assert.equal(capturadas[0].json, true);
	});

	it('não envia body nem qs vazios', async () => {
		const capturadas = [];
		await econodataApiRequest.call(contexto({ capturadas }), 'GET', '/v4/account/balance');

		assert.equal(capturadas[0].body, undefined);
		assert.equal(capturadas[0].qs, undefined);
	});

	it('erro HTTP vira NodeApiError com o status e a dica do status', async () => {
		const falha = Object.assign(new Error('Unauthorized'), { httpCode: '401' });

		await assert.rejects(
			econodataApiRequest.call(contexto({ falha }), 'GET', '/v4/account/balance'),
			(erro) => {
				assert.ok(erro instanceof NodeApiError);
				assert.equal(erro.httpCode, '401');
				assert.match(erro.message, /Credencial inválida ou revogada/);
				return true;
			},
		);
	});
});

describe('parseFiltros', () => {
	it('aceita objeto e string JSON', () => {
		assert.deepEqual(parseFiltros(NO, { uf: ['SP'] }), { uf: ['SP'] });
		assert.deepEqual(parseFiltros(NO, '{"porte":["MEDIO"]}'), { porte: ['MEDIO'] });
	});

	it('JSON inválido vira NodeOperationError com o exemplo de formato', () => {
		assert.throws(
			() => parseFiltros(NO, '{uf:'),
			(erro) => erro instanceof NodeOperationError && erro.message.startsWith('Filtros: JSON inválido.'),
		);
	});

	it('filtro vazio vira NodeOperationError', () => {
		assert.throws(
			() => parseFiltros(NO, '  '),
			(erro) =>
				erro instanceof NodeOperationError &&
				erro.message === 'Filtros são obrigatórios na segmentação por filtros diretos.',
		);
	});
});
