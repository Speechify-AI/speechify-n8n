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
		displayName: 'Model Name or ID',
		name: 'model',
		type: 'options',
		// Top-level (not in Additional Fields) because Voice and Language depend
		// on it - n8n can only read a dependency that is a top-level parameter,
		// not a sibling inside a collection. Loaded live from GET /v1/audio/models
		// so the list never ships a stale enum. Empty falls back to the API
		// default (simba-3.0) in execute.
		typeOptions: {
			loadOptionsMethod: 'getModels',
		},
		default: '',
		displayOptions: showOnlyForThisOperation,
		description:
			'Speechify TTS model, loaded live from your workspace (leave empty for the API default, simba-3.0). It determines which voices and languages are valid. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Voice',
		name: 'voiceId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		displayOptions: showOnlyForThisOperation,
		description: 'The voice to generate audio with',
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: {
					searchListMethod: 'searchVoices',
					searchable: true,
				},
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. scott',
				// Voice IDs are opaque slugs, so no validation pattern - anything
				// the catalogue returns is valid, and a wrong one is a clean 400.
			},
		],
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
					{ name: 'AAC', value: 'aac' },
					{ name: 'MP3', value: 'mp3' },
					{ name: 'OGG', value: 'ogg' },
					{ name: 'WAV', value: 'wav' },
				],
				default: 'mp3',
				description: 'Audio container format for the generated file',
			},
			{
				displayName: 'Language Name or ID',
				name: 'language',
				type: 'options',
				// Scoped to the selected Model's supported languages (falls back to
				// the union across models when Model is empty). `loadOptionsDependsOn`
				// reloads the list when Model changes; the method reads Model via
				// getCurrentNodeParameter. Empty = the voice's own default.
				typeOptions: {
					loadOptionsMethod: 'getLanguages',
					loadOptionsDependsOn: ['model'],
				},
				default: '',
				description:
					'BCP-47 language override; leave empty to use the voice default. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Loudness Normalization',
				name: 'loudnessNormalization',
				type: 'boolean',
				default: false,
				description:
					'Whether to normalize output loudness to a standard level (-14 LUFS). Useful for consistent volume across a batch. Adds some latency.',
			},
			{
				displayName: 'Output Format',
				name: 'outputFormat',
				type: 'options',
				// Advanced codec_sampleRate_bitrate control. When set it takes
				// precedence over Audio Format. `pcm_16000` and `ulaw_8000` (PCMU)
				// are the telephony formats Twilio/LiveKit SIP expect; `mp3_*_160`
				// are the max-fidelity mp3s and are Simba-3-only.
				options: [
					{ name: 'AAC · 24 KHz', value: 'aac_24000' },
					{ name: 'MP3 · 22 KHz · 128 Kbps', value: 'mp3_22050_128' },
					{ name: 'MP3 · 24 KHz · 128 Kbps', value: 'mp3_24000_128' },
					{ name: 'MP3 · 24 KHz · 160 Kbps (Simba 3)', value: 'mp3_24000_160' },
					{ name: 'MP3 · 24 KHz · 64 Kbps', value: 'mp3_24000_64' },
					{ name: 'OGG · 24 KHz', value: 'ogg_24000' },
					{ name: 'PCM · 16 KHz (Telephony)', value: 'pcm_16000' },
					{ name: 'PCM · 24 KHz', value: 'pcm_24000' },
					{ name: 'PCM · 8 KHz', value: 'pcm_8000' },
					{ name: 'PCMU · 8 KHz (Telephony)', value: 'ulaw_8000' },
					{ name: 'WAV · 24 KHz', value: 'wav_24000' },
					{ name: 'WAV · 48 KHz', value: 'wav_48000' },
				],
				default: 'mp3_24000_128',
				description:
					'Precise codec/sample-rate/bitrate. Overrides Audio Format when set. Leave unset to use Audio Format.',
			},
			{
				displayName: 'Text Normalization',
				name: 'textNormalization',
				type: 'boolean',
				default: true,
				description:
					'Whether to expand numbers, dates, etc. into words (e.g. "55" becomes "fifty five"). Adds some latency. On by default.',
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
			// `voiceId` is a resourceLocator; extractValue pulls the underlying id
			// out of whichever mode (list/id) the user chose.
			const voiceId = this.getNodeParameter('voiceId', i, '', { extractValue: true }) as string;
			const model = this.getNodeParameter('model', i, '') as string;
			const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
			const additionalFields = this.getNodeParameter('additionalFields', i, {}) as {
				audioFormat?: string;
				language?: string;
				loudnessNormalization?: boolean;
				textNormalization?: boolean;
				outputFormat?: string;
			};

			if (!voiceId) {
				throw new NodeOperationError(this.getNode(), 'A voice must be selected', {
					itemIndex: i,
				});
			}

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
				model: model || 'simba-3.0',
			};

			if (additionalFields.language) {
				body.language = additionalFields.language;
			}

			// `output_format` (codec_sampleRate_bitrate) takes precedence over
			// `audio_format` server-side, so only send it when the user set it.
			if (additionalFields.outputFormat) {
				body.output_format = additionalFields.outputFormat;
			}

			// Only send `options` the user actually toggled - omitting a field
			// leaves the API on its own default (loudness off, text norm on).
			const speechOptions: IDataObject = {};
			if (additionalFields.loudnessNormalization !== undefined) {
				speechOptions.loudness_normalization = additionalFields.loudnessNormalization;
			}
			if (additionalFields.textNormalization !== undefined) {
				speechOptions.text_normalization = additionalFields.textNormalization;
			}
			if (Object.keys(speechOptions).length > 0) {
				body.options = speechOptions;
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
