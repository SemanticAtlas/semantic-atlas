export const en = {
	'settings.debug.name': 'Debug mode',
	'settings.debug.desc': 'Show diagnostic messages in the developer console. Errors are always shown.',
	'settings.readOnly':
		'These settings were saved by a newer version of this plugin. They are used as they are and will not be changed until you update.',
	'commands.openGraph': 'Open link graph',
	'commands.openLocalGraph': 'Open local link graph',
	'relations.title': 'Link graph',
	'relations.localTitle': 'Local link graph',
	'relations.list': 'Links between notes',
	'relations.note': 'Note',
	'relations.outgoing': 'Links to',
	'relations.incoming': 'Linked from',
	'relations.canvas': 'Graph of the links between notes. Use the table below to browse it with the keyboard.',
	'relations.summary': 'Notes: {notes}, links: {links}, unresolved links: {unresolved}',
	'relations.selected': 'Selected: {label}',
	'relations.unresolvedNote': '(Not created)',
	'relations.local': 'Local graph',
	'relations.depth': 'Depth',
	'relations.showUnresolved': 'Show notes not created yet',
	'relations.loading': 'Loading the graph…',
	'relations.error': 'The graph could not be shown: {message}',
	'relations.noActiveNote': 'Open a note to see its local graph.',
} as const;

export type MessageKey = keyof typeof en;
