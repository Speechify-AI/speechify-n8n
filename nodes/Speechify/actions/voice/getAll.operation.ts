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
];

export async function execute(
	this: IExecuteFunctions,
	items: INodeExecutionData[],
): Promise<INodeExecutionData[]> {
	const returnData: INodeExecutionData[] = [];

	for (let i = 0; i < items.length; i++) {
		try {
			const returnAll = this.getNodeParameter('returnAll', i) as boolean;
			const simplify = this.getNodeParameter('simplify', i) as boolean;

			let voices: IDataObject[];
			try {
				const responseData = (await speechifyApiRequest.call(this, 'GET', '/v1/voices')) as
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
				const json = simplify
					? {
							voiceId: voice.id ?? voice.voice_id,
							displayName: voice.display_name ?? voice.name,
							gender: voice.gender,
							locale: voice.locale ?? voice.language,
						}
					: voice;

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
