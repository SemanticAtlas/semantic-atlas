/**
 * Console output: silent by default, only errors are shown.
 * Debug and warning messages appear when debug mode is enabled in the settings.
 */

export interface LogSink {
	debug(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	error(...args: unknown[]): void;
}

export interface Logger {
	debug(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	error(...args: unknown[]): void;
}

const PREFIX = '[semantic-atlas]';

export function createLogger(isDebug: () => boolean, sink: LogSink = console): Logger {
	return {
		debug: (...args) => {
			if (isDebug()) sink.debug(PREFIX, ...args);
		},
		warn: (...args) => {
			if (isDebug()) sink.warn(PREFIX, ...args);
		},
		error: (...args) => sink.error(PREFIX, ...args),
	};
}
