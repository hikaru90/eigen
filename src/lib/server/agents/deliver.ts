import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { connectedAgent, webhookDelivery, type UserJobQueue } from '$lib/server/db/schema';
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption';
import { createAdminSql } from '$lib/server/job-queue/admin-db';
import { buildWebhookHeaders, buildWebhookSignature, type SignatureMode } from './sign';
import { WEBHOOK_HTTP_TIMEOUT_MS } from './constants';

const GONE_STATUS = new Set([404, 410]);

export class WebhookDeliveryError extends Error {
	constructor(
		message: string,
		readonly options?: { httpStatus?: number; permanent?: boolean }
	) {
		super(message);
		this.name = 'WebhookDeliveryError';
	}
}

async function loadDeliveryContext(deliveryId: string) {
	const sql = createAdminSql(1);
	try {
		const rows = await sql<
			Array<{
				delivery_id: string;
				user_id: string;
				agent_id: string;
				event_type: string;
				payload: Record<string, unknown>;
				webhook_url: string;
				signing_secret_encrypted: string;
				enabled: boolean;
			}>
		>`
			SELECT
				wd.id AS delivery_id,
				wd.user_id,
				wd.agent_id,
				wd.event_type,
				wd.payload,
				ca.webhook_url,
				ca.signing_secret_encrypted,
				ca.enabled
			FROM webhook_delivery wd
			INNER JOIN connected_agent ca ON ca.id = wd.agent_id
			WHERE wd.id = ${deliveryId}
			LIMIT 1
		`;
		return rows[0] ?? null;
	} finally {
		await sql.end();
	}
}

export async function processWebhookDeliveryJob(job: UserJobQueue): Promise<void> {
	const deliveryId =
		typeof job.payload.deliveryId === 'string' ? job.payload.deliveryId.trim() : '';
	if (!deliveryId) {
		throw new Error('webhook_delivery job missing deliveryId');
	}

	const ctx = await loadDeliveryContext(deliveryId);
	if (!ctx) {
		throw new Error(`Webhook delivery ${deliveryId} not found`);
	}
	if (!ctx.enabled) {
		throw new WebhookDeliveryError('Connected agent is disabled', { permanent: true });
	}
	if (ctx.user_id !== job.userId) {
		throw new Error('Webhook delivery user mismatch');
	}

	const signingSecret = await decryptTenantValue({
		userId: ctx.user_id,
		table: 'connected_agent',
		column: 'signing_secret',
		ciphertext: ctx.signing_secret_encrypted
	});

	const rawBody = JSON.stringify(ctx.payload);
	const signature = buildWebhookSignature({ secret: signingSecret, rawBody });

	// Determine signature mode from agent config (default to generic)
	const signatureMode: SignatureMode = (ctx as Record<string, unknown>).signature_mode as SignatureMode || 'generic';

	const headers = buildWebhookHeaders({
		mode: signatureMode,
		eventType: ctx.event_type,
		deliveryId: ctx.delivery_id,
		signature
	});

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), WEBHOOK_HTTP_TIMEOUT_MS);

	let httpStatus: number | undefined;
	try {
		const res = await fetch(ctx.webhook_url, {
			method: 'POST',
			headers,
			body: rawBody,
			signal: controller.signal
		});
		httpStatus = res.status;
		if (!res.ok) {
			const text = await res.text().catch(() => '');
			const permanent = GONE_STATUS.has(res.status);
			throw new WebhookDeliveryError(
				`Webhook returned HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
				{ httpStatus: res.status, permanent }
			);
		}
	} catch (err) {
		if (err instanceof WebhookDeliveryError) throw err;
		const message = err instanceof Error ? err.message : String(err);
		throw new WebhookDeliveryError(message);
	} finally {
		clearTimeout(timeout);
	}

	const sql = createAdminSql(1);
	try {
		const db = drizzle(sql, { schema: { webhookDelivery, connectedAgent } });
		await db
			.update(webhookDelivery)
			.set({
				status: 'delivered',
				httpStatus: httpStatus ?? 200,
				attemptCount: job.attemptCount,
				deliveredAt: new Date(),
				lastError: null
			})
			.where(eq(webhookDelivery.id, deliveryId));

		await db
			.update(connectedAgent)
			.set({ lastDeliveryAt: new Date() })
			.where(eq(connectedAgent.id, ctx.agent_id));
	} finally {
		await sql.end();
	}
}

export async function markWebhookDeliveryFailed(input: {
	deliveryId: string;
	attemptCount: number;
	httpStatus?: number;
	lastError: string;
	terminal: boolean;
}): Promise<void> {
	const sql = createAdminSql(1);
	try {
		const db = drizzle(sql, { schema: { webhookDelivery } });
		await db
			.update(webhookDelivery)
			.set({
				status: input.terminal ? 'failed' : 'pending',
				attemptCount: input.attemptCount,
				httpStatus: input.httpStatus ?? null,
				lastError: input.lastError.slice(0, 2000)
			})
			.where(eq(webhookDelivery.id, input.deliveryId));
	} finally {
		await sql.end();
	}
}

export async function disableConnectedAgent(agentId: string): Promise<void> {
	const sql = createAdminSql(1);
	try {
		const db = drizzle(sql, { schema: { connectedAgent } });
		await db
			.update(connectedAgent)
			.set({ enabled: false })
			.where(eq(connectedAgent.id, agentId));
	} finally {
		await sql.end();
	}
}

export async function loadWebhookDeliveryAgentId(
	deliveryId: string
): Promise<{ agentId: string } | null> {
	const sql = createAdminSql(1);
	try {
		const rows = await sql<Array<{ agent_id: string }>>`
			SELECT agent_id FROM webhook_delivery WHERE id = ${deliveryId} LIMIT 1
		`;
		const row = rows[0];
		return row ? { agentId: row.agent_id } : null;
	} finally {
		await sql.end();
	}
}
