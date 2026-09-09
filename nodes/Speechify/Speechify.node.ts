import type { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import * as speech from './actions/speech';
import * as voice from './actions/voice';
import { getLanguages, getModels, searchVoices } from './GenericFunctions';

export class Speechify implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SpeechifyAI',
		name: 'speechify',
		icon: { light: 'file:speechify.svg', dark: 'file:speechify.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Generate speech and manage voices with the Speechify API',
		defaults: {
			name: 'SpeechifyAI',
		},
		// Programmatic style (not declarative `routing`) because Generate Audio
		// returns base64 audio embedded in a JSON envelope that has to be
		// decoded into an n8n binary property before downstream nodes (Write
		// Binary File, respond-to-webhook, etc.) can use it - declarative
		// `postReceive` transforms don't cover that. This mirrors how
		// ElevenLabs' own community node is structured, not its code.
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'speechifyApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Speech', value: 'speech' },
					{ name: 'Voice', value: 'voice' },
				],
				default: 'speech',
			},
			...speech.description,
			...voice.description,
		],
	};

	methods = {
		listSearch: {
			searchVoices,
		},
		loadOptions: {
			getModels,
			getLanguages,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		// Nothing to synthesize or look up per input item, and reading item-0
		// parameters below assumes an item exists - return an empty branch
		// rather than indexing into an empty set.
		if (items.length === 0) {
			return [[]];
		}
		// `resource`/`operation` are structural dropdowns (noDataExpression),
		// so they're fixed for the whole node execution - read them once from
		// item 0 rather than per item, like the rest of the properties below.
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		let returnData: INodeExecutionData[];

		if (resource === 'speech' && operation === 'generateAudio') {
			returnData = await speech.generateAudio.execute.call(this, items);
		} else if (resource === 'voice' && operation === 'getAll') {
			returnData = await voice.getAll.execute.call(this, items);
		} else {
			throw new NodeOperationError(
				this.getNode(),
				`The operation "${operation}" is not supported for resource "${resource}"`,
			);
		}

		return [returnData];
	}
}
