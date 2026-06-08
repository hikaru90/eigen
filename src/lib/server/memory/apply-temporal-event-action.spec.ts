import { describe, expect, it } from 'vitest';
import { quickActionToLifecycle } from './apply-temporal-event-action';

describe('quickActionToLifecycle', () => {
	it('maps quick actions to lifecycle statuses', () => {
		expect(quickActionToLifecycle('mark_done')).toBe('completed');
		expect(quickActionToLifecycle('reopen')).toBe('open');
		expect(quickActionToLifecycle('cancel')).toBe('cancelled');
		expect(quickActionToLifecycle('dismiss')).toBe('dismissed');
	});
});
