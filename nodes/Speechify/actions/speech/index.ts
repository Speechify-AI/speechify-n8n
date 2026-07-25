import type { INodeProperties } from 'n8n-workflow';

import * as generateAudio from './generateAudio.operation';

export { generateAudio };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['speech'],
			},
		},
		options: [
			{
				name: 'Generate Audio',
				value: 'generateAudio',
				description: 'Convert text to speech and return an audio file',
				action: 'Generate audio from text',
			},
		],
		default: 'generateAudio',
	},
	...generateAudio.description,
];
