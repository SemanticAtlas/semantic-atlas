/**
 * Runs the analysis of the vault (clusters, names, roles, map, quality) in a worker, after the
 * semantic index is ready and some time after it last changed. Keeps the result in memory and a
 * snapshot in the index database, so that identifiers, names and the map stay stable.
 */
import { TFile, getAllTags, type App } from 'obsidian';
import { pairKey, scoreAxes, tokenize } from '@semanticatlas/core';
import { AnalysisClient, type AnalysisResult, type Axis } from '@semanticatlas/core';
import engineWasm from '@semanticatlas/engine/engine.wasm';
import analysisWorkerCode from 'virtual:analysis-worker';
import type { IndexingService } from '../indexing/service';
import type { Logger } from '../log';
import type { AnalysisSettings, IndexSettings, Judgement, ManualName, Verdict } from '../settings/schema';
import { sharedWords, type NoteFacts } from '../explorer/variables';
import { collectRelations } from '../adapter/collect';
import { linkResolver, readNotes } from '../adapter/vault';
import { docOf, type NoteDoc } from './docs';
import { applyNames, nameCluster, toPrevious, toSnapshot } from './snapshot';

export type AnalysisPhase = 'idle' | 'waiting' | 'running' | 'ready' | 'skipped' | 'error';

export interface AnalysisState {
	phase: AnalysisPhase;
	/** Reason when skipped, message when failed. */
	message: string;
	/** Duration of the last run (milliseconds). */
	ms: number;
	/** When the last run ended (epoch milliseconds). */
	at: number;
}

export interface AnalysisDeps {
	app: App;
	index: IndexingService;
	settings: () => AnalysisSettings;
	indexSettings: () => IndexSettings;
	/** Saves the names given by hand (settings). */
	saveNames: (names: ManualName[]) => Promise<void>;
	/** Saves the judged suggestions (settings). */
	saveJudged: (judged: Judgement[]) => Promise<void>;
	log: Logger;
}

/** First run after start-up, then after the index stopped changing for this long. */
const FIRST_DELAY = 3000;
const CHANGE_DELAY = 30_000;
const MAX_TEXT = 2000;

const parseDate = (value: unknown): number | undefined => {
	if (typeof value !== 'string' && typeof value !== 'number') return undefined;
	const t = typeof value === 'number' ? value : Date.parse(value);
	return Number.isFinite(t) ? t : undefined;
};

export class AnalysisService {
	private state: AnalysisState = { phase: 'idle', message: '', ms: 0, at: 0 };
	private current: AnalysisResult | null = null;
	private readonly listeners = new Set<(s: AnalysisState) => void>();
	private timer: number | null = null;
	private running = false;
	private again = false;
	private stopped = false;
	private analysedRevision = -1;
	private client: AnalysisClient | null = null;
	private workerUrl: string | null = null;
	private readonly axisCache = new Map<string, Float32Array>();
	/** Text of each analysed note (title and start of the body) and word document frequencies. */
	private texts = new Map<string, string>();
	private docFreq = new Map<string, number>();

	constructor(private readonly deps: AnalysisDeps) {}

	getState(): AnalysisState {
		return this.state;
	}

	result(): AnalysisResult | null {
		return this.current;
	}

	onChange(listener: (s: AnalysisState) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private set(patch: Partial<AnalysisState>): void {
		this.state = { ...this.state, ...patch };
		for (const l of this.listeners) l(this.state);
	}

	/** Called whenever the index changes: schedules a run once it is ready and has changed. */
	indexChanged(): void {
		const { index } = this.deps;
		if (this.stopped || !index.isReady() || index.revision() === this.analysedRevision) return;
		this.schedule(this.current ? CHANGE_DELAY : FIRST_DELAY);
	}

	schedule(delay: number): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		if (this.state.phase !== 'running') this.set({ phase: 'waiting' });
		this.timer = window.setTimeout(() => {
			this.timer = null;
			void this.run();
		}, delay);
	}

