import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import { CREDITS_PER_USD } from '$lib/server/billing/credits';

const {
	capturePayPalOrderMock,
	creditFromPaymentMock,
	getOrCreateWalletMock,
	getDbMock
} = vi.hoisted(() => ({
	capturePayPalOrderMock: vi.fn(),
	creditFromPaymentMock: vi.fn(),
	getOrCreateWalletMock: vi.fn(),
	getDbMock: vi.fn()
}));

vi.mock('$lib/server/billing/paypal', () => ({
	capturePayPalOrder: capturePayPalOrderMock
}));
vi.mock('$lib/server/billing/wallet', () => ({
	creditFromPayment: creditFromPaymentMock,
	getOrCreateWallet: getOrCreateWalletMock
}));
vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

function postRequest(body: unknown) {
	return new Request('http://localhost/api/billing/paypal/capture-order', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}

function buildDb(existing: Record<string, unknown> | null) {
	const selectLimit = vi.fn().mockResolvedValue(existing ? [existing] : []);
	const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
	const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
	const select = vi.fn().mockReturnValue({ from: selectFrom });

	const updateWhere = vi.fn().mockResolvedValue(undefined);
	const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
	const update = vi.fn().mockReturnValue({ set: updateSet });

	getDbMock.mockReturnValue({ select, update });
	return { select, update, updateSet, updateWhere };
}

describe('POST /api/billing/paypal/capture-order', () => {
	it('returns 401 when unauthenticated', async () => {
		const res = await POST({
			locals: { user: null },
			request: postRequest({ orderId: 'pp-1' })
		} as never);
		expect(res.status).toBe(401);
	});

	it('returns 400 when orderId is missing', async () => {
		buildDb(null);
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: postRequest({})
		} as never);
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe('orderId is required');
	});

	it('returns 404 when order is not found', async () => {
		buildDb(null);
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: postRequest({ orderId: 'pp-missing' })
		} as never);
		expect(res.status).toBe(404);
	});

	it('returns 404 when order belongs to another user', async () => {
		buildDb({
			id: 'internal-1',
			userId: 'other',
			paypalOrderId: 'pp-1',
			status: 'created',
			requestedCredits: 1000
		});
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: postRequest({ orderId: 'pp-1' })
		} as never);
		expect(res.status).toBe(404);
	});

	it('returns already-captured response without re-capturing', async () => {
		buildDb({
			id: 'internal-1',
			userId: 'u1',
			paypalOrderId: 'pp-1',
			status: 'captured',
			requestedCredits: 1000
		});
		getOrCreateWalletMock.mockResolvedValue({ availableCredits: 9000 });

		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: postRequest({ orderId: 'pp-1' })
		} as never);

		expect(capturePayPalOrderMock).not.toHaveBeenCalled();
		expect(await res.json()).toEqual({
			status: 'captured',
			alreadyCaptured: true,
			availableCredits: 9000,
			creditsPerUsd: CREDITS_PER_USD
		});
	});

	it('returns 400 when captured credits do not match requested', async () => {
		buildDb({
			id: 'internal-1',
			userId: 'u1',
			paypalOrderId: 'pp-1',
			status: 'created',
			requestedCredits: 1000
		});
		capturePayPalOrderMock.mockResolvedValue({
			capturedCredits: 500,
			payerEmail: 'payer@example.com',
			raw: {}
		});

		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: postRequest({ orderId: 'pp-1' })
		} as never);

		expect(res.status).toBe(400);
		expect((await res.json()).error).toMatch(/do not match/);
	});

	it('captures order and credits wallet on success', async () => {
		buildDb({
			id: 'internal-1',
			userId: 'u1',
			paypalOrderId: 'pp-1',
			status: 'created',
			requestedCredits: 1000
		});
		capturePayPalOrderMock.mockResolvedValue({
			capturedCredits: 1000,
			payerEmail: 'payer@example.com',
			raw: { id: 'pp-1' }
		});
		creditFromPaymentMock.mockResolvedValue({
			credited: true,
			availableCredits: 11000
		});

		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: postRequest({ orderId: 'pp-1' })
		} as never);

		expect(creditFromPaymentMock).toHaveBeenCalledWith({
			userId: 'u1',
			paymentOrderId: 'internal-1',
			paypalOrderId: 'pp-1',
			amountCredits: 1000
		});
		expect(await res.json()).toEqual({
			status: 'captured',
			credited: true,
			availableCredits: 11000,
			capturedCredits: 1000,
			creditsPerUsd: CREDITS_PER_USD
		});
	});
});
