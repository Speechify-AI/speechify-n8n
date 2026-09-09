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
		description:
			'The text to convert to speech (max 2000 characters). Supports Speechify SSML for pronunciation and pacing control.',
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
				type: 'options',
				// The API accepts ONLY this enum (GetSpeechRequest.model); anything
				// else 400s `model_retired`, so this is a closed dropdown, not the
				// free-text field it started as. Default is `simba-3.0` to match
				// the API's own default and because it is multilingual - defaulting
				// to the English-only `simba-3.2` would 400 the moment a user picks
				// a non-English voice, which this node lets them do.
				options: [
					{
						name: 'Simba 3.0 (Multilingual)',
						value: 'simba-3.0',
						description: 'Streaming-native, multilingual (English plus de-DE, es-ES, es-MX, fr-FR, it-IT, pt-BR). The API default.',
					},
					{
						name: 'Simba 3.2 (English Only)',
						value: 'simba-3.2',
						description:
							'Lowest latency and richest expressivity, English only - a non-English voice returns 400',
					},
				],
				default: 'simba-3.0',
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

			// The API caps `input` at 2000 chars (GetSpeechRequest.input). Catch
			// it here so the failure names the limit, rather than returning an
			// opaque 400 from the far side of the request.
			if (text.length > 2000) {
				throw new NodeOperationError(
					this.getNode(),
					`Text is ${text.length} characters; the Speechify limit is 2000. Split it across multiple items.`,
					{ itemIndex: i },
				);
			}

			const audioFormat = additionalFields.audioFormat ?? 'mp3';

			const body: IDataObject = {
				input: text,
				voice_id: voiceId,
				audio_format: audioFormat,
				model: additionalFields.model || 'simba-3.0',
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

			// `audio_data` is a required field on a 2xx (GetSpeechResponse), but
			// guard it anyway: `Buffer.from(undefined, 'base64')` throws a raw
			// "first argument must be of type string" TypeError, which is a
			// baffling thing to surface to a workflow author. A typed message
			// names the actual problem.
			const audioBase64 = responseData.audio_data;
			if (typeof audioBase64 !== 'string' || audioBase64.length === 0) {
				throw new NodeOperationError(
					this.getNode(),
					'Speechify returned a response with no audio data',
					{ itemIndex: i },
				);
			}
			const buffer = Buffer.from(audioBase64, 'base64');
			const responseFormat = (responseData.audio_format as string) ?? audioFormat;
			// mp3's registered media type is audio/mpeg, not audio/mp3 - a wrong
			// type trips strict downstream consumers (respond-to-webhook,
			// Content-Type sniffing). The other formats map to audio/<format>.
			const mimeType = responseFormat === 'mp3' ? 'audio/mpeg' : `audio/${responseFormat}`;
			const binaryData = await this.helpers.prepareBinaryData(
				buffer,
				`speech.${responseFormat}`,
				mimeType,
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
