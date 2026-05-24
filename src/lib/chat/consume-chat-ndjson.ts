import type { ChatStreamEvent } from './chat-stream-types';

export type ChatNdjsonDone = Extract<ChatStreamEvent, { type: 'done' }>;

export type ChatProgressEvent = Exclude<ChatStreamEvent, { type: 'done' } | { type: 'error' }>;

function parseNdjsonLine(line: string): ChatStreamEvent | null {
	const trimmed = line.trim();
	if (!trimmed) return null;
	return JSON.parse(trimmed) as ChatStreamEvent;
}

export async function consumeChatNdjsonStream(
	res: Response,
	onEvent: (event: ChatProgressEvent) => void,
	signal?: AbortSignal
): Promise<ChatNdjsonDone> {
	const reader = res.body?.getReader();
	if (!reader) {
		throw new Error('Chat response had no body to read.');
	}

	signal?.addEventListener('abort', () => {
		void reader.cancel();
	});

	const decoder = new TextDecoder();
	let buffer = '';

	const dispatchLine = (rawLine: string): ChatNdjsonDone | 'continue' => {
		const event = parseNdjsonLine(rawLine);
		if (!event) return 'continue';

		if (event.type === 'error') {
			throw new Error(event.error || 'Chat failed');
		}
		if (event.type === 'done') {
			return event;
		}

		onEvent(event);
		return 'continue';
	};

	const flushBuffer = (): ChatNdjsonDone | 'continue' => {
		const remaining = buffer.trim();
		buffer = '';
		if (!remaining) return 'continue';
		return dispatchLine(remaining);
	};

	try {
		while (true) {
			const { done, value } = await reader.read();
			buffer += decoder.decode(value, { stream: !done });
			let newline: number;
			while ((newline = buffer.indexOf('\n')) >= 0) {
				const rawLine = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				const result = dispatchLine(rawLine);
				if (result !== 'continue') return result;
			}
			if (done) break;
		}

		const trailing = flushBuffer();
		if (trailing !== 'continue') return trailing;
	} catch (e) {
		if (e instanceof Error && (e.name === 'AbortError' || signal?.aborted)) {
			throw new DOMException('Chat cancelled', 'AbortError');
		}
		throw e;
	}

	if (signal?.aborted) {
		throw new DOMException('Chat cancelled', 'AbortError');
	}
	throw new Error('Chat stream ended before completion.');
}
