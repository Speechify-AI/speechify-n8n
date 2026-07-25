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
		resource: ['speech'],
		operation: ['generateAudio'],
	},
};

export const description: INodeProperties[] = [
	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		required: true,
		displayOptions: showOnlyForThisOperation,
		description: 'The text to convert to speech. Supports Speechify SSML for pronunciation and pacing control.',
	},
	{
		displayName: 'Voice ID',
		name: 'voiceId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: showOnlyForThisOperation,
		description:
			'The voice to generate audio with. Use the Voice resource\'s "Get Many" operation to look up available voice IDs.',
	},
	{
		displayName: 'Binary Property',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		displayOptions: showOnlyForThisOperation,
		description: 'Name of the binary property the generated audio file is written to',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showOnlyForThisOperation,
		options: [
			{
				displayName: 'Audio Format',
				name: 'audioFormat',
				type: 'options',
				options: [
					{ name: 'MP3', value: 'mp3' },
					{ name: 'WAV', value: 'wav' },
					{ name: 'OGG', value: 'ogg' },
					{ name: 'AAC', value: 'aac' },
				],
				default: 'mp3',
				description: 'Audio container format for the generated file',
			},
			{
				displayName: 'Model',
				name: 'model',
				type: 'string',
				// `simba-3.2` is Speechify's current recommended English model
				// per the DevRel integration guidelines (Linear DRG-204,
				// confirmed 2026-07-25). Kept as a plain overridable string
				// rather than baked into the request so this node doesn't ship
				// a stale default the way the VideoSDK/Mastra integrations did
				// once Speechify moves the recommendation again.
				default: 'simba-3.2',
				description: 'Speechify TTS model to generate with',
			},
			{
				displayName: 'Language',
				name: 'language',
				type: 'string',
				default: '',
				placeholder: 'en-US',
				description: 'BCP-47 language code override. Leave empty to use the voice default.',
			},
		],
	},
];

export async function execute(
	this: IExecuteFunctions,
	items: INodeExecutionData[],
): Promise<INodeExecutionData[]> {
	const returnData: INodeExecutionData[] = [];

	for (let i = 0; i < items.length; i++) {
		try {
			const text = this.getNodeParameter('text', i) as string;
			const voiceId = this.getNodeParameter('voiceId', i) as string;
			const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
			const additionalFields = this.getNodeParameter('additionalFields', i, {}) as {
				audioFormat?: string;
				model?: string;
				language?: string;
			};

			if (!text.trim()) {
				throw new NodeOperationError(this.getNode(), 'Text must not be empty', { itemIndex: i });
			}

			const audioFormat = additionalFields.audioFormat ?? 'mp3';

			const body: IDataObject = {
				input: text,
				voice_id: voiceId,
				audio_format: audioFormat,
				model: additionalFields.model || 'simba-3.2',
			};

			if (additionalFields.language) {
				body.language = additionalFields.language;
			}

			let responseData: IDataObject;
			try {
				responseData = (await speechifyApiRequest.call(this, 'POST', '/v1/audio/speech', body)) as IDataObject;
			} catch (error) {
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}

			const audioBase64 = responseData.audio_data as string;
			const buffer = Buffer.from(audioBase64, 'base64');
			const responseFormat = (responseData.audio_format as string) ?? audioFormat;
			const binaryData = await this.helpers.prepareBinaryData(
				buffer,
				`speech.${responseFormat}`,
				`audio/${responseFormat}`,
			);

			returnData.push({
				json: {
					billableCharactersCount: responseData.billable_characters_count ?? null,
					audioFormat: responseFormat,
					speechMarks: responseData.speech_marks ?? null,
				},
				binary: {
					[binaryPropertyName]: binaryData,
				},
				pairedItem: { item: i },
			});
		} catch (error) {
			if (this.continueOnFail()) {
				returnData.push({
					json: { error: (error as Error).message },
					pairedItem: { item: i },
				});
				continue;
			}
			// The inner try above already wraps API failures in NodeApiError, and
			// validation failures already throw NodeOperationError; this outer
			// catch only exists to implement continueOnFail, so pass already-typed
			// errors straight through instead of re-labelling them.
			throw error instanceof NodeApiError || error instanceof NodeOperationError
				? error
				: new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
		}
	}

	return returnData;
}