	/** Runs now (or right after the current run). */
	async run(): Promise<void> {
		if (this.stopped) return;
		if (this.running) {
			this.again = true;
			return;
		}
		const { index, log } = this.deps;
		if (!index.isReady()) return;
		this.running = true;
		this.set({ phase: 'running', message: '' });
		try {
			do {
				this.again = false;
				const revision = index.revision();
				const { result, ms } = await this.analyse();
				if (this.stopped) return;
				this.current = result;
				this.analysedRevision = revision;
				if (result.skipped) {
					this.set({ phase: 'skipped', message: result.skipped, ms, at: Date.now() });
				} else {
					const names = applyNames(result, this.deps.settings().names);
					await index.indexStore()?.setAnalysis(toSnapshot(result, Date.now()));
					await this.saveNamesIfChanged(names);
					log.debug(`analysis: ${result.notes.size} notes, ${result.clusters.length} clusters in ${Math.round(ms)} ms`);
					this.set({ phase: 'ready', message: '', ms, at: Date.now() });
				}
			} while (this.again && !this.stopped);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log.error(`analysis: ${message}`);
			this.set({ phase: 'error', message });
		} finally {
			this.running = false;
		}
	}

	private async saveNamesIfChanged(names: ManualName[]): Promise<void> {
		if (JSON.stringify(names) !== JSON.stringify(this.deps.settings().names)) await this.deps.saveNames(names);
	}

	private async engineClient(): Promise<AnalysisClient> {
		if (this.client) return this.client;
		this.workerUrl = URL.createObjectURL(new Blob([analysisWorkerCode], { type: 'text/javascript' }));
		const client = new AnalysisClient(new Worker(this.workerUrl));
		await client.init(engineWasm.slice());
		this.client = client;
		return client;
	}

