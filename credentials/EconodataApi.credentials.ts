import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  Icon,
  INodeProperties,
} from 'n8n-workflow';
import { USER_AGENT } from '../nodes/Econodata/GenericFunctions';

export class EconodataApi implements ICredentialType {
  name = 'econodataApi';

  displayName = 'Econodata API';

  icon: Icon = { light: 'file:../icons/econodata.svg', dark: 'file:../icons/econodata.dark.svg' };

  documentationUrl =
    'https://github.com/Econodata-Tecnologia/n8n-nodes-econodata#credentials';

  properties: INodeProperties[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description:
        'Econodata API v4 key (ek_live_...). Existing customers: create one on the <a href="https://plat.econodata.com.br/#/integracoes-api">API keys page</a> of the Econodata platform. New customers: start with the <a href="https://www.econodata.com.br/api-trial?utm_source=n8n">API trial</a>.',
    },
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'string',
      default: 'https://api.econodata.com.br',
      required: true,
      description:
        'Address of the Econodata API. Keep the default unless Econodata support gives you another one.',
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
