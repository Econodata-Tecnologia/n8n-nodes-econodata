import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { contexto, exigir } from './ajuda.mjs';

const { Econodata } = exigir('../dist/nodes/Econodata/Econodata.node.js');
const { NodeApiError, NodeConnectionTypes, NodeOperationError } = exigir('n8n-workflow');

const SALDO = { resource: 'account', operation: 'balance' };

describe('nó Econodata', () => {
	it('declara entrada e saída principais, uso como tool e os ícones claro e escuro', () => {
		const { description } = new Econodata();

		assert.deepEqual(description.inputs, [NodeConnectionTypes.Main]);
		assert.deepEqual(description.outputs, [NodeConnectionTypes.Main]);
		assert.equal(description.usableAsTool, true);
		assert.deepEqual(description.icon, {
			light: 'file:../../icons/econodata.svg',
			dark: 'file:../../icons/econodata.dark.svg',
		});
	});

	it('erro da API sai como o mesmo NodeApiError, com o status', async () => {
		const falha = Object.assign(new Error('Payment Required'), { httpCode: '402' });

		await assert.rejects(new Econodata().execute.call(contexto({ parametros: SALDO, falha })), (erro) => {
			assert.ok(erro instanceof NodeApiError);
			assert.equal(erro.httpCode, '402');
			assert.match(erro.message, /Saldo de tokens insuficiente/);
			return true;
		});
	});

	it('outro erro sai como NodeOperationError com a mensagem original e o item', async () => {
		const parametros = () => {
			throw new Error('parâmetro ausente');
		};

		await assert.rejects(new Econodata().execute.call(contexto({ parametros })), (erro) => {
			assert.ok(erro instanceof NodeOperationError);
			assert.equal(erro.message, 'parâmetro ausente');
			assert.equal(erro.context.itemIndex, 0);
			return true;
		});
	});

	it('com "continuar se falhar", devolve a mensagem do erro no item', async () => {
		const falha = Object.assign(new Error('Payment Required'), { httpCode: '402' });
		const [saida] = await new Econodata().execute.call(
			contexto({ parametros: SALDO, falha, continuarSeFalhar: true }),
		);

		assert.equal(saida.length, 1);
		assert.match(saida[0].json.error, /Saldo de tokens insuficiente/);
		assert.deepEqual(saida[0].pairedItem, { item: 0 });
	});
});
