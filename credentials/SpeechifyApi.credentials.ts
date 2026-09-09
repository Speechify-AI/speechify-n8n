import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

// Kept in lockstep with the node's own request headers - see
// nodes/Speechify/GenericFunctions.ts for why the version is sourced from
// package.json rather than hand-maintained.
import { version as INTEGRATION_VERSION } from '../package.json';

export class SpeechifyApi implements ICredentialType {
	name = 'speechifyApi';

	displayName = 'Speechify API';

	documentationUrl = 'https://docs.speechify.ai';

	icon = {
		light: 'file:../nodes/Speechify/speechify.svg',
		dark: 'file:../nodes/Speechify/speechify.dark.svg',
	} as const;

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'API key generated from the Speechify API console. Sent as a Bearer token on every request.',
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

	// Only checks that the key is accepted. The `Speechify-Caller[-Version]`
	// attribution headers are deliberately included here too (not just on the
	// node's own requests) so the credential-test call is attributed the same
	// way as every other outbound request - see nodes/Speechify/GenericFunctions.ts.
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.speechify.ai',
			url: '/v1/voices',
			method: 'GET',
			headers: {
				'Speechify-Caller': 'n8n',
				'Speechify-Caller-Version': INTEGRATION_VERSION,
			},
		},
	};
}
