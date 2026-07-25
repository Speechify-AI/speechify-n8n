import type { INodeProperties } from 'n8n-workflow';

import * as getAll from './getAll.operation';

export { getAll };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['voice'],
			},
		},
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List the voices available to your Speechify account',
				action: 'Get many voices',
			},
		],
		default: 'getAll',
	},
	...getAll.description,
];
