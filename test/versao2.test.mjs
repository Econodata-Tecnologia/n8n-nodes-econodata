import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { contexto, exigir } from './ajuda.mjs';

const { Econodata } = exigir('../dist/nodes/Econodata/Econodata.node.js');

const EMPRESA = {
	cnpj: '47960950000121',
	cadastro: {
		razaoSocial: 'Magazine Luiza S/A',
		nomeFantasia: 'Magalu',
		situacao: 'ATIVA',
		uf: 'SP',
		cidade: 'Franca',
		cnaePrimario: { codigo: '4753-9/00', descricao: 'Comércio varejista' },
		enquadramentoPorte: 'DEMAIS',
	},
	perfilNegocio: { porte: 'GRANDE' },
	contatosBasicos: {
		telefones: [{ numero: '1633333333' }, { numero: '1644444444' }],
		emailsPublicos: [{ email: 'contato@magalu.com' }],
	},
	estrategico: { faturamentoCnpj: { faixa: 'X' } },
};

const rodar = async (parametros, respostas, capturadas = []) => {
	const [saida] = await new Econodata().execute.call(contexto({ versao: 2, parametros, respostas, capturadas }));
	return saida;
};

describe('nó Econodata, versão 2', () => {
	it('declara as versões 1 e 2, com a 2 como padrão para nó novo', () => {
		const { description } = new Econodata();

		assert.deepEqual(description.version, [1, 2]);
		assert.equal(description.defaultVersion, 2);
	});

	it('Find com Simplify devolve a empresa resumida em no máximo 10 campos', async () => {
		const saida = await rodar({ resource: 'company', operation: 'search', cnpj: EMPRESA.cnpj, simplify: true }, () => ({
			empresa: EMPRESA,
		}));

		assert.equal(saida.length, 1);
		assert.deepEqual(saida[0].json, {
			cnpj: '47960950000121',
			razaoSocial: 'Magazine Luiza S/A',
			nomeFantasia: 'Magalu',
			situacao: 'ATIVA',
			uf: 'SP',
			cnaePrimario: '4753-9/00',
			porte: 'GRANDE',
			telefone: '1633333333',
			email: 'contato@magalu.com',
		});
		assert.ok(Object.keys(saida[0].json).length <= 10);
	});

	it('Simplify não pede grupo de dados a mais: sem grupo, sai só o CNPJ', async () => {
		const capturadas = [];
		const saida = await rodar(
			{ resource: 'company', operation: 'search', cnpj: EMPRESA.cnpj, simplify: true },
			() => ({ empresa: { cnpj: EMPRESA.cnpj } }),
			capturadas,
		);

		assert.equal(capturadas[0].body.incluir, undefined);
		assert.deepEqual(saida[0].json, { cnpj: EMPRESA.cnpj });
	});

	it('Find devolve a empresa inteira quando Simplify fica no padrão (desligado)', async () => {
		const saida = await rodar(
			{ resource: 'company', operation: 'search', cnpj: EMPRESA.cnpj },
			() => ({ empresa: EMPRESA }),
		);

		assert.deepEqual(saida[0].json, EMPRESA);
	});

	it('Match devolve um item por correspondência, com a confiança', async () => {
		const saida = await rodar({ resource: 'company', operation: 'match', nomeEmpresa: 'Magalu', simplify: true }, () => ({
			correspondencias: [
				{ cnpj: '1', confianca: 0.9, razaoSocial: 'A', empresa: {} },
				{ cnpj: '2', confianca: 0.5, razaoSocial: 'B', empresa: {} },
			],
		}));

		assert.deepEqual(
			saida.map((item) => item.json),
			[
				{ confianca: 0.9, cnpj: '1', razaoSocial: 'A' },
				{ confianca: 0.5, cnpj: '2', razaoSocial: 'B' },
			],
		);
	});

	it('Enrich Many devolve um item por empresa e um por CNPJ não encontrado, todos ligados ao item de entrada', async () => {
		const saida = await rodar(
			{ resource: 'company', operation: 'lookupBatch', cnpjs: '1, 2, 3', simplify: false },
			() => ({ empresas: [{ cnpj: '1' }, { cnpj: '2' }], erros: [{ cnpj: '3', motivo: 'not_found' }] }),
		);

		assert.deepEqual(
			saida.map((item) => item.json),
			[{ cnpj: '1' }, { cnpj: '2' }, { cnpj: '3', motivo: 'not_found' }],
		);
		assert.ok(saida.every((item) => item.pairedItem.item === 0));
	});

	it('Get Many com Limit pede só o que falta e para no limite', async () => {
		const capturadas = [];
		const saida = await rodar(
			{ resource: 'company', operation: 'searchList', filtros: { uf: ['SP'] }, limit: 3, simplify: false },
			() => ({ resultados: [{ cnpj: '1' }, { cnpj: '2' }, { cnpj: '3' }], pagina: { cursorProximo: 'c2' } }),
			capturadas,
		);

		assert.equal(capturadas.length, 1);
		assert.deepEqual(capturadas[0].body.pagina, { tamanho: 3 });
		assert.equal(saida.length, 3);
	});

	it('Get Many com Return All segue o cursor até a última página', async () => {
		const capturadas = [];
		const paginas = [
			{ resultados: [{ cnpj: '1' }, { cnpj: '2' }], pagina: { cursorProximo: 'c2' } },
			{ resultados: [{ cnpj: '3' }], pagina: { cursorProximo: null } },
		];
		const saida = await rodar(
			{ resource: 'company', operation: 'searchList', filtros: { uf: ['SP'] }, returnAll: true, simplify: false },
			(_opcoes, n) => paginas[n - 1],
			capturadas,
		);

		assert.deepEqual(
			capturadas.map((c) => c.body.pagina),
			[{ tamanho: 200 }, { tamanho: 200, cursor: 'c2' }],
		);
		assert.deepEqual(
			saida.map((item) => item.json.cnpj),
			['1', '2', '3'],
		);
	});

	it('Get Many by Saved Search manda o nome escolhido na lista', async () => {
		const capturadas = [];
		await rodar(
			{
				resource: 'company',
				operation: 'searchListById',
				pesquisaSalva: { __rl: true, mode: 'list', value: 'Software SP' },
				limit: 10,
			},
			() => ({ resultados: [] }),
			capturadas,
		);

		assert.equal(capturadas[0].url, 'https://hmlapi.econodata.com.br/v4/companies/search_list_by_id');
		assert.equal(capturadas[0].body.nome, 'Software SP');
	});

	it('Count by Saved Search usa a pesquisa da lista', async () => {
		const capturadas = [];
		const saida = await rodar(
			{ resource: 'company', operation: 'calcListById', pesquisaSalva: { mode: 'name', value: ' Software SP ' } },
			() => ({ totalRegistros: 42 }),
			capturadas,
		);

		assert.deepEqual(capturadas[0].body, { nome: 'Software SP' });
		assert.deepEqual(saida[0].json, { totalRegistros: 42 });
	});

	it('Get People pagina por número de página e devolve uma pessoa por item', async () => {
		const capturadas = [];
		const paginas = [
			{ itens: [{ nome: 'A' }, { nome: 'B' }], totalPaginas: 2 },
			{ itens: [{ nome: 'C' }], totalPaginas: 2 },
		];
		const saida = await rodar(
			{ resource: 'company', operation: 'people', cnpjEmpresa: '47.960.950/0001-21', returnAll: true },
			(_opcoes, n) => paginas[n - 1],
			capturadas,
		);

		assert.equal(capturadas[0].url, 'https://hmlapi.econodata.com.br/v4/companies/47960950000121/people');
		assert.deepEqual(
			capturadas.map((c) => c.qs),
			[
				{ papel: 'decisores', pagina: 1, tamanho: 200 },
				{ papel: 'decisores', pagina: 2, tamanho: 200 },
			],
		);
		assert.deepEqual(
			saida.map((item) => item.json.nome),
			['A', 'B', 'C'],
		);
	});

	it('Get Economic Group segue enquanto temMais e respeita o máximo de 100 por página', async () => {
		const capturadas = [];
		const paginas = [
			{ empresas: [{ cnpj: '1' }], temMais: true },
			{ empresas: [{ cnpj: '2' }], temMais: false },
		];
		const saida = await rodar(
			{ resource: 'company', operation: 'economicGroup', cnpjEmpresa: '47960950000121', returnAll: true },
			(_opcoes, n) => paginas[n - 1],
			capturadas,
		);

		assert.deepEqual(
			capturadas.map((c) => [c.body.pagina, c.body.tamanho]),
			[
				[1, 100],
				[2, 100],
			],
		);
		assert.equal(saida.length, 2);
	});

	it('Get People com Limit acima de uma página mantém o tamanho fixo, sem repetir nem pular pessoa', async () => {
		const capturadas = [];
		const pessoasDaPagina = (qs) =>
			Array.from({ length: qs.tamanho }, (_, n) => ({ nome: `P${(qs.pagina - 1) * qs.tamanho + n}` }));
		const saida = await rodar(
			{ resource: 'company', operation: 'people', cnpjEmpresa: '47960950000121', limit: 300 },
			(opcoes) => ({ itens: pessoasDaPagina(opcoes.qs), totalPaginas: 5 }),
			capturadas,
		);

		assert.deepEqual(
			capturadas.map((c) => c.qs.tamanho),
			[200, 200],
		);
		const nomes = saida.map((item) => item.json.nome);
		assert.equal(nomes.length, 300);
		assert.equal(new Set(nomes).size, 300);
		assert.equal(nomes[299], 'P299');
	});

	it('Get Economic Group com Limit acima de uma página mantém o tamanho em 100', async () => {
		const capturadas = [];
		const saida = await rodar(
			{ resource: 'company', operation: 'economicGroup', cnpjEmpresa: '47960950000121', limit: 150 },
			(opcoes) => ({
				empresas: Array.from({ length: opcoes.body.tamanho }, (_, n) => ({
					cnpj: String((opcoes.body.pagina - 1) * opcoes.body.tamanho + n),
				})),
				temMais: true,
			}),
			capturadas,
		);

		assert.deepEqual(
			capturadas.map((c) => c.body.tamanho),
			[100, 100],
		);
		assert.equal(new Set(saida.map((item) => item.json.cnpj)).size, 150);
	});

	it('pesquisa salva vazia vira erro claro, sem chamar a API', async () => {
		const capturadas = [];
		await assert.rejects(
			rodar(
				{ resource: 'company', operation: 'calcListById', pesquisaSalva: { mode: 'list', value: '' } },
				() => ({}),
				capturadas,
			),
			/Select a saved search/,
		);
		assert.equal(capturadas.length, 0);
	});

	it('Limit menor que 1 vira erro claro, sem chamar a API', async () => {
		const capturadas = [];
		await assert.rejects(
			rodar({ resource: 'company', operation: 'searchList', filtros: { uf: ['SP'] }, limit: 0 }, () => ({}), capturadas),
			/Limit must be 1 or more/,
		);
		assert.equal(capturadas.length, 0);
	});

	it('Get Saved Searches devolve uma pesquisa por item', async () => {
		const saida = await rodar({ resource: 'company', operation: 'savedSearches' }, () => ({
			pesquisasSalvas: [{ nome: 'A' }, { nome: 'B' }],
		}));

		assert.deepEqual(
			saida.map((item) => item.json.nome),
			['A', 'B'],
		);
	});

	it('lista de pesquisas salvas filtra pelo texto digitado, sem diferenciar maiúscula', async () => {
		const ctx = contexto({
			respostas: () => ({ pesquisasSalvas: [{ nome: 'Software SP' }, { nome: 'Varejo RJ' }, { nome: '' }] }),
		});
		const { results } = await new Econodata().methods.listSearch.getSavedSearches.call(ctx, 'soft');

		assert.deepEqual(results, [{ name: 'Software SP', value: 'Software SP' }]);
	});
});

describe('nó Econodata, versão 1 continua igual', () => {
	it('Get Many devolve a resposta inteira num item só, com o cursor manual', async () => {
		const capturadas = [];
		const resposta = { resultados: [{ cnpj: '1' }, { cnpj: '2' }], pagina: { cursorProximo: 'c2' } };
		const [saida] = await new Econodata().execute.call(
			contexto({
				capturadas,
				respostas: () => resposta,
				parametros: {
					resource: 'company',
					operation: 'searchListById',
					nomePesquisa: ' Software SP ',
					paginacao: { cursor: 'c1', tamanho: 10 },
				},
			}),
		);

		assert.deepEqual(capturadas[0].body, { nome: 'Software SP', pagina: { tamanho: 10, cursor: 'c1' } });
		assert.equal(saida.length, 1);
		assert.deepEqual(saida[0].json, resposta);
	});

	it('Find devolve a resposta da API sem resumir', async () => {
		const resposta = { empresa: EMPRESA };
		const [saida] = await new Econodata().execute.call(
			contexto({ respostas: () => resposta, parametros: { resource: 'company', operation: 'search', cnpj: '1' } }),
		);

		assert.deepEqual(saida[0].json, resposta);
	});
});
