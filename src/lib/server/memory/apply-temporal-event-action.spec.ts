import { describe, expect, it } from 'vitest';
import {
	normalizeTemporalEventQuickAction,
	quickActionToLifecycle
} from './apply-temporal-event-action';

describe('apply-temporal-event-action lifecycle', () => {
	it('maps quick actions to unified lifecycle statuses', () => {
		expect(quickActionToLifecycle('mark_done')).toBe('completed');
		expect(quickActionToLifecycle('reopen')).toBe('open');
		expect(quickActionToLifecycle('archive')).toBe('archived');
	});

	it('maps legacy cancel/dismiss/delete to archive', () => {
		expect(normalizeTemporalEventQuickAction('cancel')).toBe('archive');
		expect(normalizeTemporalEventQuickAction('dismiss')).toBe('archive');
		expect(normalizeTemporalEventQuickAction('delete')).toBe('archive');
	});
});
