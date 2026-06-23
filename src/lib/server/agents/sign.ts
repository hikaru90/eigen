import crypto from 'node:crypto';

export function buildWebhookSignature(input: {
	secret: string;
	timestamp: number;
	rawBody: string;
}): string {
	const signedPayload = `${input.timestamp}.${input.rawBody}`;
	return crypto.createHmac('sha256', input.secret).update(signedPayload).digest('hex');
}

export function buildWebhookHeaders(input: {
	eventType: string;
	deliveryId: string;
	timestamp: number;
	signature: string;
}): Record<string, string> {
	return {
		'Content-Type': 'application/json',
		'X-Eigen-Event': input.eventType,
		'X-Eigen-Delivery-Id': input.deliveryId,
		'X-Eigen-Timestamp': String(input.timestamp),
		'X-Eigen-Signature': `sha256=${input.signature}`
	};
}
