import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
} from 'n8n-workflow';

export const SPEECHIFY_API_BASE_URL = 'https://api.speechify.ai';

/**
 * Speechify's DevRel integration guidelines (Linear DRG-204) require every
 * outbound request an integration makes to carry `Speechify-Caller` so usage
 * can be attributed back to this integration. SDK-based integrations get
 * this for free from the SDK default; this node talks to the REST API
 * directly (axios/fetch via n8n's `httpRequest` helper, not `@speechify/api`),
 * so nothing sets it automatically - it MUST be added on every request below.
 * This exact header was silently dropped from the LiveKit integration once
 * already, so treat removing it as a regression, not a cleanup.
 */
const ATTRIBUTION_HEADERS = { 'Speechify-Caller': 'n8n' };

export async function speechifyApiRequest<T = IDataObject>(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject,
	qs?: IDataObject,
): Promise<T> {
	const options: IHttpRequestOptions = {
		method,
		url: `${SPEECHIFY_API_BASE_URL}${endpoint}`,
		headers: {
			...ATTRIBUTION_HEADERS,
		},
		json: true,
	};

	if (body !== undefined && Object.keys(body).length > 0) {
		options.body = body;
	}

	if (qs !== undefined && Object.keys(qs).length > 0) {
		options.qs = qs;
	}

	// `httpRequestWithAuthentication` merges in the credential's own
	// `authenticate` block (the Bearer Authorization header) on top of
	// `options` above, so this call ends up sending both auth and
	// attribution headers without the node needing to know the credential's
	// shape.
	return this.helpers.httpRequestWithAuthentication.call(this, 'speechifyApi', options) as Promise<T>;
}
