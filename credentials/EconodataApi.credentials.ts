import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  Icon,
  INodeProperties,
} from 'n8n-workflow';
import { USER_AGENT } from '../nodes/Econodata/GenericFunctions';

/**
 * Credencial da API pública v4 da Econodata — autenticação por API key.
 *
 * A chave (ek_live_…) é emitida no painel "Integrações & API v4" (preset read-only de
 * integração). Injetada no header `Authorization: Bearer <apiKey>`. O teste de conexão
 * bate em `GET /v4/account/balance` (200 = válida; 401 = inválida).
 */
export class EconodataApi implements ICredentialType {
  name = 'econodataApi';

  displayName = 'Econodata API';

  icon: Icon = { light: 'file:../icons/econodata.svg', dark: 'file:../icons/econodata.dark.svg' };

  documentationUrl =
    'https://econodata-tecnologia.github.io/api-v4-docs/#/?id=_1-configurar-api-key-chaves-e-integrações';

  properties: INodeProperties[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description:
        'Econodata API v4 key (ek_live_...). Existing customers: create one in <a href="https://plat.econodata.com.br/#/integracoes-api">Chaves e Integrações</a> on the Econodata platform. New customers: start with the <a href="https://www.econodata.com.br/api-trial?utm_source=n8n">API trial</a>.',
    },
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'string',
      default: 'https://api.econodata.com.br',
      required: true,
      description:
        'Address of the Econodata API. Production: https://api.econodata.com.br. Staging: https://hmlapi.econodata.com.br.',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{$credentials.apiKey}}',
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl}}',
      url: '/v4/account/balance',
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT },
    },
  };
}
