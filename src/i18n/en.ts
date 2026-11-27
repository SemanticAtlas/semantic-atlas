export const en = {
	'settings.debug.name': 'Debug mode',
	'settings.debug.desc': 'Show diagnostic messages in the developer console. Errors are always shown.',
	'settings.readOnly':
		'These settings were saved by a newer version of this plugin. They are used as they are and will not be changed until you update.',
} as const;

export type MessageKey = keyof typeof en;
