import type { MessageKey } from './en';

export const fr: Record<MessageKey, string> = {
	'settings.debug.name': 'Mode débogage',
	'settings.debug.desc':
		'Afficher les messages de diagnostic dans la console de développement. Les erreurs sont toujours affichées.',
	'settings.readOnly':
		'Ces réglages ont été enregistrés par une version plus récente de cette extension. Ils sont utilisés tels quels et ne seront pas modifiés tant que vous ne mettez pas à jour.',
	'commands.openGraph': 'Ouvrir le graphe des liens',
	'commands.openLocalGraph': 'Ouvrir le graphe local des liens',
	'relations.title': 'Graphe des liens',
	'relations.localTitle': 'Graphe local des liens',
	'relations.list': 'Liens entre les notes',
	'relations.note': 'Note',
	'relations.outgoing': 'Liens vers',
	'relations.incoming': 'Liée depuis',
	'relations.canvas': 'Graphe des liens entre les notes. Utilisez le tableau ci-dessous pour le parcourir au clavier.',
	'relations.summary': 'Notes : {notes}, liens : {links}, liens non résolus : {unresolved}',
	'relations.selected': 'Sélection : {label}',
	'relations.unresolvedNote': '(Non créée)',
	'relations.local': 'Graphe local',
	'relations.depth': 'Profondeur',
	'relations.showUnresolved': 'Afficher les notes pas encore créées',
	'relations.loading': 'Chargement du graphe…',
	'relations.error': "Le graphe n'a pas pu être affiché : {message}",
	'relations.noActiveNote': 'Ouvrez une note pour voir son graphe local.',
};
