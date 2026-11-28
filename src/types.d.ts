// esbuild's "binary" loader turns an imported .wasm file into its bytes.
declare module '*.wasm' {
	const bytes: Uint8Array;
	export default bytes;
}

// The embedding worker, bundled on its own by esbuild.config.mjs and inlined as source text.
declare module 'virtual:embed-worker' {
	const code: string;
	export default code;
}

declare module 'virtual:analysis-worker' {
	const code: string;
	export default code;
}
