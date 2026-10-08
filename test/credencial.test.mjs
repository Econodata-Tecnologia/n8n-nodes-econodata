import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exigir } from './ajuda.mjs';

const { EconodataApi } = exigir('../dist/credentials/EconodataApi.credentials.js');
const { USER_AGENT } = exigir('../dist/nodes/Econodata/GenericFunctions.js');
const { homepage } = exigir('../package.json');

const DOCUMENTACAO_PUBLICA = 'https://econodata-tecnologia.github.io/api-v4-docs/';
const CHAVES_DO_CLIENTE = 'https://plat.econodata.com.br/#/integracoes-api';
const TRIAL_COM_ORIGEM_N8N = 'https://www.econodata.com.br/api-trial?utm_source=n8n';

describe('credencial EconodataApi', () => {
	it('teste de conexão manda o mesmo User-Agent do nó', () => {
		assert.equal(new EconodataApi().test.request.headers['User-Agent'], USER_AGENT);
	});

	it('link de documentação da credencial abre a documentação pública', () => {
		assert.ok(new EconodataApi().documentationUrl.startsWith(DOCUMENTACAO_PUBLICA));
	});

	it('homepage do pacote no npm abre a documentação pública', () => {
		assert.equal(homepage, DOCUMENTACAO_PUBLICA);
	});

	it('campo da chave mostra os dois caminhos: cliente na plataforma e novo cliente no trial com origem n8n', () => {
		const campo = new EconodataApi().properties.find((propriedade) => propriedade.name === 'apiKey');

		assert.ok(campo.description.includes(`href="${CHAVES_DO_CLIENTE}"`));
		assert.ok(campo.description.includes(`href="${TRIAL_COM_ORIGEM_N8N}"`));
	});

	it('README do npm mostra os dois caminhos da chave', () => {
		const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

		assert.ok(readme.includes(`(${CHAVES_DO_CLIENTE})`));
		assert.ok(readme.includes(`(${TRIAL_COM_ORIGEM_N8N})`));
	});

	it('credencial usa os ícones claro e escuro que o build publica', () => {
		const { light, dark } = new EconodataApi().icon;

		assert.equal(light, 'file:../icons/econodata.svg');
		assert.equal(dark, 'file:../icons/econodata.dark.svg');
		assert.ok(readFileSync(new URL('../dist/icons/econodata.svg', import.meta.url), 'utf8').includes('<svg'));
		assert.ok(readFileSync(new URL('../dist/icons/econodata.dark.svg', import.meta.url), 'utf8').includes('<svg'));
	});
});
