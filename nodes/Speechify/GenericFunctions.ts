import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodeListSearchItems,
	INodeListSearchResult,
	INodePropertyOptions,
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

// A 429 surfaces as a NodeApiError that n8n's own per-node "Retry On Fail"
// setting (with a retry interval) is designed to handle - and it honours a
// paused/resumed run without blocking a worker. A custom sleep-and-retry here
// would need `setTimeout`, which n8n Cloud's node sandbox forbids (it breaks
// verification), so retry is deliberately left to the platform, not built in.
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

// Reads which model ids a voice declares support for (its `models[].name`).
// Empty when the voice lists none, in which case we do not exclude it - absence
// of the field is treated as "unknown", not "incompatible".
function voiceModelIds(voice: IDataObject): string[] {
	const models = Array.isArray(voice.models) ? (voice.models as IDataObject[]) : [];
	return models.map((model) => String(model.name ?? '')).filter((name) => name !== '');
}

// Backs the Voice resource-locator's "From List" mode. `/v1/voices` returns the
// full catalogue in one response by default, so we filter client-side on the
// term n8n passes as the user types. When a Model is chosen we also drop voices
// that model cannot speak (Model gates Voice), read live via getCurrentNodeParameter
// so the list is correct each time the picker opens. The label carries locale and
// gender so two voices sharing a display name are still distinguishable.
export async function searchVoices(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const selectedModel = String(this.getCurrentNodeParameter('model') ?? '');
	const response = (await speechifyApiRequest.call(this, 'GET', '/v1/voices')) as
		| IDataObject[]
		| { voices?: IDataObject[] };
	const voices = Array.isArray(response) ? response : (response?.voices ?? []);

	const term = filter?.toLowerCase().trim();
	const results: INodeListSearchItems[] = [];
	for (const voice of voices) {
		const value = String(voice.id ?? voice.voice_id ?? '');
		if (value === '') continue;
		if (selectedModel) {
			const supported = voiceModelIds(voice);
			if (supported.length > 0 && !supported.includes(selectedModel)) continue;
		}
		const displayName = String(voice.display_name ?? voice.name ?? value);
		const locale = voice.locale ?? voice.language;
		const gender = voice.gender;
		const label = [displayName, locale, gender].filter(Boolean).join(' · ');
		if (term && !label.toLowerCase().includes(term) && !value.toLowerCase().includes(term)) {
			continue;
		}
		results.push({ name: label, value });
	}
	results.sort((a, b) => a.name.localeCompare(b.name));

	return { results };
}

// Backs the Model dropdown. `/v1/audio/models` is designed to drive exactly this
// picker: it returns the models selectable on the synthesis endpoints, scoped to
// the workspace's API version (a retired model is simply absent). Loading it live
// means the node never ships a stale hard-coded model enum - a new Simba or a
// retirement shows up without a package release. `dialogue_models` are omitted:
// they are rejected on /v1/audio/speech.
export async function getModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const response = (await speechifyApiRequest.call(this, 'GET', '/v1/audio/models')) as {
		models?: IDataObject[];
	};
	const models = Array.isArray(response?.models) ? response.models : [];

	const options: INodePropertyOptions[] = [];
	for (const model of models) {
		const value = String(model.id ?? '');
		if (value === '') continue;
		const markers = [
			model.default ? 'default' : '',
			model.recommended ? 'recommended' : '',
			model.deprecated ? 'deprecated' : '',
		].filter(Boolean);
		const name = String(model.name ?? value) + (markers.length ? ` (${markers.join(', ')})` : '');
		options.push({ name, value, description: String(model.description ?? '') });
	}
	return options;
}

// Backs the Language dropdown, scoped to the selected Model. Same source of
// truth as the models picker: when a Model is chosen we list exactly that
// model's `languages` (so English-only Simba 3.2 offers only English); with no
// Model we fall back to the union across every model. Either way there is no
// hard-coded language table to drift. Codes get friendly labels via Intl.
// `loadOptionsDependsOn: ['model']` on the field reloads this when Model changes.
export async function getLanguages(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const selectedModel = String(this.getCurrentNodeParameter('model') ?? '');
	const response = (await speechifyApiRequest.call(this, 'GET', '/v1/audio/models')) as {
		models?: IDataObject[];
	};
	const models = Array.isArray(response?.models) ? response.models : [];
	const scoped = selectedModel
		? models.filter((model) => String(model.id ?? '') === selectedModel)
		: models;

	const codes = new Set<string>();
	for (const model of scoped) {
		const languages = Array.isArray(model.languages) ? (model.languages as unknown[]) : [];
		for (const language of languages) {
			if (typeof language === 'string' && language !== '') codes.add(language);
		}
	}

	let display: Intl.DisplayNames | undefined;
	try {
		display = new Intl.DisplayNames(['en'], { type: 'language' });
	} catch {
		display = undefined;
	}

	return [...codes].sort().map((code): INodePropertyOptions => {
		let friendly: string | undefined;
		try {
			friendly = display?.of(code);
		} catch {
			friendly = undefined;
		}
		const name = friendly && friendly !== code ? `${friendly} (${code})` : code;
		return { name, value: code };
	});
}
