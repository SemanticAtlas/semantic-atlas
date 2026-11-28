/**
 * Semantic index of the vault: model download (after the user agreed), embedding worker,
 * incremental indexing by content hash, in-memory search indexes, related notes and search.
 *
 * Nothing heavy happens at start-up: the service starts after the layout is ready, and only
 * if the index is turned on. Vectors are stored in IndexedDB, local to the device.
 */
import { Platform, TFile, getAllTags, parseFrontMatterAliases, requestUrl, type App } from 'obsidian';
import {
	DEFAULT_MODEL,
	EmbeddingClient,
	INDEX_FORMAT_VERSION,
	MODELS,
	TextIndex,
	VectorIndex,
	cleanMarkdown,
	deleteAllData,
	downloadAsset,
	openIndexStore,
	openModelStore,
	reciprocalRankFusion,
	sha256Hex,
	type ChunkRecord,
	type EmbeddedNote,
	type IndexStore,
	type ModelAsset,
	type ModelSpec,
	type ModelStore,
	type NoteInput,
	type NoteRecord,
	type RangeTransport,
} from '@semanticatlas/core';
import embedWasm from '@semanticatlas/engine/embed.wasm';
import embedWorkerCode from 'virtual:embed-worker';
import { toNoteInput } from '../adapter/note-input';
import type { Logger } from '../log';
import type { IndexSettings } from '../settings/schema';
import { isExcluded, planWork, settingsHash } from './plan';

export type IndexPhase = 'off' | 'no-model' | 'downloading' | 'loading' | 'indexing' | 'ready' | 'paused' | 'error';

export interface IndexState {
	phase: IndexPhase;
	/** Notes embedded / to embed in the current pass. */
	done: number;
	total: number;
	/** Bytes downloaded / to download. */
	bytesDone: number;
	bytesTotal: number;
	message: string;
	indexedNotes: number;
}

export interface Passage {
	text: string;
	start: number;
	end: number;
	headings: string[];
}

export interface NoteHit {
	id: string;
	score: number;
	passage: Passage | null;
}

const VAULT_KEY = 'semantic-atlas-vault-key';
const BATCH = 4;
const CHUNK_SEP = '\u0000';

/** Obsidian's requestUrl with an HTTP Range header (requestUrl follows redirects). */
const requestUrlTransport: RangeTransport = async (url, range) => {
	const res = await requestUrl({ url, headers: { Range: `bytes=${range.start}-${range.end}` }, throw: false });
	if (res.status !== 200 && res.status !== 206) throw new Error(`HTTP ${res.status} for ${url}`);
	return { status: res.status, bytes: res.arrayBuffer };
};

export class IndexingService {
	private state: IndexState = { phase: 'off', done: 0, total: 0, bytesDone: 0, bytesTotal: 0, message: '', indexedNotes: 0 };
	private readonly listeners = new Set<(s: IndexState) => void>();
	private models: ModelStore | null = null;
	private store: IndexStore | null = null;
	private client: EmbeddingClient | null = null;
	private worker: Worker | null = null;
	private workerUrl: string | null = null;
	private readonly spec: ModelSpec = MODELS[DEFAULT_MODEL];
	private noteIndex = new VectorIndex(this.spec.dims);
	private chunkIndex = new VectorIndex(this.spec.dims);
	private textIndex = new TextIndex();
	private readonly chunks = new Map<string, ChunkRecord[]>();
	private readonly pending = new Set<string>();
	/** Increases whenever a note vector is added or removed (the analysis is redone when it changed). */
	private revisionCount = 0;
	private running = false;
	private paused = false;
	private stopped = false;
	private download: AbortController | null = null;

	constructor(
		private readonly app: App,
		private readonly settings: () => IndexSettings,
		private readonly log: Logger,
	) {}

	get model(): ModelSpec {
		return this.spec;
	}

	getState(): IndexState {
		return { ...this.state };
	}

