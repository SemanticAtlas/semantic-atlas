import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/log';

const sink = () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('createLogger', () => {
	it('is silent except for errors when debug mode is off', () => {
		const out = sink();
		const log = createLogger(() => false, out);
		log.debug('x');
		log.warn('y');
		log.error('z');
		expect(out.debug).not.toHaveBeenCalled();
		expect(out.warn).not.toHaveBeenCalled();
		expect(out.error).toHaveBeenCalledWith('[semantic-atlas]', 'z');
	});

	it('shows debug and warning messages when debug mode is on', () => {
		const out = sink();
		let debug = false;
		const log = createLogger(() => debug, out);
		debug = true;
		log.debug('x', 1);
		log.warn('y');
		expect(out.debug).toHaveBeenCalledWith('[semantic-atlas]', 'x', 1);
		expect(out.warn).toHaveBeenCalledWith('[semantic-atlas]', 'y');
	});
});
