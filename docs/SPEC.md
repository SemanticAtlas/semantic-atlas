# Semantic Atlas — spécification de phase 0

> Statut : **décisions D1 à D12 validées le 2026-11-27**. D4 (moteur d'inférence) reste sous réserve du spike S1. Pas de démarche publique auprès de l'équipe de l'annuaire : on construit, et on vérifie par l'analyse de prévisualisation du tableau de bord.
> Date du relevé : 2026-11-27. Sources lues ce jour : dépôt `obsidianmd/obsidian-developer-docs` (commit du 2026-11-25), `obsidianmd/obsidian-api` 1.14.4 (commit du 2026-11-19), `obsidianmd/obsidian-sample-plugin`, `obsidianmd/eslint-plugin`, billet « The future of Obsidian plugins » (2026-05-12), registre npm, Hugging Face, `community-plugins.json` (10 985 extensions).
> Toute valeur marquée **(estimation)** est un ordre de grandeur calculé, pas une mesure. La phase 1 commence par les mesures qui la remplacent.

## Sommaire

1. [Décisions à valider (résumé)](#1-décisions-à-valider-résumé)
2. [Périmètre ajouté depuis le prompt initial](#2-périmètre-ajouté-depuis-le-prompt-initial)
3. [Écarts entre le prompt et la documentation officielle](#3-écarts-entre-le-prompt-et-la-documentation-officielle)
4. [Organisation des dépôts et architecture](#4-organisation-des-dépôts-et-architecture)
5. [Bibliothèques candidates et choix par brique](#5-bibliothèques-candidates-et-choix-par-brique)
6. [Décisions détaillées](#6-décisions-détaillées)
7. [Budget chiffré](#7-budget-chiffré)
8. [Plan d'évaluation](#8-plan-dévaluation)
9. [Risques et replis](#9-risques-et-replis)
10. [Plan de phases révisé](#10-plan-de-phases-révisé)
11. [Points de méthode à arbitrer](#11-points-de-méthode-à-arbitrer)

---

## 1. Décisions à valider (résumé)

| # | Sujet | Recommandation | Alternative principale |
|---|---|---|---|
| D1 | Nom et identifiant | **Semantic Atlas**, `semantic-atlas` (libre dans l'annuaire au 2026-11-27) | — |
| D2 | Licence | **MIT** pour tous les dépôts de l'organisation | Apache-2.0 (clause de brevets) |
| D3 | Dépôts (créés le 2026-11-27) | Organisation `SemanticAtlas` à 5 dépôts : `.github`, `semanticatlas.github.io`, `semantic-atlas-core`, `semantic-atlas` (extension), `semantic-atlas-pwo` | Monodépôt unique |
| D4 | Moteur d'inférence | **ONNX Runtime Web compilé avec les seuls opérateurs du modèle, intégré à `main.js`** ; seules les données du modèle se téléchargent | Moteur maison TS + WASM (repli) |
| D5 | Modèle par défaut | **granite-embedding-97m-multilingual-r2** (Apache-2.0, 384 d, sans préfixe), sous réserve du banc d'essai S2 | multilingual-e5-small (MIT, préfixes) |
| D6 | Téléchargement du modèle | Consentement explicite, révision Hugging Face figée, SHA-256 vérifié, téléchargement par tranches `Range`, import manuel hors ligne, jamais de mise à jour silencieuse | — |
| D7 | Stockage de l'index | **IndexedDB local à l'appareil** + **instantané optionnel** en éclats ≤ 4 Mo dans un dossier visible du vault | Dossier de l'extension (rejeté) |
| D8 | `minAppVersion` | **1.11.4** (`SecretStorage`) | 1.13.0 (réglages déclaratifs) |
| D9 | Fonction de qualité Leiden | **CPM** à résolution calibrée, décision finale par l'expérience de la phase 2 | Modularité avec résolution |
| D10 | Mobile | Lecture de l'instantané, recherche BM25 + expansion par vecteurs, pas de modèle local par défaut | Modèle local opt-in (tablettes) |
| D11 | Vue « Relations » | Nouvelle vue du graphe des liens, partageant modèle, physique et rendu avec Explorer | Préréglage d'Explorer |
| D12 | Distribution du cœur | npm `@semanticatlas/core` (portée à réserver), versions 0.x semver | Dépendance Git |
| D13 | Langage du calcul (décidé le 2026-11-27) | **Rust**, crate `semantic-atlas-engine` compilé en WebAssembly (bureau, mobile, progressive-web-office) et en natif (futurs outils) ; TypeScript pour le contrat, les adaptateurs, le rendu, les workers et l'interface | Tout en TypeScript |

Le détail, les conséquences et les replis figurent en section 6.

---

## 2. Périmètre ajouté depuis le prompt initial

Trois demandes sont venues s'ajouter au prompt pendant la phase 0.

### 2.1 Graphe des relations entre pages (vue « Relations »)

Une vue dédiée au **graphe des liens explicites** : qui pointe vers qui. Elle complète Explorer, qui place les notes par le sens.

- **Global et local.** Mode local centré sur la note active, profondeur 1 à 3 sauts, qui suit la note active comme le graphe local d'Obsidian. Mode global pour tout le périmètre.
- **Arêtes typées et orientées** : lien, embed, lien de propriété, lien vers une note non créée, chacune avec un style propre (trait plein, pointillé, flèche). La couleur n'est jamais le seul code.
- **Surimpressions optionnelles** : arêtes sémantiques (k voisins), liens suggérés en tirets, avec leurs trois actions.
- **Disposition** : physique libre (section 6.11) avec ancrage sémantique à 0 par défaut. La géométrie vient donc des liens. Un curseur permet de mélanger avec la carte de sens.
- **Mêmes réglages** « Colorer par » et « Taille par » qu'Explorer. Les rôles issus du graphe de liens sont mis en avant : orphelines, impasses, points d'articulation, hubs.
- **Équivalent accessible** : liste d'adjacence triable (sortants, entrants, type, nombre d'occurrences) et navigation clavier de voisin en voisin.
- **Aucun code propre** : la vue assemble des briques de `@semanticatlas/core` (graphe à couches, physique, rendu, légende, fiche de note).

### 2.2 Briques communes et organisation `SemanticAtlas`

L'organisation GitHub `SemanticAtlas` existe. Le dépôt de l'extension est désormais `SemanticAtlas/semantic-atlas`, et `origin` y pointe. Tout ce qui ne dépend pas d'Obsidian sort dans un dépôt cœur partagé (section 4). Ce cœur est réutilisé par l'extension et par un composant pour **progressive-web-office**.

### 2.3 Coordination avec progressive-web-office

Ce qui suit vient d'une lecture locale du code, sans le modifier. Le message envoyé à la session de cet agent a expiré sans être lu.

- PWA Vite en ESM, sous licence **AGPL-3.0-or-later**.
- `NoteVault` (`src/folder/vault.ts`) lit les notes via une interface `StorageProvider` (dossier local, OPFS, WebDAV, Git). Il a son propre analyseur de wikilinks, de liens Markdown relatifs, de tags et d'alias.
- Les « notes liées » sont un score fixe : 2 points par tag partagé, 3 points pour un lien.
- Le graphe des liens (`src/folder/graph.ts`) est rendu en Mermaid, avec une liste comme équivalent accessible. Mermaid ne tiendra pas au-delà de quelques centaines de notes.

**Réponse de l'agent progressive-web-office (2026-11-27).** Le contrat convient, avec les compléments intégrés en 4.3. Ses contraintes :

- ESM uniquement, cible ES2022, workers au format `es`, tout chargé par `import()` dynamique (morceau principal ≤ 2 Mo).
- CSP : `script-src 'self' 'wasm-unsafe-eval' blob:` et `worker-src 'self' blob:`. Donc ni `eval` ni script venu d'un CDN.
- Modèles téléchargés une seule fois après consentement explicite (comme pour son moteur Typst), puis servis hors ligne par le service worker.
- Le texte arrive par rappel (archives ZIP en mémoire), pas par un système de fichiers.
- Libellés des éléments personnalisés passés en propriétés (i18n en, fr, zh).
- WebGL2 avec repli Canvas 2D.
- **Règle stricte** : le dépôt progressive-web-office, sa documentation et ses PR ne nomment jamais l'application de notes. Le code de `semantic-atlas-pwo` qui y entre respecte cette règle, et le cœur reste neutre dans ses noms d'API.
- Côté progressive-web-office, un graphe interactif (remplaçant FOLDER-018) et un graphe local par note sont proposés mais pas commencés. **Validé par l'utilisateur le 2026-11-27** : progressive-web-office utilisera `@semanticatlas/core` pour ses graphes de notes et ne construira pas le sien. Son côté sera écrit contre le contrat 4.3 dès que le modèle de graphe et `<sa-relations>` seront prêts à essayer.
- Briques réutilisables de progressive-web-office (analyse des wikilinks avec ancres et alias, `NoteIndex` incrémental, tags imbriqués, propriétés, modèle JSON Canvas 1.0, évaluateur `.base`) : AGPL. Elles ne sont reprises qu'après relicenciement explicite par l'auteur.

**Conséquence.** Le cœur prend en entrée un **format neutre** (section 4.3). Chaque application fournit son adaptateur : `metadataCache` pour Obsidian, `NoteVault` pour progressive-web-office. Le composant `semantic-atlas-pwo` pourra remplacer le graphe Mermaid et le score de proximité par le graphe à couches, la recherche hybride et le rendu du cœur.

**Licence.** Pour que l'extension et progressive-web-office (AGPL) puissent tous deux consommer le cœur, il doit être sous licence permissive. Le cœur ne reprend aucun code de progressive-web-office sans relicenciement explicite par son auteur, ce que l'auteur peut faire puisque c'est le même.

---

## 3. Écarts entre le prompt et la documentation officielle

La documentation officielle l'emporte. « Prompt » désigne le cahier des charges initial.

| # | Sujet | Prompt | Documentation actuelle | Conséquence |
|---|---|---|---|---|
| E1 | Adresses | `docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins` | La page a migré sous *Community directory* (`community-directory/submission-requirements-for-plugins`) ; l'ancienne adresse renvoie « Not found ». Les règles pour les développeurs sont sous `community.obsidian.md`. | Liens du README à mettre à jour. |
| E2 | Annuaire | Revue automatique « de l'annuaire » | Nouvel annuaire **Obsidian Community** (`community.obsidian.md`) avec tableau de bord. **Chaque version** est analysée en quatre sections (Manifeste, Releases, Code source, **Vérification du build**), avec des résultats Erreur, Avertissement, Recommandation ou Réussite. Une version en échec est retirée de la recherche sous 24 h. | Le build doit être **reproductible** : l'analyseur relance le premier script trouvé parmi `build`, `build:plugin`, `compile`, puis compare avec la release. Ni téléchargement ni horodatage pendant le build. Une CI vérifie l'identité octet à octet. |
| E3 | Fichiers ignorés par l'analyseur | — | Liste fixe ignorée : `node_modules, dist, build, test(s), __tests__, docs, scripts, i18n, locale(s), translations, l10n, *.mjs, *.cjs, *.mts, *.cts, *.test.*, *.spec.*`, etc. | Les tests vont dans `tests/`, les scripts de dev dans `scripts/`. `src/i18n/` n'est pas analysé : on active localement les règles `ui/sentence-case-locale-module`. |
| E4 | Déclarations | Réseau, fichiers, presse-papiers | Le billet cite : **network, file system, clipboard, and other capabilities**. Elles seront montrées avant l'installation. Une « fiche de sécurité » intégrera déclarations, labels de confidentialité, **attestation des artefacts**, revue manuelle. | Section « Déclarations » du README à quatre rubriques. Release avec attestation de provenance (`actions/attest`, déjà dans le modèle). |
| E5 | Nom | Pas « Obsidian », ne finit pas par « Plugin » | Le nom **ne contient pas** « Plugin », ni « Obsidian » ou ses variantes (« Obsi- », « -sidian »). Caractères latins de base uniquement, pas de ponctuation sauf `- + ( )`, pas de nom de fonction native (« Bases », « Live Preview »), nom **unique**. | « Semantic Atlas » est conforme et libre. |
| E6 | Identifiant | Pas « obsidian », ne finit pas par « plugin » | Plus : **minuscules et tirets uniquement**. Un identifiant publié **ne peut plus changer**. | `semantic-atlas` est conforme. C'est un choix définitif. |
| E7 | Description | « complète » | **≤ 250 caractères**, finit par un point, commence par un verbe d'action, jamais par « This is a plugin », sans emoji, majuscules correctes (« Markdown », « PDF »). | Projet : « Map your vault by meaning: related notes, semantic search, themes, bridges between topics and missing links, computed on your device. » (133 caractères). |
| E8 | Commandes | Libellés sans nom de l'extension | Plus : l'identifiant de commande ne contient ni l'identifiant de l'extension (préfixe ajouté automatiquement) ni le mot « command » ; le libellé ne contient pas « command ». | Conventions de nommage des commandes à suivre. |
| E9 | Réglages | `Setting.setHeading()` | Depuis **1.13.0**, réglages **déclaratifs** (`getSettingDefinitions()`) avec recherche intégrée. Obsidian y lit et écrit `plugin.settings[key]`, puis appelle lui-même `saveData()`. Les règles ESLint dépendent de `minAppVersion` (`require-display` sous 1.13). | Avec D8 = 1.11.4 : `display()` impératif. Le double support (chemin B) attend une solution pour l'enregistrement automatique, qui contournerait la protection des réglages écrits par une version plus récente. Un avertissement `prefer-setting-definitions` est accepté d'ici là. |
| E10 | Secrets | « s'il existe, à vérifier » | **Existe** : `app.secretStorage` (`SecretStorage`, @since 1.11.4) et `SecretComponent` (1.11.1, `setValue` et `onChange` en 1.11.4). Guide « Store secrets ». | `data.json` ne garde que le **nom** du secret. Impose `minAppVersion ≥ 1.11.4`. |
| E11 | Langue | « d'après celle d'Obsidian » | `getLanguage()` (@since 1.8.7). La règle `prefer-get-language` interdit de lire `localStorage.language`. | Utiliser `getLanguage()`. |
| E12 | Styles | Pas de style en ligne | Règle d'erreur `no-static-styles-assignment`. L'API fournit `el.setCssProps()` et `setCssStyles()`. | Les positions dynamiques (infobulles) passent par `setCssProps({'--sa-x': …})` et des variables CSS. Les étiquettes de carte sont dessinées dans le canvas. |
| E13 | Minuteurs et globaux | — | `prefer-window-timers` (`window.setTimeout` / `activeWindow`), `no-global-this`, `prefer-active-doc`, `prefer-instanceof`, `prefer-create-el`. | Imposé par ESLint. |
| E14 | Suppression | — | `prefer-file-manager-trash-file` : `fileManager.trashFile()` plutôt que `vault.delete`. | « Effacer toutes les données » met l'instantané à la corbeille via `trashFile`. |
| E15 | Node et Electron | Interdits | Autorisés s'ils sont gardés par `Platform.isDesktop` et que `isDesktopOnly` est cohérent. | On garde la règle du prompt, plus stricte : aucun usage. |
| E16 | Lookbehind | « si la version visée ne les gère pas » | Pris en charge à partir d'iOS 16.4 seulement. Règle d'**erreur** `regex-lookbehind`. | Aucun lookbehind, sans exception. |
| E17 | Cycle de vie | `onload` léger | Plus : `Plugin.onUserEnable()` (@since 1.7.2), à utiliser pour l'initialisation unique à la première activation (ouvrir une vue par exemple), plutôt que `onload`. Guide « Defer views ». | Ouverture initiale des vues dans `onUserEnable`. |
| E18 | `fundingUrl` | Absent sans dons | Confirmé. Le modèle officiel en contient un, à retirer. | Pas de `fundingUrl`. |
| E19 | Node.js de dev | — | `eslint-plugin-obsidianmd` exige Node 20.19+, 22.13+ ou 24+, ESLint ≥ 9.19, typescript-eslint ≥ 8.35.1, TypeScript 5 ou 6 (pas 7). Vitest 5 exige Node ^22.12 ou 24+. Le README du modèle dit encore « Node 18 ». | `engines.node >= 22.12`. CI sur 22 et 24. TypeScript épinglé à 6.0.3. |
| E20 | Release | Tag = version, trois fichiers | Le workflow officiel crée une release **brouillon** avec attestation de provenance. `styles.css` est facultatif. | On garde `styles.css`. Release brouillon puis publication manuelle. |
| E21 | Réseau | `requestUrl`, exception pour le flux d'un LLM | Les pages lues ne posent aucune règle `requestUrl` contre `fetch`. Seule la règle de divulgation s'applique. `requestUrl` n'a ni flux ni progression. | Pas de flux LLM (requête JSON unique, voir 6.12) : aucune exception nécessaire. Téléchargement du modèle par tranches `Range` (voir D6). |
| E22 | Téléchargements à l'exécution | « ne doit pas tomber sous l'interdiction » | Seule règle : « Install or update themselves or their dependencies ». Rien sur les données (poids de modèles). Précédents listés qui téléchargent runtime et modèle (Smart Connections, Similar Notes, Smart Composer). Aucun avis public d'un relecteur trouvé. | D4 et D6 gardent tout **code exécutable** dans la release. Pas de démarche publique : la conformité est vérifiée par l'analyse de prévisualisation du tableau de bord, à chaque étape. |
| E23 | Taille de `main.js` | — | Limite de taille de fichier Obsidian Sync : 5 Mo (Standard), 200 Mo (Plus). | **`main.js` < 5 Mo impératif**, sinon l'extension ne se synchronise pas vers le mobile des abonnés Standard. Cible ≤ 3 Mo. |
| E24 | Fourches et règles annexes | — | Règles sur les fourches, le signalement (7 jours), le retrait (malveillance, non-coopération, abandon), la divulgation des paiements et des comptes. | Sans effet ici (pas de fourche, gratuit, sans compte). Étiquette tarifaire de l'annuaire : **Free**. |

---

## 4. Organisation des dépôts et architecture

### 4.1 Dépôts de l'organisation `SemanticAtlas`

| Dépôt | Rôle | Contenu | Licence |
|---|---|---|---|
| `.github` | Profil et fichiers communs | `profile/README.md` (vitrine de l'organisation), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, modèles d'issues et de PR hérités par tous les dépôts | MIT / CC-BY-4.0 pour les textes |
| `semanticatlas.github.io` | Site public | Présentation, documentation agrégée des dépôts (VitePress, comme progressive-web-office), **`llms.txt` et `llms-full.txt`** générés depuis les `docs/`, captures, page « Confidentialité » | MIT (code), CC-BY-4.0 (textes) |
| `semantic-atlas-engine` | Moteur de calcul en Rust | Crate `semantic-atlas-engine` (graphes CSR, kNN et HNSW, Leiden et consensus, centralités, t-SNE, UMAP et PaCMAP, physique Barnes-Hut, inférence d'embeddings), module WebAssembly en ABI C simple, paquet npm `@semanticatlas/engine` (chargeur TypeScript) | MIT |
| `semantic-atlas-core` | Cœur partagé (TypeScript) | Paquet `@semanticatlas/core` : modèle, index pur, embeddings (worker), recherche, analyse, projections, physique, rendu. Aucune dépendance à Obsidian ni à un framework. | MIT |
| `semantic-atlas` (ce dépôt) | Extension Obsidian | Adaptateur Obsidian, vues, commandes, réglages, i18n, stockage, intégration du cœur dans un seul `main.js` | MIT |
| `semantic-atlas-pwo` | Composant pour progressive-web-office | Adaptateur `NoteVault` vers le format neutre, éléments personnalisés (`<sa-map>`, `<sa-related>`, `<sa-relations>`) consommés par progressive-web-office | MIT |

Pourquoi séparer le cœur de l'extension plutôt que de faire un monodépôt :

- **L'analyseur relance le build et analyse tout le dépôt** (E2, E3), sauf une liste fixe de dossiers. Un monodépôt mêlant un futur outil Node (CLI, serveur MCP) au code de l'extension déclencherait des alertes `no-nodejs-modules`.
- Le cœur suit sa propre version semver et ses propres releases. progressive-web-office le consomme sans dépendre d'Obsidian.
- Les fichiers WASM du cœur (D4) sont construits et **attestés dans la CI du cœur**, puis publiés sur npm avec provenance. L'extension les intègre comme n'importe quelle dépendance npm, ce qui garde le build de l'extension reproductible sans chaîne Emscripten.

Coût accepté : changer le cœur et l'extension en même temps demande deux PR. Pendant le développement, `npm link` ou un espace de travail local. Les releases de l'extension épinglent une version exacte du cœur.

Un sixième dépôt `semantic-atlas-agent` (CLI ou serveur MCP pour interroger l'atlas d'un vault hors d'Obsidian) est possible plus tard, sur le même cœur. Il n'est pas demandé aujourd'hui.

### 4.2 Modules

> **Décision D13 (2026-11-27)** : tout le calcul lourd passe dans le moteur Rust `semantic-atlas-engine`. Dans l'arborescence ci-dessous, `analysis/`, `layout/`, `physics/`, la partie numérique de `search/` (kNN, HNSW) et `embed/` (inférence) deviennent des modules du crate Rust. Le cœur TypeScript les appelle à travers le module WebAssembly, depuis ses workers. Il garde le contrat d'entrée, l'indexation du texte, BM25, le rendu, le stockage et l'orchestration. Le graphe CSR et le générateur aléatoire existent déjà en Rust, avec des sorties identiques à la version TypeScript (tests croisés).
>
> Frontière TypeScript–WebAssembly : ABI C simple (`docs/ABI.md` du moteur), sans code de liaison généré. Les tableaux typés sont copiés dans la mémoire du module, et les résultats restent derrière des poignées. Le module n'importe rien, donc il fonctionne hors ligne et sous une CSP stricte (`'wasm-unsafe-eval'`). Son build est reproductible : deux builds propres donnent les mêmes octets. Au 2026-11-27, il pèse 42 Ko (16 Ko compressé).


```
semantic-atlas-core/src/
  model/      graphe à couches (CSR), format neutre, export GraphML et JSON
  index/      nettoyage (à partir de sections fournies), découpage, empreintes, file
  embed/      interface Embedder, worker ONNX local, client HTTP (OpenAI-compatible, Ollama)
  search/     BM25, tokenisation FR/EN, kNN exact, HNSW, RRF
  analysis/   hubs, seuils en centiles, doublons, Leiden, consensus, hiérarchie,
              nommage c-TF-IDF, axes, centralités, rôles, temps, liens suggérés,
              comparaison de partitions, qualité
  layout/     ACP, t-SNE, UMAP, PaCMAP, Procruste, post-traitements, qualité
  physics/    simulation de forces 2D/3D (Barnes-Hut, alpha)
  render/     Canvas 2D, WebGL2, caméra, étiquettes, halos, sélection
  workers/    points d'entrée des workers, protocole de messages
  store/      interface KVStore + implémentation IndexedDB, format d'instantané
  rng/        xoshiro128** à graine
semantic-atlas/src/
  main.ts     cycle de vie, commandes, enregistrement des vues (rien de lourd)
  adapter/    lecture du vault -> format neutre (metadataCache, cachedRead)
  views/      Notes liées, Recherche, Paysage, Explorer, Relations, Structure, Qualité
  settings/   schéma versionné, migrations, onglet de réglages
  llm/        client optionnel, désactivé par défaut
  i18n/       en, fr
  platform/   thème (variables CSS -> palette), téléchargement du modèle, secrets
```

`analysis`, `layout`, `physics`, `search`, `model` et `index` n'utilisent ni DOM ni Obsidian. Ils tournent sous Node pour les tests. `render` et `store` utilisent le DOM, mais jamais Obsidian.

### 4.3 Format neutre d'entrée (contrat entre adaptateurs et cœur)

```ts
interface NoteInput {
  id: string;               // chemin normalisé, stable
  title: string;            // basename
  aliases: string[];
  folder: string;
  tags: string[];           // sans '#', hiérarchie conservée (a/b)
  dates: { created?: number; modified?: number; property?: number }; // ms epoch, absent != 0
  properties: Record<string, unknown>;
  text: string;             // contenu brut sans frontmatter
  sections: { kind: 'heading'|'paragraph'|'code'|'query'|'callout'|'list'|'table'|'math'|'other';
              start: number; end: number; heading?: string; level?: number }[];
  linkSpans: { start: number; end: number; display: string }[]; // pour remplacer [[x|y]] par y
}
interface EdgeInput {
  from: string; to: string;                // `to` = chemin résolu, ou cible brute si non résolue
  kind: 'link'|'embed'|'property'|'unresolved';
  syntax?: 'wiki'|'markdown';               // [[x]] ou [x](a/b.md)
  target?: 'note'|'image'|'pdf'|'canvas'|'base'|'other'; // type de la cible, pour les embeds
  anchor?: { kind: 'heading'|'block'; value: string };   // Note#Titre, Note#^id
  count: number;
  contexts?: string[];                      // mots autour de chaque occurrence (rétroliens, justification)
}
```

Compléments demandés par progressive-web-office et retenus :

- `sections` accepte aussi `{ kind: 'block', id }` pour les identifiants de bloc `^id`.
- `NoteInput` reçoit `frontmatterId?: string`.
- La **résolution** des cibles (alias multiples, noms ambigus selon le dossier) reste dans l'adaptateur : le cœur ne reçoit que des arêtes résolues, plus les non résolues.
- Les **dates** portent leur source : `dates.created`, par exemple, accompagné de `dateSources: { created: 'property'|'filename'|'filesystem' }`, puisque progressive-web-office n'a pas de date de création issue du système de fichiers.
- Les fichiers **JSON Canvas** sont des sources de graphe optionnelles. L'adaptateur les convertit en nœuds et `EdgeInput` (`kind: 'link'`, `syntax` absent).

Côté Obsidian, `sections`, `headings`, `links`, `embeds`, `frontmatterLinks` et `frontmatterPosition` viennent de `metadataCache.getFileCache`. Les arêtes viennent de `resolvedLinks` et `unresolvedLinks`. On n'écrit pas d'analyseur Markdown. Côté progressive-web-office, l'adaptateur remplit le même contrat à partir de son analyseur existant.

### 4.4 Flux de données

```
événements vault/metadataCache ─(anti-rebond 2 s)─> file d'indexation (fil principal, tranches ≤ 8 ms)
  cachedRead + getFileCache -> NoteInput ─transfert─> worker texte (nettoyage, découpage, empreinte, BM25)
                                                    └─> workers embeddings (ONNX) -> vecteurs
  vecteurs + arêtes -> worker analyse (kNN, hubs, Leiden, centralités, nommage, axes, temps, liens suggérés)
                   -> worker layout (ACP, t-SNE/UMAP/PaCMAP, Procruste, qualité)
                   -> worker physique (si > 300 nœuds) -> positions (tampons transférables)
  résultats -> KVStore (IndexedDB) [+ instantané optionnel] -> vues (rendu rAF)
```

Chaque résultat est mis en cache sous une clé égale à l'empreinte de ses entrées : modèle, paramètres, empreintes des notes, version de l'algorithme. Il n'est recalculé que si cette clé change.

### 4.5 Workers et chargement différé dans un seul `main.js`

- Le code de chaque worker est construit séparément par esbuild, puis intégré dans `main.js` comme **chaîne JS en clair** (pas de base64), et instancié à la demande par URL blob. L'URL est révoquée et le worker terminé dans `onunload`.
- Le fil principal ne fait qu'analyser des littéraux de chaîne, ce qui coûte peu. Le code lourd (analyse, projections, ONNX) n'est **jamais évalué** avant l'ouverture d'une vue qui en a besoin.
- Seul le binaire WASM réduit (D4) est encodé, en gzip puis base64. Il est décompressé dans le worker par `DecompressionStream('gzip')`, disponible sur iOS 16.4+ et dans Chromium.

---

## 5. Bibliothèques candidates et choix par brique

Depuis D13, les briques notées « maison » ci-dessous sont écrites en **Rust** dans `semantic-atlas-engine`, sauf BM25, la segmentation et le rendu, qui restent en TypeScript. Les oracles de test restent les mêmes : bibliothèques JS ou Python en développement, comparées au moteur par des tests croisés.

Règle générale : **peu de dépendances d'exécution**. Les bibliothèques de référence servent d'**oracles de test** (`devDependencies`), pas de code livré, quand il faut des garanties impossibles à obtenir d'elles : graine, démarrage à chaud, tableaux typés, connexité.

| Brique | Candidates (licence, taille min/gz, état) | Choix | Raison |
|---|---|---|---|
| Inférence | `onnxruntime-web` 1.31.1 (MIT, WASM 14,85 Mo brut / 3,8 Mo gz, actif) ; `@huggingface/transformers` 4.3.2 (Apache-2.0, 584/166 Ko, actif, **charge par défaut le runtime depuis jsDelivr**) | **onnxruntime-web, build réduit aux opérateurs** (D4) ; **pas** transformers.js | transformers.js n'apporte que le chargement et la tokenisation, et ses chemins par défaut appellent un CDN. On garde le contrôle total des octets chargés. |
| Tokeniseur | `@huggingface/tokenizers` 0.2.0 (Apache-2.0, 36/11 Ko, JS pur) ; `tokenizers` (natif Node, exclu) | **@huggingface/tokenizers** | JS pur, fonctionne en worker et sur mobile. Le `tokenizer.json` (17 à 25 Mo) est téléchargé avec le modèle. |
| Modèle | granite-r2-97m (Apache-2.0, q8 97,9 Mo) ; multilingual-e5-small (MIT, q8 118 Mo) ; paraphrase-multilingual-MiniLM (128 jetons max) ; embeddinggemma-300m (licence Gemma) ; jina-v3 (CC-BY-NC, exclu) ; bge-m3 (570 Mo, trop lourd) | **D5** | Voir 6.5. |
| kNN approché | `hnswlib-wasm` (Apache-2.0, figé depuis 2023) ; `edgevec` (MIT/Apache, 0,6 Mo WASM, jeune, mobile non vérifié) ; `hnsw` (MIT, TS pur, 2026-02) ; `usearch` (natif seulement, exclu) | **HNSW maison** en TS sur `Float32Array` ; `hnsw` comme oracle | Environ 400 lignes. Déterministe à graine fixe, sans WASM supplémentaire. Le rappel est mesuré de toute façon. |
| Graphe et métriques | `graphology` + `graphology-metrics` (MIT, actifs) ; `cytoscape` (lourd, sans Leiden) | **CSR maison** ; graphology-metrics comme oracle (PageRank, intermédiarité, modularité) | Formats creux imposés, coût d'objets évité pour 20 000 nœuds. |
| Leiden | `ngraph.leiden` 0.3.0 (MIT, anvaka, 2026-06, graine, CPM et modularité) ; `leiden-ts` 0.1.0 (MIT, 1 mainteneur) ; repackaging graphology (162 téléchargements/semaine) | **Réimplémentation** d'après Traag, Waltman et van Eck (2019) ; `ngraph.leiden` et des sorties de `leidenalg` comme oracles | Démarrage à chaud depuis une partition (stabilité dans le temps), consensus, CSR pondéré et garantie de connexité testée sont nécessaires. Aucun candidat ne les expose de façon vérifiée. Les candidats ont moins d'un an. |
| ACP | `ml-pca` (MIT, figé 2022) | **Maison** (itération de puissance ou SVD aléatoire) | 100 lignes, sert à l'initialisation des projections. |
| t-SNE | `tsne-js`, `tsne` (abandonnés) ; `@thi.ng/tsne` (Apache-2.0) ; `wasm-bhtsne` (MIT, confidentiel) | **Maison** : affinités creuses issues du kNN existant, Barnes-Hut, graine | Doit partir du graphe kNN déjà calculé, de l'ACP et des positions précédentes. |
| UMAP | `umap-js` (MIT sur npm mais Apache-2.0 sur GitHub : licence à clarifier ; graine ; `setPrecomputedKNN`) ; `ml-umap` (MIT, récent) | **Maison**, `umap-js` comme oracle | Initialisation par ACP, démarrage à chaud et moteur SGD commun avec PaCMAP. Évite l'ambiguïté de licence. |
| PaCMAP | `@saehrimnir/druidjs` (**LGPL-3.0**) ; `pacmap_tfjs` (tfjs-node, exclu) | **Maison** (Wang et al., 2021), druidjs comme oracle de dev uniquement | La LGPL dans un `main.js` minifié unique complique la conformité. L'algorithme est court. |
| Physique | `d3-force` (ISC, 2D) ; `d3-force-3d` (MIT) ; `ngraph.forcelayout` (MIT, v4 2026-11) | **Maison** en tableaux typés (SoA), modèle alpha calqué sur d3, quadtree et octree | Transferts sans copie vers le rendu, forces de cohésion et d'ancrage, déterminisme. `d3-force-3d` sert d'oracle de comportement. |
| Rendu | `three` (MIT, 742/186 Ko) ; `pixi.js` (995/282 Ko) ; `regl` (WebGL1) ; `sigma` 4 (graphology, fil principal) | **WebGL2 maison minimal** (points et segments instanciés, sélection par grille) + Canvas 2D pour les étiquettes | Environ 1 500 lignes contre 186 Ko gz pour three.js. Repli : three.js si le coût en 3D dérape (R9). |
| BM25 | `minisearch` 7.2 (MIT, 18/6 Ko, BM25+, sérialisable) ; `flexsearch` (pas BM25) ; `@orama/orama` (sans release depuis un an) ; `wink-bm25` (figé) | **minisearch** avec tokeniseur maison | BM25+ réglable, petit, `processTerm` extensible. |
| Segmentation et racinisation | `Intl.Segmenter` (natif) ; Snowball FR et EN : `snowball-stemmers-js` (BSD-3), `multilingual-stemmer` (MIT), `@orama/stemmers` (Apache-2.0) | `Intl.Segmenter` + **algorithmes Snowball FR et EN générés en JS depuis le projet Snowball officiel (BSD-3), intégrés au dépôt avec attribution** | Deux fichiers, aucune dépendance, la licence d'origine est respectée. |
| PRNG | `pure-rand` (MIT) ; `seedrandom` (abandonné) | **xoshiro128\*\* maison** | Déterminisme exact entre plateformes, 20 lignes. |
| Tests | `vitest` 5.1 (MIT) ; `fast-check` 4.11 (MIT) | **vitest + fast-check** | Tests unitaires et de propriétés hors Obsidian. |
| Lint | `eslint-plugin-obsidianmd` (MIT) | Config `recommendedWithLocalesEn` + `ui/sentence-case` activée | Zéro erreur exigé avant chaque release. |

Dépendances d'exécution prévues pour l'extension : `@semanticatlas/core`, qui embarque `onnxruntime-web` (build réduit), `@huggingface/tokenizers` et `minisearch`. C'est tout.

---

## 6. Décisions détaillées

### 6.1 D1 — Nom et identifiant

- **Semantic Atlas** / `semantic-atlas`. Aucune entrée identique parmi les 10 985 du registre au 2026-11-27. Noms voisins existants : « Semantic Map », « Knowledge Atlas », « Brain Atlas », « Atlas Explorer », « 3D Semantic Graph ». Le risque de confusion est jugé faible.
- Conforme à E5 et E6. L'identifiant est **définitif** une fois publié.

### 6.2 D2 — Licence

- **MIT** pour les cinq dépôts : simple, courante dans l'écosystème Obsidian, compatible avec l'AGPL de progressive-web-office.
- Alternative : Apache-2.0, qui ajoute une clause de brevets mais impose de tenir un fichier NOTICE.
- Attributions à mettre dans le README :
  - onnxruntime-web (MIT) ;
  - @huggingface/tokenizers (Apache-2.0) ;
  - minisearch (MIT) ;
  - algorithmes Snowball (BSD-3) ;
  - modèle choisi : Apache-2.0 pour granite, MIT pour e5. Le modèle est une donnée téléchargée, pas une partie de la release.
- Le vault de référence dérivé de Wikipédia (section 8) est sous **CC BY-SA 4.0**. Il reste dans `tests/fixtures/` et n'est jamais distribué dans une release.

### 6.3 D3 — Dépôts

Voir 4.1. Les cinq dépôts existent depuis le 2026-11-27.

### 6.4 D4 — Moteur d'inférence (le point le plus délicat)

**Constat.** Le WASM standard d'ONNX Runtime pèse 14,85 Mo, soit environ 20 Mo en base64. Il est impossible de l'intégrer à `main.js` (E23). Obsidian n'installe que `main.js`, `manifest.json` et `styles.css`. Télécharger ce WASM à l'exécution reviendrait à télécharger du **code exécutable**, ce qui se rapproche le plus de l'interdiction « install their dependencies », même si des extensions listées le font.

| Option | Code exécutable téléchargé ? | `main.js` | Effort | Verdict |
|---|---|---|---|---|
| a. WASM ORT complet intégré | non | ~20 Mo | faible | **Rejetée** (E23, démarrage) |
| b. **ORT compilé avec les seuls opérateurs du modèle** (`--include_ops_by_config`, types réduits), intégré en gzip + base64 | **non** | +1 à 2 Mo (estimation, à mesurer en S1) | moyen : build Emscripten dans la CI du cœur, attesté | **Recommandée** |
| c. WASM ORT officiel téléchargé après consentement, version et SHA-256 figés | **oui** | ~0,5 Mo | faible | Rejetée : télécharge du code exécutable. |
| d. Moteur maison (TS + noyaux WASM SIMD écrits à la main, architecture d'encodeur fixe) | non | +0,1 Mo | élevé (2 à 3 semaines, parité numérique à prouver) | Repli si b échoue |
| e. Fournisseur externe uniquement (Ollama, OpenAI-compatible) | non | — | faible | Toujours disponible en option, jamais par défaut |
| f. Moteur Rust **Candle** (Hugging Face, MIT/Apache-2.0) compilé en WASM, poids au format safetensors | non | taille à mesurer (non vérifiée) | moyen | Candidat évalué en S1 à côté de b |

Ce que l'option **b** préserve :

- Tout code exécuté est dans la release analysée.
- Seuls les **poids et le tokeniseur** (des données, pas du code) se téléchargent.

Le spike **S1** (2 jours, début de phase 1) mesure la taille du build réduit pour les deux modèles candidats et vérifie qu'il est reproductible. S1 mesure aussi l'option **f**. On retient la plus petite des deux qui passe la parité numérique (cosinus ≥ 0,999 contre la référence fp32) et la vitesse. Critère de succès : WASM gzip ≤ 1,5 Mo et `main.js` total ≤ 3 Mo. En cas d'échec des deux, on passe à **d**.

Paramètres d'exécution :

- **Un seul fil par session**, car Obsidian n'est probablement pas « cross-origin isolated » (à vérifier en S4 via `self.crossOriginIsolated`).
- Le parallélisme vient de **plusieurs workers** : 2 par défaut sur bureau, réglable de 1 à 4.
- WebGPU est écarté en v1 : son WASM fait 29,5 Mo, ce qui est incompatible avec l'option b. Il pourra être réévalué plus tard.

### 6.5 D5 — Modèle par défaut

| | granite-embedding-97m-multilingual-r2 | multilingual-e5-small |
|---|---|---|
| Licence | Apache-2.0 | MIT |
| Taille q8 + tokeniseur | 97,9 Mo + 25 Mo | 118 Mo + 17 Mo |
| Dimensions | 384 | 384 |
| Fenêtre | 32 768 (on découpe à 256 ou 512 pour le coût) | 512 |
| Préfixes | aucun (pooling CLS) | `query: ` / `passage: ` obligatoires |
| Recherche MMTEB (chiffres IBM, non vérifiés indépendamment) | 60,3 | 50,9 |
| Architecture | ModernBERT (rotary, GeGLU, attention locale et globale) : plus d'opérateurs | BERT / XLM-R classique : moins d'opérateurs, ce qui aide les options b et d |
| Recul dans les navigateurs | récent (2026-06) | long |

**Recommandation** : granite-r2 par défaut **si** le spike **S2** confirme sur le vault de référence :

- le rappel à 10 FR, EN et croisé ;
- une vitesse par bloc ≤ 1,2 fois celle d'e5 ;
- une parité q8 contre fp32 (cosinus moyen ≥ 0,99).

Sinon, e5-small. Les deux restent déclarés dans un **registre de modèles** du cœur (identifiant, révision, fichiers, SHA-256, taille, licence, préfixes, pooling). Changer de modèle reconstruit l'index.

### 6.6 D6 — Protocole de téléchargement du modèle

1. **Aucun téléchargement sans clic.** Une fenêtre affiche : nom, URL exactes (`https://huggingface.co/<dépôt>/resolve/<commit>/…`), taille totale, licence avec lien, espace disque requis, et le fait que rien d'autre ne sera envoyé (la requête ne contient que l'URL publique).
2. **Révision figée** : un hash de commit Hugging Face dans le registre du code, jamais `main`. **SHA-256** de chaque fichier figé dans le code et vérifié par `SubtleCrypto` avant usage. En cas d'écart, le fichier est supprimé et l'erreur affichée.
3. **Transport** : `requestUrl` par tranches de 8 Mo avec en-tête `Range`. On obtient une progression dans la barre d'état, une reprise après interruption et une mémoire bornée. Prise en charge de `Range` derrière les redirections de Hugging Face (CDN Xet) **à vérifier en S3**. Repli : téléchargement entier sans progression fine.
4. **Stockage** dans IndexedDB (magasin `models`), hors du vault et local à l'appareil.
5. **Jamais de mise à jour silencieuse.** Un nouveau modèle ne peut arriver qu'avec une nouvelle version de l'extension, donc une release analysée. Il est proposé, jamais imposé, et l'ancien reste utilisable jusqu'au choix de l'utilisateur.
6. **Hors ligne** :
   - sélection des fichiers sur le disque via `<input type=file>` ;
   - ou lecture dans un dossier du vault indiqué par l'utilisateur (`vault.readBinary`).
   Dans les deux cas, les SHA-256 sont vérifiés.
7. **README** : rubrique « Réseau » listant les hôtes (`huggingface.co` et ses CDN de redirection, à relever précisément en S3), quand, pourquoi, quelles données. Rubrique « Fournisseurs externes » pour l'option LLM ou embeddings HTTP.

### 6.7 D7 — Stockage de l'index

| Option | Synchronisé | Mobile | Verdict |
|---|---|---|---|
| IndexedDB par vault | non (local à l'appareil) | oui, mais **peut être évincé** (iOS : quota de 15 % du disque par origine, éviction LRU) | **Stockage principal**, traité comme un cache reconstructible |
| Dossier de l'extension (`manifest.dir`, sous `configDir`) | Sync : seulement si l'utilisateur synchronise les extensions ; fichiers supplémentaires **non fiables** (signalements de suppression sur iPad) ; limite de 5 Mo par fichier en Standard | — | **Rejetée** |
| Dossier caché du vault | non vu par l'API `Vault`, non synchronisé par Sync | — | **Rejetée** |
| Dossier visible du vault | oui (Sync avec « tous les autres types », iCloud, Syncthing) | oui | **Instantané optionnel** |

Fonctionnement retenu :

- **Clé de vault** : un UUID aléatoire mémorisé par `app.saveLocalStorage` (propre au vault et à l'appareil, @since 1.8.7). Aucune API non documentée comme `app.appId`. Bases nommées `semantic-atlas/<clé>/index` et `semantic-atlas/models` (cette dernière partagée entre vaults).
- **Instantané** (désactivé par défaut, nécessaire pour que le mobile lise les calculs du bureau) :
  - dossier configurable, par défaut `Semantic Atlas/`, visible ;
  - fichiers binaires `.satl` en éclats ≤ 4 Mo, plus un manifeste `atlas.json` ;
  - contenu : vecteurs de notes en int8 avec échelle, graphe kNN, clusters, noms, positions des projections, mesures ;
  - les vecteurs de blocs ne sont pas inclus, pour limiter la taille.
- **Écritures atomiques** :
  - IndexedDB : une transaction par lot ;
  - instantané : écriture d'une nouvelle génération d'éclats (`gen-<n>-*.satl`), puis du manifeste en dernier via `vault.process`, puis mise à la corbeille de l'ancienne génération ;
  - un lecteur ne suit que le manifeste et vérifie le SHA-256 de chaque éclat.
- **Format versionné** :
  - en-tête binaire : magique `SATL`, version du format, identifiant et SHA du modèle, empreinte des paramètres ;
  - toute incompatibilité de version, de modèle ou de paramètres entraîne une reconstruction propre, jamais une lecture partielle ;
  - le format est documenté dans `docs/ARCHITECTURE.md` du cœur.
- **Données de l'utilisateur** (épinglages, masquages, verdicts sur les liens suggérés, noms de clusters donnés à la main, axes) : dans `data.json`, petit, synchronisé avec les réglages, versionné et migré. Elles ne sont jamais dans le cache évinçable.
- **Commande « Effacer toutes les données de l'extension »** avec confirmation détaillée :
  - suppression des bases IndexedDB du vault ;
  - option de suppression du modèle ;
  - mise à la corbeille de l'instantané (`fileManager.trashFile`) ;
  - option séparée « réinitialiser aussi les réglages et mes jugements ».

### 6.8 D8 — `minAppVersion`

**1.11.4** (sortie le 2026-01-12). C'est la plus petite version qui couvre toutes les API prévues :

- `SecretStorage` 1.11.4 ;
- `getLanguage` 1.8.7 ;
- `loadLocalStorage` 1.8.7 ;
- `getFileByPath` 1.5.7 ;
- `onExternalSettingsChange` 1.5.7 ;
- `revealLeaf` asynchrone 1.7.2 ;
- `isDeferred` 1.7.2 ;
- `onUserEnable` 1.7.2 ;
- `trashFile` 1.6.6 ;
- `processFrontMatter` 1.4.4 ;
- `vault.process` 1.1.0.

La règle `no-unsupported-api` le vérifie en CI. Alternative : 1.13.0, pour les réglages déclaratifs avec recherche, mais cela exclut les installations antérieures à juillet 2026.

### 6.9 D9 — Modularité ou CPM

- **Problème.** La modularité a une limite de résolution : dans un graphe de m arêtes, des communautés de moins d'environ √(2m) arêtes internes peuvent être fusionnées. Dans un vault de 20 000 notes, cela cache les petits thèmes. Le CPM n'a pas cette limite, mais sa résolution γ dépend de l'échelle des poids.
- **Proposition.** CPM par défaut, avec γ exprimé relativement à la densité pondérée du graphe kNN : γ = c · (W / (n(n−1)/2)), le curseur réglant c. Une échelle de γ donne les 2 ou 3 niveaux de la hiérarchie. La modularité reste calculée et affichée comme mesure de qualité.
- **Expérience de décision (phase 2)** :
  - AMI sur le vault de référence ;
  - LFR à n = 1 000 et 5 000 ;
  - test des **petits thèmes plantés** : 3 thèmes de 8 notes dans un vault synthétique de 5 000 notes.
- **Règle.** On garde le CPM s'il gagne au moins 0,02 d'AMI **et** retrouve les petits thèmes. Sinon, modularité avec résolution, dont la sémantique du curseur est plus simple. Le choix final est documenté dans `METRICS.md`.

### 6.10 D10 — Mobile

| Fonction | Bureau | Mobile (par défaut) |
|---|---|---|
| Indexation complète, embeddings des notes | oui (workers) | non |
| Lecture de l'instantané du bureau | oui | **oui** si activé et synchronisé |
| Notes liées | modèle local | à partir des vecteurs de l'instantané (aucun modèle nécessaire) |
| Recherche | hybride | **BM25 local** + expansion : voisins sémantiques des meilleurs résultats BM25 via les vecteurs de l'instantané |
| Recherche sémantique libre | oui | seulement avec un modèle local (opt-in, déconseillé sous 6 Go de RAM) ou un fournisseur externe |
| Clusters, cartes, structure | calcul + affichage | **affichage** de l'instantané ; pas de recalcul |
| Physique libre | 2D/3D | 2D, ≤ 1 000 nœuds, pas de halo, 30 Hz |
| Sans instantané | — | mode réduit : BM25, graphe des liens (vue Relations), notes liées par liens et tags |

### 6.11 D11 — Vue « Relations »

Voir 2.1. Elle arrive en **phase 5** avec la physique 2D. Son équivalent en tableau arrive dès la **phase 3**.

### 6.12 Autres choix techniques à valider

- **Vecteur de note** : v = norme(α·titre+alias + (1−α)·Σ wᵢ·blocᵢ / Σ wᵢ), avec wᵢ = nombre de jetons du bloc. α est choisi en phase 1 parmi {0 ; 0,15 ; 0,3 ; 0,5} par le rappel à 10 sur le vault de référence.
- **Découpage** : par section (`sections` et `headings` du cache), 256 jetons maximum par défaut, recouvrement de 32. La troncature est **détectée** (nombre de jetons après tokenisation), jamais subie.
- **Centrage** (anisotropie) : gardé seulement s'il améliore le rappel à 10 d'au moins 0,01 sur le vault de référence.
- **Hubs** : asymétrie de la distribution des k-occurrences. Si elle dépasse 1,5 (seuil initial à valider), on applique la mise à l'échelle locale ou SNN, sans retenir d'avance l'une ou l'autre. Choix final par le rappel et l'AMI en phase 2.
- **Seuils en centiles** : distribution estimée sur 20 000 paires tirées au hasard à graine fixe. Quasi-doublons au-dessus du 99,9ᵉ centile **et** à un cosinus ≥ 0,95. Les deux conditions évitent les faux positifs sur les petits vaults.
- **k du kNN** : clamp(round(√n), 5, 15). kNN exact jusqu'à 5 000 notes, HNSW au-delà, rappel mesuré sur 500 requêtes.
- **Recherche** : RRF avec k = 60. Tokenisation par `Intl.Segmenter`, minuscules, pliage des accents pour la correspondance, mots vides FR et EN, racinisation Snowball selon la langue du bloc (heuristique par mots vides, repli sur les deux).
- **LLM (optionnel, phase 6)** : une requête JSON non diffusée en continu par `requestUrl`, réponse validée par schéma, clé dans `SecretStorage`, jamais journalisée.
- **Minimums statistiques** (valeurs initiales, chacune avec sa fiche dans `METRICS.md`) :
  - 5 voisins datés pour « précurseur » et « activité récente » ;
  - 8 notes pour une moyenne par cluster ;
  - 30 notes pour une silhouette ;
  - 100 notes pour AMI et ARI entre partitions.
  En dessous : « données insuffisantes ».

---

## 7. Budget chiffré

**Machine de référence** : portable 8 cœurs (2022-2023, classe Apple M1 ou Intel i7-1260P), 16 Go, Obsidian 1.15 bureau. **Mobiles de référence** : iPhone 13, Pixel 7.
**Hypothèses (estimation)** :

- note moyenne de 2 blocs de 256 jetons ;
- environ 150 ms par bloc et par worker (WASM SIMD, int8, un fil) ;
- 2 workers d'embeddings ;
- graphe kNN ≤ 15·n arêtes avant symétrisation.

Les valeurs ci-dessous sont des **ordres de grandeur** à remplacer par les mesures du banc de phase 1.

### 7.1 Temps par étape (bureau)

| Étape | 1 000 notes | 5 000 notes | 20 000 notes | Où |
|---|---|---|---|---|
| Lecture (`cachedRead`) + conversion | 1 s | 5 s | 20 s | fil principal, tranches ≤ 8 ms |
| Nettoyage, découpage, empreintes, BM25 | 1 s | 5 s | 20 s | worker texte |
| **Embeddings, première indexation** | **~3 min** | **~13 min** | **~50 min** | 2 workers ; interruptible, reprend où il s'est arrêté |
| Embeddings, une note modifiée | 0,3 à 0,6 s | idem | idem | worker |
| kNN | 0,3 s (exact) | 6 s (exact) | 20 s (HNSW) + 5 s (mesure du rappel) | worker analyse |
| Centiles, hubs, doublons | < 1 s | 1 s | 3 s | worker analyse |
| Leiden : 10 graines × 3 niveaux + consensus | 1 s | 8 s | 45 s | worker analyse |
| Centralités (intermédiarité exacte ≤ 2 000 nœuds, sinon 512 sources) | < 1 s | 2 s | 8 s | worker analyse |
| Nommage c-TF-IDF, axes, signaux temporels | < 1 s | 1 s | 4 s | worker analyse |
| Liens suggérés + justification | < 1 s | 3 s | 12 s | worker analyse |
| t-SNE 2D | 3 s | 20 s | 60 s (échantillon de 10 000 + placement du reste) | worker layout |
| UMAP ou PaCMAP 2D | 2 s | 10 s | 35 s | worker layout |
| Qualité des projections (échantillon de 2 000) | < 1 s | 2 s | 4 s | worker layout |
| Recalcul après modifications (démarrage à chaud) | 1 s | 5 s | 20 s | après 30 s d'inactivité |

### 7.2 Mémoire et disque

| | 1 000 | 5 000 | 20 000 |
|---|---|---|---|
| Workers d'embeddings (2 × ~200 Mo : modèle + tokeniseur + activations) | ~400 Mo | ~400 Mo | ~400 Mo |
| Données d'analyse (vecteurs, CSR, layouts, index BM25) | ~15 Mo | ~60 Mo | ~220 Mo |
| **Pic total pendant l'indexation** | ~0,45 Go | ~0,5 Go | ~0,65 Go |
| Au repos, vues fermées (workers terminés) | < 20 Mo | < 50 Mo | < 150 Mo |
| IndexedDB (hors modèle) | ~8 Mo | ~35 Mo | ~130 Mo |
| Modèle (une fois par appareil) | 123 Mo (granite) ou 135 Mo (e5) | | |
| Instantané (si activé) | ~1 Mo | ~4 Mo | ~15 Mo |

Les workers d'embeddings sont **terminés** dès que la file est vide. Ils ne consomment rien au repos.

### 7.3 Bundle et démarrage

| | Cible | Plafond dur |
|---|---|---|
| Code du fil principal (minifié) | ≤ 250 Ko | — |
| Workers intégrés en chaînes (analyse, layout, physique, texte) | ≤ 400 Ko | — |
| ONNX (JS) + WASM réduit (gzip + base64) | ≤ 2 Mo | — |
| **`main.js` total** | **≤ 3 Mo** | **< 5 Mo** (E23) |
| `styles.css` | ≤ 30 Ko | — |
| Temps ajouté au démarrage d'Obsidian (médiane de 10 lancements, avec et sans l'extension) | ≤ 20 ms bureau, ≤ 60 ms mobile | 50 ms bureau |
| Travail dans `onload` | ≤ 5 ms (enregistrements seulement) | — |
| Tâches longues > 50 ms sur le fil principal | 0 | 0 |

### 7.4 Rendu

| Scénario | Cible |
|---|---|
| Canvas 2D, 2 000 nœuds, physique active | 60 i/s |
| WebGL2, 5 000 nœuds, physique en worker | 30 i/s |
| WebGL2, 20 000 nœuds | 30 i/s **statique** ; physique dégradée (regroupement par cluster) ≥ 15 i/s, sans engagement |
| Mobile, 1 000 nœuds, 2D | 30 i/s |
| Au repos (refroidi ou masqué) | 0 image, 0 timer actif |

---

## 8. Plan d'évaluation

### 8.1 Vault de référence

- **Source** : environ 500 introductions d'articles de **Wikipédia** FR et EN (CC BY-SA 4.0), réparties dans 10 catégories connues. Les catégories donnent les **thèmes de vérité**. Exemple : astronomie, cuisine, jazz, botanique, droit, informatique, Antiquité romaine, alpinisme, impressionnisme, cryptographie.
  - Environ 40 % des articles sont en français, 40 % en anglais, et 20 % forment des paires d'articles équivalents dans les deux langues, pour tester la recherche croisée.
  - Les **liens réels** entre articles du corpus sont conservés : c'est la vérité pour la prédiction de liens masqués.
  - Un vault généré de toutes pièces n'aurait pas de vraie sémantique. Wikipédia apporte un texte naturel **et** un graphe de liens réel.
- **Perturbations injectées par script à graine fixe** :
  - 15 quasi-doublons (copie avec 5 à 10 % de mots changés) ;
  - 10 notes vides ou de moins de 20 mots ;
  - 15 noms de fichiers à caractères spéciaux (espaces, accents, `#`, `^`, `[`, emoji, très longs) ;
  - 10 frontmatters invalides ;
  - dates de création réparties sur 6 ans, avec 5 % de dates très anciennes et 10 % de notes sans date ;
  - 5 % de liens supprimés aléatoirement (le vault reste « partiellement lié ») ;
  - 3 dossiers qui contredisent les thèmes, pour le panneau Structure ;
  - 2 « hubs » génériques (« Index », « À lire »).
- **Production** : script de dev `scripts/build-reference-vault.mjs`. Il utilise le réseau **au moment du dev uniquement**, sur un instantané daté de l'API Wikipédia figé dans le dépôt. Le résultat est commis dans `tests/fixtures/reference-vault/` avec attribution. Les **requêtes de test** (≥ 150, FR, EN et croisées) sont écrites à la main à partir des catégories et des titres. Les jugements de pertinence sont commis avec elles.
- **Petits vaults synthétiques** pour l'échelle (5 000 et 20 000 notes) : duplication et paraphrase contrôlées du vault de référence, plus des graphes plantés. Ils servent aux mesures de performance, pas à la qualité.

### 8.2 Graphes de référence et seuils

| Test | Mesure | Seuil de réussite |
|---|---|---|
| Karaté de Zachary | modularité de Leiden | ≥ 0,415 (optimum connu 0,4198) |
| Karaté | ARI contre les deux factions (résolution réglée pour obtenir 2 communautés) | ≥ 0,77 |
| Partition plantée (n = 1 000, 10 groupes, p_in/p_out = 20) | ARI | ≥ 0,95 |
| LFR (n = 1 000, μ = 0,3) | ARI | ≥ 0,90 |
| LFR (n = 1 000, μ = 0,5) | ARI | ≥ 0,70 |
| Toutes les sorties de Leiden | communautés connexes | 100 % |
| PageRank, intermédiarité, k-core (petits graphes, valeurs NetworkX en fixtures) | écart absolu | ≤ 1e−6 (k-core et intermédiarité exacte : égalité) |

Les fixtures LFR et les valeurs NetworkX ou `leidenalg` sont produites par un script Python de dev. Seuls les **résultats** (données) sont commis, pas le code GPL de `leidenalg`.

### 8.3 Seuils sur le vault de référence

| Mesure | Seuil initial |
|---|---|
| Clusters contre thèmes : AMI | ≥ 0,65 |
| Recherche hybride : rappel à 10 / MRR | ≥ 0,85 / ≥ 0,65, et hybride ≥ meilleur mode seul |
| Recherche croisée FR→EN et EN→FR : rappel à 10 | ≥ 0,70 |
| Doublons probables : rappel / précision | ≥ 0,90 / ≥ 0,90 |
| Liens masqués (20 % des liens existants) : AUC du score combiné | ≥ 0,85 ; **la combinaison n'est gardée que si elle bat le cosinus seul d'au moins 0,02 d'AUC** et ne perd pas en précision à 50 |
| HNSW contre exact : rappel à k | ≥ 0,95 |
| Projections : trustworthiness à 10 | t-SNE ≥ 0,90 ; UMAP et PaCMAP ≥ 0,85 |
| Projections : continuité à 10 / préservation des 10 voisins | ≥ 0,85 / ≥ 0,35 |
| Stabilité de la carte après +5 % de notes (après Procruste) | écart moyen ≤ 5 % du diamètre |
| Stabilité des clusters après +5 % de notes | ≥ 90 % des notes gardent leur identifiant (après appariement) ; ≥ 90 % des noms conservés |
| Consensus | stabilité par cluster affichée ; un cluster sous 0,6 d'accord est marqué « instable » |

### 8.4 Simulation

| Mesure | Seuil |
|---|---|
| Énergie cinétique | décroissante sur ≥ 95 % des pas une fois α < 0,3 ; arrêt en ≤ 300 pas sans interaction |
| Cohésion 0 → 1 | rapport des distances intra/inter cluster en baisse d'au moins 30 % |
| Ancrage = 1 | écart moyen à la projection ≤ 2 % du diamètre |
| Déterminisme | positions identiques au bit près à graine et entrées égales |

### 8.5 Propriétés (fast-check)

- invariance à la permutation des nœuds (partitions à l'étiquetage près, centralités) ;
- connexité des communautés ;
- qualité de Leiden non décroissante entre itérations ;
- symétrie du graphe sémantique ;
- déterminisme à graine fixe ;
- absence de NaN et d'Infinity ;
- valeurs manquantes jamais converties en 0 ;
- aller-retour sans perte du format d'instantané et migrations des réglages (toutes les versions passées vers la courante).

### 8.6 Performance et cycle de vie

- **Banc automatisé** (`just bench`) : mesure chaque ligne de la section 7 sur les vaults de 1 000, 5 000 et 20 000 notes, et échoue si un plafond dur est dépassé.
- **Tâches longues** : un `PerformanceObserver('longtask')` en mode débogage.
- **Cycle de vie** : test automatisé qui compte workers, écouteurs, minuteurs, contextes WebGL et URL blob avant et après `onunload`. Procédure manuelle dans `docs/TESTING.md` :
  - 10 activations et désactivations ;
  - fenêtre détachée ;
  - changement de thème ;
  - 1 000 renommages ou suppressions ;
  - vault vide ;
  - vault de 20 000 notes ;
  - iOS et Android.

---

## 9. Risques et replis

| # | Risque | Probabilité | Repli |
|---|---|---|---|
| R1 | Le build ORT réduit dépasse 1,5 Mo gz ou n'est pas reproductible | moyenne | Option d (moteur maison) ; sinon e5-small (moins d'opérateurs) |
| R2 | L'annuaire juge que télécharger des poids de modèle relève de « install dependencies » | faible à moyenne | Analyse de prévisualisation dès que le téléchargement existe ; mode « fournisseur externe ou import manuel uniquement » prêt dès la phase 1 |
| R3 | Base64 ou WASM intégré signalé comme obscurcissement par l'analyseur | moyenne | Source et script de build du WASM publiés dans le cœur, attestation npm ; explication dans le README ; preview scan dès la phase 1 |
| R4 | Embeddings trop lents (> 2 h pour 20 000 notes) | moyenne | Blocs de 128 jetons, 3 à 4 workers, indexation par priorité (note active et notes récentes d'abord), fournisseur Ollama local documenté |
| R5 | Mémoire mobile : crash avec modèle local | élevée | Pas de modèle local par défaut sur mobile (D10) |
| R6 | IndexedDB évincée sur iOS | moyenne | Cache reconstructible, instantané du vault, données de l'utilisateur dans `data.json` |
| R7 | `Range` non pris en charge derrière les redirections de Hugging Face | moyenne | Téléchargement entier ; import manuel |
| R8 | Workers blob ou WASM bloqués sur une version mobile | faible | Repli sur le fil principal découpé en tranches pour BM25 et analyse légère ; pas d'embeddings |
| R9 | WebGL maison trop coûteux à mener en 3D | moyenne | three.js chargé par le worker de rendu (+186 Ko gz), dans la limite de 5 Mo |
| R10 | Leiden maison incorrect | faible (tests oracles) | `ngraph.leiden` adopté derrière la même interface si les tests passent et que le démarrage à chaud est possible ; sinon pas de livraison (jamais Louvain) |
| R11 | Seuils de qualité non atteints (AMI, AUC) | moyenne | Résultats publiés tels quels, analyse des causes, proposition de suite. Les seuils ne sont abaissés qu'avec une justification écrite et ta validation. |
| R12 | Multi-dépôts : friction entre le cœur et l'extension | moyenne | Versions 0.x rapides, `npm link` en dev, CI de l'extension contre la branche principale du cœur |
| R13 | `main.js` > 5 Mo | faible | Budget vérifié en CI (échec si > 4,5 Mo) |
| R14 | Licence `umap-js` ambiguë (MIT ou Apache-2.0) | — | Oracle de test uniquement, jamais livré |

---

## 10. Plan de phases révisé

| Phase | Contenu | Démonstration de fin |
|---|---|---|
| **1a** | Création des dépôts (après validation). Squelettes : build esbuild reproductible, ESLint officiel, Vitest, CI (lint, types, tests, build, taille, reproductibilité), release par tag avec attestation, justfile, CHANGELOG, `docs/`, `llms.txt`. | CI verte, preview scan sans erreur |
| **1b — spikes** | **S1** taille et reproductibilité du WASM ORT réduit ; **S2** banc granite contre e5 ; **S3** téléchargement HF avec `Range` via `requestUrl` ; **S4** workers blob + WASM + IndexedDB sur iOS et Android, `crossOriginIsolated`. Rapport court, mise à jour des sections 6 et 7. | Rapport des spikes |
| 1c | Format neutre, adaptateur Obsidian, index, embeddings locaux, Notes liées, recherche hybride, note au hasard | Vault de référence : rappel à 10, MRR, temps d'indexation |
| 2 | Graphe sémantique corrigé, Leiden + consensus + hiérarchie, CPM contre modularité (D9), nommage, axes, centralités, rôles | AMI, LFR, stabilité |
| 3 | Paysage (4 onglets statiques), Qualité de l'analyse, **tableau d'adjacence de Relations** | — |
| 4 | Explorer 2D : projections, liens, signaux, liens suggérés évalués, dérive, sous-cartes | AUC, trustworthiness |
| 5 | Physique libre 2D, **vue Relations** (locale et globale) | i/s, énergie, cohésion, ancrage |
| 6 | Espace 3D, panneau Structure, LLM optionnel, mobile ; **composant `semantic-atlas-pwo`** et intégration dans progressive-web-office | — |
| 7 | Documentation, captures (5 bureau 1200×800, 5 mobile 900×1600), déclarations, site, preview scan, soumission | — |

Chaque phase se termine par un bilan : ce qui marche, ce qui manque, mesures face aux cibles, écarts à la spec.

---

## 11. Points de méthode (arbitrés le 2026-11-27)

1. **`.gitignore`** au format « gitallow » : créé (tout est ignoré, puis ré-autorisé explicitement).
2. **Consignes Julia** du fichier `AGENTS.md` : sans objet. TDD avec **Vitest** et **fast-check**.
3. **Mention d'IA dans les commits et PR** : `Assisted-by: AI`, sans nom de modèle ni `Co-Authored-By`.
4. **Coordination avec progressive-web-office** : établie, réponse intégrée en 2.3 et 4.3.
5. **Aucune démarche publique** auprès de l'équipe de l'annuaire. La conformité se vérifie avec ESLint officiel et l'analyse de prévisualisation.