	onChange(listener: (s: IndexState) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private set(patch: Partial<IndexState>): void {
		this.state = { ...this.state, ...patch, indexedNotes: this.noteIndex.size };
		for (const l of this.listeners) l(this.getState());
	}

	/** True when this device should index (desktop, or mobile when allowed). */
	allowedHere(): boolean {
		const s = this.settings();
		return s.enabled && (!Platform.isMobile || s.onMobile);
	}

	isReady(): boolean {
		return this.client !== null && (this.state.phase === 'ready' || this.state.phase === 'indexing' || this.state.phase === 'paused');
	}

	private vaultKey(): string {
		const known = this.app.loadLocalStorage(VAULT_KEY) as unknown;
		if (typeof known === 'string' && known) return known;
		const key = crypto.randomUUID();
		this.app.saveLocalStorage(VAULT_KEY, key);
		return key;
	}

	// ---- life cycle -------------------------------------------------------------------------

	/** Starts (or restarts) the index according to the settings. */
	async start(): Promise<void> {
		await this.stop();
		this.stopped = false;
		if (!this.allowedHere()) {
			this.set({ phase: 'off', message: '' });
			return;
		}
		try {
			this.models = await openModelStore();
			if (!(await this.hasModel())) {
				this.set({ phase: 'no-model', message: '' });
				return;
			}
			await this.loadModel();
			await this.loadIndex();
			void this.reindexAll();
		} catch (error) {
			this.fail(error);
		}
	}

	async stop(): Promise<void> {
		this.stopped = true;
		this.download?.abort();
		this.download = null;
		this.client?.terminate();
		this.client = null;
		this.worker = null;
		if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
		this.workerUrl = null;
		this.store?.close();
		this.store = null;
		this.models?.close();
		this.models = null;
		this.noteIndex = new VectorIndex(this.spec.dims);
		this.chunkIndex = new VectorIndex(this.spec.dims);
		this.textIndex = new TextIndex();
		this.chunks.clear();
		this.pending.clear();
		// Let a running pass notice it has to stop.
		await Promise.resolve();
	}

	pause(): void {
		this.paused = true;
		if (this.state.phase === 'indexing') this.set({ phase: 'paused' });
	}

	resume(): void {
		this.paused = false;
		if (this.state.phase === 'paused') this.set({ phase: 'indexing' });
		void this.drain();
	}

	/** Deletes the index of this vault and, if asked, the downloaded model. */
	async clearAll(models: boolean): Promise<void> {
		await this.stop();
		await deleteAllData(this.vaultKey(), indexedDB, { models });
		this.set({ phase: 'off', done: 0, total: 0, message: '' });
	}

	private fail(error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		this.log.error('semantic index', error);
		this.set({ phase: 'error', message });
	}

	// ---- model ------------------------------------------------------------------------------

	private assets(): ModelAsset[] {
		return [this.spec.assets.weights, this.spec.assets.tokenizer, this.spec.assets.config];
	}

	async hasModel(): Promise<boolean> {
		const store = this.models ?? (this.models = await openModelStore());
		const have = new Set((await store.listFiles()).map((f) => f.sha256));
		return this.assets().every((a) => have.has(a.sha256));
	}

	/** Downloads the model files; call it only after the user agreed. */
	async downloadModel(): Promise<void> {
		this.download?.abort();
		const controller = new AbortController();
		this.download = controller;
		try {
			const store = this.models ?? (this.models = await openModelStore());
			const total = this.spec.totalBytes;
			let before = 0;
			this.set({ phase: 'downloading', bytesDone: 0, bytesTotal: total, message: '' });
			for (const asset of this.assets()) {
				if (!(await store.getFile(asset.sha256))) {
					const bytes = await downloadAsset(asset, requestUrlTransport, {
						store,
						signal: controller.signal,
						onProgress: (done) => {
							this.set({ bytesDone: before + done });
						},
					});
					await store.putFile(asset.sha256, asset.name, bytes);
				}
				before += asset.size;
				this.set({ bytesDone: before });
			}
		} catch (error) {
			if (controller.signal.aborted) {
				this.set({ phase: 'no-model', message: '' });
				return;
			}
			this.fail(error);
			return;
		} finally {
			if (this.download === controller) this.download = null;
		}
		await this.start();
	}

	cancelDownload(): void {
		this.download?.abort();
	}

	/** Stores model files chosen by the user (offline install); returns the names not recognised. */
	async importModelFiles(files: { name: string; bytes: Uint8Array }[]): Promise<string[]> {
		const store = this.models ?? (this.models = await openModelStore());
		const bySha = new Map(this.assets().map((a) => [a.sha256, a]));
		const unknown: string[] = [];
		for (const f of files) {
			const asset = bySha.get(await sha256Hex(f.bytes));
			if (asset) await store.putFile(asset.sha256, asset.name, f.bytes);
			else unknown.push(f.name);
		}
		if (await this.hasModel()) await this.start();
		return unknown;
	}

	private async loadModel(): Promise<void> {
		this.set({ phase: 'loading', message: '' });
		const store = this.models!;
		const [weights, tokenizer] = await Promise.all([store.getFile(this.spec.assets.weights.sha256), store.getFile(this.spec.assets.tokenizer.sha256)]);
		if (!weights || !tokenizer) throw new Error('Model files are missing');
		this.workerUrl = URL.createObjectURL(new Blob([embedWorkerCode], { type: 'text/javascript' }));
		this.worker = new Worker(this.workerUrl);
		this.client = new EmbeddingClient(this.worker);
		const s = this.settings();
		const wasm = embedWasm.slice();
		await this.client.init(
			{
				embedWasm: wasm,
				weights,
				tokenizerJson: new TextDecoder().decode(tokenizer),
				prefix: this.spec.prefix,
				chunk: { maxTokens: s.maxChunkTokens, overlapTokens: s.overlapTokens, minTokens: s.minTokens, excludeKinds: s.includeCode ? ['query'] : ['code', 'query'] },
				titleWeight: s.titleWeight,
			},
			[weights.buffer, wasm.buffer],
		);
	}

	private async loadIndex(): Promise<void> {
		this.store = await openIndexStore(this.vaultKey());
		const meta = await this.store.meta();
		const hash = settingsHash(this.settings(), this.spec.assets.weights.sha256);
		if (!meta || meta.formatVersion !== INDEX_FORMAT_VERSION || meta.modelId !== this.spec.id || meta.settingsHash !== hash) {
			if (meta) this.log.debug('semantic index: format, model or settings changed, rebuilding');
			await this.store.clear();
			await this.store.setMeta({ formatVersion: INDEX_FORMAT_VERSION, modelId: this.spec.id, modelSha256: this.spec.assets.weights.sha256, settingsHash: hash });
		}
		for (const r of await this.store.allNotes()) this.addToMemory(r);
		this.set({});
	}

	// ---- indexing ---------------------------------------------------------------------------

	private addToMemory(r: NoteRecord): void {
		this.removeFromMemory(r.id);
		this.revisionCount++;
		this.noteIndex.set(r.id, r.vector);
		r.chunks.forEach((c, i) => {
			this.chunkIndex.set(`${r.id}${CHUNK_SEP}${i}`, c.vector);
		});
		this.chunks.set(r.id, r.chunks);
	}

	private removeFromMemory(id: string): void {
		if (this.noteIndex.has(id)) this.revisionCount++;
		this.noteIndex.delete(id);
		const old = this.chunks.get(id) ?? [];
		old.forEach((_, i) => {
			this.chunkIndex.delete(`${id}${CHUNK_SEP}${i}`);
		});
		this.chunks.delete(id);
		this.textIndex.delete(id);
	}

	private tagsOf(file: TFile): string[] {
		const cache = this.app.metadataCache.getFileCache(file);
		return (cache ? (getAllTags(cache) ?? []) : []).map((t) => t.replace(/^#/, ''));
	}

	private eligible(file: TFile): boolean {
		return file.extension === 'md' && !isExcluded(file.path, this.tagsOf(file), this.settings(), this.app.vault.configDir);
	}

	private async readNote(file: TFile): Promise<{ input: NoteInput; hash: string; content: string }> {
		const content = await this.app.vault.cachedRead(file);
		const cache = this.app.metadataCache.getFileCache(file);
		const input = toNoteInput(
			{
				path: file.path,
				title: file.basename,
				folder: file.parent?.path ?? '',
				ctime: file.stat.ctime,
				mtime: file.stat.mtime,
				tags: this.tagsOf(file),
				aliases: parseFrontMatterAliases(cache?.frontmatter ?? null) ?? [],
			},
			content,
			cache,
			{ dateProperty: this.settings().dateProperty },
		);
		const hash = await sha256Hex(new TextEncoder().encode(`${settingsHash(this.settings(), this.spec.assets.weights.sha256)}\u0000${file.path}\u0000${content}`));
		return { input, hash, content };
	}

	/** Compares the vault with the index and embeds what changed. */
	async reindexAll(): Promise<void> {
		if (!this.store || !this.client) return;
		try {
			const files = this.app.vault.getMarkdownFiles().filter((f) => this.eligible(f));
			const facts: { id: string; hash: string; mtime: number }[] = [];
			for (const file of files) {
				if (this.stopped) return;
				const { hash, content } = await this.readNote(file);
				facts.push({ id: file.path, hash, mtime: file.stat.mtime });
				this.textIndex.set(file.path, file.basename, cleanMarkdown(content));
			}
			const plan = planWork(await this.store.hashes(), facts, this.app.workspace.getActiveFile()?.path ?? null);
			if (plan.toDelete.length > 0) {
				await this.store.deleteNotes(plan.toDelete);
				for (const id of plan.toDelete) this.removeFromMemory(id);
			}
			this.log.debug(`semantic index: ${plan.toEmbed.length} to embed, ${plan.unchanged} unchanged, ${plan.toDelete.length} removed`);
			for (const id of plan.toEmbed) this.pending.add(id);
			this.set({ done: 0, total: this.pending.size });
			await this.drain();
		} catch (error) {
			this.fail(error);
		}
	}

	/** Queues a note (created or modified). */
	enqueue(path: string): void {
		if (!this.isReady()) return;
		this.pending.add(path);
		this.set({ total: this.state.total + 1 });
		void this.drain();
	}

	/** Removes a note (deleted, renamed or now excluded). */
	async remove(path: string): Promise<void> {
		this.pending.delete(path);
		this.removeFromMemory(path);
		await this.store?.deleteNotes([path]);
		this.set({});
	}

	private async drain(): Promise<void> {
		if (this.running || !this.client || !this.store) return;
		this.running = true;
		try {
			while (this.pending.size > 0 && !this.paused && !this.stopped) {
				this.set({ phase: 'indexing' });
				const batch = [...this.pending].slice(0, BATCH);
				for (const id of batch) this.pending.delete(id);
				const inputs: { input: NoteInput; hash: string; content: string; title: string }[] = [];
				for (const id of batch) {
					const file = this.app.vault.getFileByPath(id);
					if (!(file instanceof TFile) || !this.eligible(file)) {
						await this.remove(id);
						continue;
					}
					const read = await this.readNote(file);
					inputs.push({ ...read, title: file.basename });
				}
				const records: NoteRecord[] = [];
				const byId = new Map(inputs.map((i) => [i.input.id, i]));
				await this.client.embedNotes(
					inputs.map((i) => i.input),
					(note: EmbeddedNote) => {
						const source = byId.get(note.id);
						if (!source) return;
						records.push({ id: note.id, hash: source.hash, title: source.title, vector: note.vector, chunks: note.chunks });
						if (note.truncatedChunks > 0) this.log.warn(`${note.id}: ${note.truncatedChunks} passage(s) cut to the model's limit`);
					},
					(noteId, message) => {
						this.log.error(`semantic index: ${noteId}: ${message}`);
					},
				);
				if (this.stopped || !this.store) return;
				await this.store.putNotes(records);
				for (const r of records) {
					this.addToMemory(r);
					const source = byId.get(r.id);
					if (source) this.textIndex.set(r.id, r.title, cleanMarkdown(source.content));
				}
				this.set({ done: this.state.done + batch.length });
			}
			if (!this.stopped) this.set({ phase: this.paused && this.pending.size > 0 ? 'paused' : 'ready' });
		} catch (error) {
			if (!this.stopped) this.fail(error);
		} finally {
			this.running = false;
		}
	}

	// ---- queries ----------------------------------------------------------------------------

	private bestPassage(id: string, query: Float32Array): Passage | null {
		const chunks = this.chunks.get(id) ?? [];
		let best: ChunkRecord | null = null;
		let bestScore = -Infinity;
		for (const c of chunks) {
			let s = 0;
			for (let i = 0; i < query.length; i++) s += query[i]! * c.vector[i]!;
			if (s > bestScore) {
				bestScore = s;
				best = c;
			}
		}
		return best ? { text: '', start: best.start, end: best.end, headings: best.headings } : null;
	}

	/** Notes closest to `id` by meaning. */
	related(id: string, k: number): NoteHit[] {
		const v = this.noteIndex.get(id);
		if (!v) return [];
		return this.noteIndex.search(v, k, (other) => other !== id).map((h) => ({ ...h, passage: this.bestPassage(h.id, v) }));
	}

	/** The two most similar passages of two notes, and their similarity. */
	closestPassages(a: string, b: string): { a: Passage; b: Passage; similarity: number } | null {
		const ca = this.chunks.get(a) ?? [];
		const cb = this.chunks.get(b) ?? [];
		let best: { a: ChunkRecord; b: ChunkRecord; similarity: number } | null = null;
		for (const x of ca) {
			for (const y of cb) {
				let s = 0;
				for (let i = 0; i < x.vector.length; i++) s += x.vector[i]! * y.vector[i]!;
				if (!best || s > best.similarity) best = { a: x, b: y, similarity: s };
			}
		}
		if (!best) return null;
		const passage = (c: ChunkRecord): Passage => ({ text: '', start: c.start, end: c.end, headings: c.headings });
		return { a: passage(best.a), b: passage(best.b), similarity: best.similarity };
	}

	/** Changes whenever the set of note vectors changes. */
	revision(): number {
		return this.revisionCount;
	}

	hasNote(id: string): boolean {
		return this.noteIndex.has(id);
	}

	/** Ids and note vectors of every indexed note (n x dims, row by row). */
	noteVectors(): { ids: string[]; vectors: Float32Array; dims: number } {
		const ids = [...this.chunks.keys()].filter((id) => this.noteIndex.has(id)).sort();
		const dims = this.spec.dims;
		const vectors = new Float32Array(ids.length * dims);
		ids.forEach((id, i) => {
			const v = this.noteIndex.get(id);
			if (v) vectors.set(v, i * dims);
		});
		return { ids, vectors, dims };
	}

	/** Embeds a free text (an interest axis, a query). */
	async embedText(text: string): Promise<Float32Array> {
		if (!this.client) throw new Error('The semantic index is not ready');
		return this.client.embedQuery(text);
	}

	/** The index store of this vault (for the analysis snapshot), when open. */
	indexStore(): IndexStore | null {
		return this.store;
	}

	/** Hybrid search: passages by meaning and words (BM25), fused by rank. */
	async search(query: string, k: number): Promise<NoteHit[]> {
		if (!this.client || !query.trim()) return [];
		const q = await this.client.embedQuery(query);
		const byNote = new Map<string, number>();
		for (const h of this.chunkIndex.search(q, 200)) {
			const id = h.id.split(CHUNK_SEP)[0]!;
			if (!byNote.has(id)) byNote.set(id, h.score);
		}
		for (const h of this.noteIndex.search(q, 50)) if (!byNote.has(h.id)) byNote.set(h.id, h.score);
		const semantic = [...byNote.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, 50);
		const words = this.textIndex.search(query, 50).map((h) => h.id);
		return reciprocalRankFusion([semantic, words])
			.slice(0, k)
			.map((h) => ({ id: h.id, score: h.score, passage: this.bestPassage(h.id, q) }));
	}

	/** Reads the text of a passage (cleaned), for display. */
	async passageText(id: string, passage: Passage, maxChars = 280): Promise<string> {
		const file = this.app.vault.getFileByPath(id);
		if (!(file instanceof TFile)) return '';
		const content = await this.app.vault.cachedRead(file);
		const shift = this.app.metadataCache.getFileCache(file)?.frontmatterPosition?.end.offset ?? 0;
		const text = cleanMarkdown(content.slice(shift + passage.start, shift + passage.end)).replace(/\s+/g, ' ');
		return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
	}
}
