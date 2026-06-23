import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import { CREDITS_PER_USD } from '$lib/server/billing/credits';
import { computeTopUpCheckout } from '$lib/billing/top-up-checkout';

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

const QUOTE = computeTopUpCheckout(1000);

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
			requestedCredits: 1000,
			chargedGrossUsd: QUOTE.totalDueUsd,
			platformSubtotalUsd: QUOTE.platformSubtotalUsd
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

	it('returns 400 when captured gross does not match quoted checkout', async () => {
		buildDb({
			id: 'internal-1',
			userId: 'u1',
			paypalOrderId: 'pp-1',
			status: 'created',
			requestedCredits: 1000,
			chargedGrossUsd: QUOTE.totalDueUsd,
			platformSubtotalUsd: QUOTE.platformSubtotalUsd
		});
		capturePayPalOrderMock.mockResolvedValue({
			grossUsd: '9.99',
			netUsd: '9.00',
			paypalFeeUsd: '0.99',
			payerEmail: 'payer@example.com',
			raw: {}
		});

		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: postRequest({ orderId: 'pp-1' })
		} as never);

		expect(res.status).toBe(400);
		expect((await res.json()).error).toMatch(/gross/);
	});

	it('returns 400 when net received is below platform subtotal', async () => {
		buildDb({
			id: 'internal-1',
			userId: 'u1',
			paypalOrderId: 'pp-1',
			status: 'created',
			requestedCredits: 1000,
			chargedGrossUsd: QUOTE.totalDueUsd,
			platformSubtotalUsd: QUOTE.platformSubtotalUsd
		});
		capturePayPalOrderMock.mockResolvedValue({
			grossUsd: QUOTE.totalDueUsd,
			netUsd: '0.50',
			paypalFeeUsd: '1.25',
			payerEmail: 'payer@example.com',
			raw: {}
		});

		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: postRequest({ orderId: 'pp-1' })
		} as never);

		expect(res.status).toBe(400);
		expect((await res.json()).error).toMatch(/net received/);
	});

	it('returns 400 for legacy orders missing checkout pricing', async () => {
		buildDb({
			id: 'internal-1',
			userId: 'u1',
			paypalOrderId: 'pp-1',
			status: 'created',
			requestedCredits: 1000,
			chargedGrossUsd: null,
			platformSubtotalUsd: null
		});
		capturePayPalOrderMock.mockResolvedValue({
			grossUsd: '1.00',
			netUsd: '0.50',
			paypalFeeUsd: '0.50',
			payerEmail: 'payer@example.com',
			raw: {}
		});

		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: postRequest({ orderId: 'pp-1' })
		} as never);

		expect(res.status).toBe(400);
		expect((await res.json()).error).toMatch(/legacy order/);
	});

	it('captures order and credits requested credits on success', async () => {
		buildDb({
			id: 'internal-1',
			userId: 'u1',
			paypalOrderId: 'pp-1',
			status: 'created',
			requestedCredits: 1000,
			chargedGrossUsd: QUOTE.totalDueUsd,
			platformSubtotalUsd: QUOTE.platformSubtotalUsd
		});
		capturePayPalOrderMock.mockResolvedValue({
			grossUsd: QUOTE.totalDueUsd,
			netUsd: '1.21',
			paypalFeeUsd: '0.54',
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
			amountCredits: 1000,
			audit: {
				grossUsd: QUOTE.totalDueUsd,
				netUsd: '1.21',
				paypalFeeUsd: '0.54',
				platformSubtotalUsd: QUOTE.platformSubtotalUsd
			}
		});
		expect(await res.json()).toEqual({
			status: 'captured',
			credited: true,
			availableCredits: 11000,
			creditedCredits: 1000,
			creditsPerUsd: CREDITS_PER_USD,
			checkout: {
				grossUsd: QUOTE.totalDueUsd,
				paypalFeeUsd: '0.54',
				netUsd: '1.21'
			}
		});
	});
});
