import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { speechifyApiRequest } from '../../GenericFunctions';

const showOnlyForThisOperation = {
	show: {
		resource: ['voice'],
		operation: ['getAll'],
	},
};

export const description: INodeProperties[] = [
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: showOnlyForThisOperation,
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: {
			show: {
				resource: ['voice'],
				operation: ['getAll'],
				returnAll: [false],
			},
		},
		description: 'Max number of results to return',
	},
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		displayOptions: showOnlyForThisOperation,
		description: 'Whether to return a simplified voice representation instead of the raw API response',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: showOnlyForThisOperation,
		// The API filters these server-side (GET /v1/voices `type`/`locale` query
		// params), so narrowing here is cheaper than pulling the whole catalogue
		// and filtering in the workflow.
		options: [
			{
				displayName: 'Type',
				name: 'type',
				type: 'options',
				options: [
					{ name: 'Personal (Cloned)', value: 'personal' },
					{ name: 'Shared (Catalog)', value: 'shared' },
				],
				default: 'shared',
				description: 'Only return voices of this type. Omit to return both.',
			},
			{
				displayName: 'Locale',
				name: 'locale',
				type: 'string',
				default: '',
				placeholder: 'en-US',
				description:
					'Only return voices whose locale prefix-matches this BCP-47 range (e.g. "en" matches en-US and en-GB)',
			},
		],
	},
];

// The simplified view keeps only what a workflow (or an AI agent using this
// node as a tool) needs to PICK a voice. `languages` is flattened from the
// raw `models[].languages` union - dropping it entirely, as the first cut did,
// hid the one fact needed to choose a voice for a non-English request. Turn
// Simplify off for the full object (avatar, preview audio, project_id, tags).
function simplifyVoice(voice: IDataObject): IDataObject {
	const models = Array.isArray(voice.models) ? (voice.models as IDataObject[]) : [];
	const languages = [
		...new Set(
			models.flatMap((model) =>
				Array.isArray(model.languages) ? (model.languages as string[]) : [],
			),
		),
	];
	return {
		voiceId: voice.id ?? voice.voice_id,
		displayName: voice.display_name ?? voice.name,
		gender: voice.gender,
		locale: voice.locale ?? voice.language,
		type: voice.type,
		languages,
	};
}

export async function execute(
	this: IExecuteFunctions,
	items: INodeExecutionData[],
): Promise<INodeExecutionData[]> {
	const returnData: INodeExecutionData[] = [];

	for (let i = 0; i < items.length; i++) {
		try {
			const returnAll = this.getNodeParameter('returnAll', i) as boolean;
			const simplify = this.getNodeParameter('simplify', i) as boolean;
			const filters = this.getNodeParameter('filters', i, {}) as {
				type?: string;
				locale?: string;
			};

			const qs: IDataObject = {};
			if (filters.type) qs.type = filters.type;
			if (filters.locale) qs.locale = filters.locale;

			let voices: IDataObject[];
			try {
				const responseData = (await speechifyApiRequest.call(this, 'GET', '/v1/voices', undefined, qs)) as
					| IDataObject[]
					| { voices?: IDataObject[] };
				// The Speechify voices endpoint returns either a bare array or
				// `{ voices: [...] }` depending on API version; handle both so a
				// minor response-shape change doesn't break every workflow.
				voices = Array.isArray(responseData) ? responseData : (responseData?.voices ?? []);
			} catch (error) {
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}

			const limit = returnAll ? voices.length : (this.getNodeParameter('limit', i) as number);
			const slice = voices.slice(0, limit);

			for (const voice of slice) {
				const json = simplify ? simplifyVoice(voice) : voice;
				returnData.push({ json, pairedItem: { item: i } });
			}
		} catch (error) {
			if (this.continueOnFail()) {
				returnData.push({
					json: { error: (error as Error).message },
					pairedItem: { item: i },
				});
				continue;
			}
			// The inner try above already wraps API failures in NodeApiError;
			// this outer catch only exists to implement continueOnFail, so pass
			// already-typed errors straight through instead of re-labelling them.
			throw error instanceof NodeApiError || error instanceof NodeOperationError
				? error
				: new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
		}
	}

	return returnData;
}
