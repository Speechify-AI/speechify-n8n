import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
} from 'n8n-workflow';

// `package.json` is in tsconfig `include` with `resolveJsonModule`, and
// `n8n-node build` emits `dist/package.json`, so this resolves at both compile
// and runtime. Sourcing the version here (rather than a hand-kept constant)
// keeps `Speechify-Caller-Version` in lockstep with whatever release-please
// bumped and published - a stale version header defeats the point of sending it.
import { version as INTEGRATION_VERSION } from '../../package.json';

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
 *
 * `Speechify-Caller-Version` is a SECOND header, not a suffix on the slug: the
 * slug is what every usage report groups by, so folding the version into it
 * would make that grouping per-release. It carries this node's own release so
 * Speechify can tell whether a fix we shipped has reached a customer's
 * workflows yet. It is dropped server-side if malformed, so it never gates.
 */
const ATTRIBUTION_HEADERS = {
	'Speechify-Caller': 'n8n',
	'Speechify-Caller-Version': INTEGRATION_VERSION,
};

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
