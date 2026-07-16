import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

export type EnvelopePayload = {
	v: 1;
	iv: string;
	tag: string;
	data: string;
};

function encodeBase64(input: Uint8Array): string {
	return Buffer.from(input).toString('base64');
}

function decodeBase64(input: string): Buffer {
	return Buffer.from(input, 'base64');
}

export function encryptEnvelope(plaintext: string, key: Buffer, aad: string): string {
	if (key.length !== 32) {
		throw new Error('Envelope key must be 32 bytes');
	}
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGO, key, iv);
	cipher.setAAD(Buffer.from(aad, 'utf8'));
	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	const payload: EnvelopePayload = {
		v: 1,
		iv: encodeBase64(iv),
		tag: encodeBase64(tag),
		data: encodeBase64(encrypted)
	};
	return JSON.stringify(payload);
}

export function decryptEnvelope(payloadJson: string, key: Buffer, aad: string): string {
	if (key.length !== 32) {
		throw new Error('Envelope key must be 32 bytes');
	}
	const parsed = JSON.parse(payloadJson) as Partial<EnvelopePayload>;
	// `data` may be "" (empty plaintext); only iv/tag must be non-empty.
	if (
		parsed.v !== 1 ||
		typeof parsed.iv !== 'string' ||
		!parsed.iv ||
		typeof parsed.tag !== 'string' ||
		!parsed.tag ||
		typeof parsed.data !== 'string'
	) {
		throw new Error('Invalid encrypted envelope payload');
	}
	const decipher = createDecipheriv(ALGO, key, decodeBase64(parsed.iv));
	decipher.setAAD(Buffer.from(aad, 'utf8'));
	decipher.setAuthTag(decodeBase64(parsed.tag));
	const plaintext = Buffer.concat([
		decipher.update(decodeBase64(parsed.data)),
		decipher.final()
	]);
	return plaintext.toString('utf8');
}