	private async analyse(): Promise<{ result: AnalysisResult; ms: number }> {
		const { app, index } = this.deps;
		const { ids, vectors, dims } = index.noteVectors();
		const docs: NoteDoc[] = [];
		const tags: string[][] = [];
		const texts = new Map<string, string>();
		const docFreq = new Map<string, number>();
		for (const id of ids) {
			const file = app.vault.getFileByPath(id);
			const cache = file ? app.metadataCache.getFileCache(file) : null;
			const content = file ? await app.vault.cachedRead(file) : '';
			const doc = docOf(file?.basename ?? id, cache ?? null, content, MAX_TEXT);
			docs.push(doc);
			tags.push((cache ? (getAllTags(cache) ?? []) : []).map((t) => t.replace(/^#/, '')));
			const text = `${doc.title}\n${doc.text ?? ''}`;
			texts.set(id, text);
			for (const w of new Set(tokenize(text))) docFreq.set(w, (docFreq.get(w) ?? 0) + 1);
		}
		this.texts = texts;
		this.docFreq = docFreq;
		const known = new Set(ids);
		const relations = collectRelations(
			readNotes(app).filter((n) => known.has(n.path)),
			linkResolver(app),
		);
		const settings = this.deps.settings();
		const previous = toPrevious((await index.indexStore()?.analysis()) ?? null);
		const client = await this.engineClient();
		return client.analyze(
			{ ids, vectors, dims, docs, links: relations.edges, tags },
			{ resolution: settings.resolution, seed: 1, suggestions: { exclude: settings.judged.map((j) => [j.a, j.b]) } },
			previous,
		);
	}

	/** Gives a cluster a name by hand, or gives it back its keyword name with an empty name. */
	async rename(clusterId: number, name: string): Promise<void> {
		if (!this.current) return;
		const names = nameCluster(this.current, clusterId, name, this.deps.settings().names);
		await this.deps.index.indexStore()?.setAnalysis(toSnapshot(this.current, Date.now()));
		await this.deps.saveNames(names);
		this.set({});
	}

	/** Records the user's decision on a suggested link; it is never suggested again. */
	async judge(a: string, b: string, verdict: Verdict): Promise<void> {
		const [x, y] = a <= b ? [a, b] : [b, a];
		const judged = this.deps.settings().judged.filter((j) => !(j.a === x && j.b === y));
		await this.deps.saveJudged([...judged, { a: x, b: y, verdict }]);
		if (this.current) {
			const key = pairKey(x, y);
			this.current.suggestions.items = this.current.suggestions.items.filter((s) => pairKey(s.a, s.b) !== key);
		}
		this.set({});
	}

	/** Links note `a` to note `b`: a link on a new line at the end of `a`, in the user's link format. */
	async link(a: string, b: string): Promise<void> {
		const { app } = this.deps;
		const from = app.vault.getFileByPath(a);
		const to = app.vault.getFileByPath(b);
		if (!(from instanceof TFile) || !(to instanceof TFile)) throw new Error('Note not found');
		const text = app.fileManager.generateMarkdownLink(to, from.path);
		await app.vault.process(from, (content) => `${content.replace(/\s*$/, '')}\n\n${text}\n`);
		await this.judge(a, b, 'linked');
	}

	/** Start of a note's text (as analysed), for its card. */
	excerpt(id: string, max = 280): string {
		const text = this.texts.get(id) ?? '';
		const body = text.slice(text.indexOf('\n') + 1).trim();
		return body.length > max ? `${body.slice(0, max).replace(/\s+\S*$/, '')}…` : body;
	}

	/** Relevance centile of each note on the interest axes (best axis). */
	async relevance(): Promise<Map<string, number>> {
		const axes = await this.axes();
		const scored = scoreAxes(this.vectors(), axes);
		return new Map([...scored.notes].map(([id, n]) => [id, n.relevanceCentile]));
	}

	/** Words both notes contain, rarest first. */
	sharedWords(a: string, b: string, max = 6): string[] {
		return sharedWords(this.texts.get(a) ?? '', this.texts.get(b) ?? '', this.docFreq, this.texts.size, max);
	}

	/** Folder, tags, date, modification time and link degree of each analysed note. */
	facts(): Map<string, NoteFacts> {
		const { app } = this.deps;
		const dates = this.dates();
		const ids = [...(this.current?.notes.keys() ?? [])];
		const degree = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]));
		for (const [source, targets] of Object.entries(app.metadataCache.resolvedLinks)) {
			for (const target of Object.keys(targets)) {
				if (source === target) continue;
				degree.get(source)?.add(target);
				degree.get(target)?.add(source);
			}
		}
		const out = new Map<string, NoteFacts>();
		for (const id of ids) {
			const file = app.vault.getFileByPath(id);
			out.set(id, {
				folder: file?.parent?.path === '/' ? '' : (file?.parent?.path ?? ''),
				tags: this.tagsOf(id).map((t) => t.replace(/^#/, '')),
				date: dates.get(id),
				modified: file?.stat.mtime ?? Number.NaN,
				degree: degree.get(id)?.size ?? 0,
			});
		}
		return out;
	}

	/** Date of each analysed note, from the chosen source. */
	dates(): Map<string, number> {
		const { app } = this.deps;
		const source = this.deps.settings().dateSource;
		const property = this.deps.indexSettings().dateProperty;
		const out = new Map<string, number>();
		for (const id of this.current?.notes.keys() ?? []) {
			const file = app.vault.getFileByPath(id);
			if (!(file instanceof TFile)) continue;
			let t: number | undefined;
			if (source === 'created') t = file.stat.ctime;
			else if (source === 'modified') t = file.stat.mtime;
			else if (property) t = parseDate(app.metadataCache.getFileCache(file)?.frontmatter?.[property]);
			if (t !== undefined) out.set(id, t);
		}
		return out;
	}

	/** Tags of a note (for the cluster lists). */
	tagsOf(id: string): string[] {
		const file = this.deps.app.vault.getFileByPath(id);
		const cache = file ? this.deps.app.metadataCache.getFileCache(file) : null;
		return cache ? (getAllTags(cache) ?? []) : [];
	}

	/** Note vectors by id. */
	vectors(): Map<string, Float32Array> {
		const { ids, vectors, dims } = this.deps.index.noteVectors();
		return new Map(ids.map((id, i) => [id, vectors.subarray(i * dims, (i + 1) * dims)]));
	}

	/** The interest axes, embedded by the model (each text once). */
	async axes(): Promise<Axis[]> {
		const out: Axis[] = [];
		const seen = new Set<string>();
		for (const axis of this.deps.settings().axes) {
			// An axis without a name is being written; two axes with the same name are one.
			if (axis.name === '' || seen.has(axis.name)) continue;
			seen.add(axis.name);
			const text = axis.description.trim() === '' ? axis.name : `${axis.name}. ${axis.description}`;
			let vector = this.axisCache.get(text);
			if (!vector) {
				vector = await this.deps.index.embedText(text);
				this.axisCache.set(text, vector);
			}
			out.push({ id: axis.name, vector });
		}
		return out;
	}

	/** Forgets the result (after the data was cleared). */
	reset(): void {
		this.current = null;
		this.analysedRevision = -1;
		this.axisCache.clear();
		this.set({ phase: 'idle', message: '', ms: 0, at: 0 });
	}

	stop(): void {
		this.stopped = true;
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = null;
		this.client?.terminate();
		this.client = null;
		if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
		this.workerUrl = null;
	}
}
