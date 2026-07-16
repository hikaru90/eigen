import type { CaptureAttachedFile } from '$lib/capture/capture-result-types';

export type TextFileRecord = {
	id: string;
	title: string;
	body: string;
	author?: 'user' | 'agent';
	authorLabel?: string | null;
	authorKeyId?: string | null;
	createdAt: string;
	updatedAt: string;
};

export type TextFileSearchHit = {
	id: string;
	title: string;
	preview: string;
	lexicalScore: number;
	updatedAt: string;
};

export type TextFileLinkedThought = {
	id: string;
	normalizedText: string;
};

export type TextFileListCursor = {
	updatedAt: string;
	id: string;
};

export async function fetchTextFiles(
	limit = 20,
	cursor?: TextFileListCursor,
	view?: string
): Promise<TextFileRecord[]> {
	const params = new URLSearchParams({ limit: String(limit) });
	if (cursor) {
		params.set('cursor_updated_at', cursor.updatedAt);
		params.set('cursor_id', cursor.id);
	}
	if (view && view !== 'all') {
		if (view === 'user') {
			params.set('authorLayerKey', 'user');
		} else {
			params.set('authorLayerKey', view);
		}
	}
	const res = await fetch(`/api/text-files?${params}`);
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(
			typeof err === 'object' && err && 'message' in err
				? String(err.message)
				: `Failed to list text files (${res.status})`
		);
	}
	const data = (await res.json()) as { textFiles: TextFileRecord[] };
	return data.textFiles;
}

export async function searchTextFiles(
	query: string,
	topK = 20,
	view?: string
): Promise<TextFileSearchHit[]> {
	const params = new URLSearchParams({ q: query, limit: String(topK) });
	if (view && view !== 'all') {
		if (view === 'user') {
			params.set('authorLayerKey', 'user');
		} else {
			params.set('authorLayerKey', view);
		}
	}
	const res = await fetch(`/api/text-files?${params}`);
	if (!res.ok) {
		throw new Error(`Failed to search text files (${res.status})`);
	}
	const data = (await res.json()) as { results: TextFileSearchHit[] };
	return data.results;
}

export async function fetchTextFile(fileId: string): Promise<TextFileRecord> {
	const res = await fetch(`/api/text-files/${fileId}`);
	if (!res.ok) {
		throw new Error(`Failed to load text file (${res.status})`);
	}
	const data = (await res.json()) as { textFile: TextFileRecord };
	return data.textFile;
}

export async function fetchLinkedThoughts(fileId: string): Promise<TextFileLinkedThought[]> {
	const res = await fetch(`/api/text-files/${fileId}/thoughts`);
	if (!res.ok) {
		throw new Error(`Failed to load linked thoughts (${res.status})`);
	}
	const data = (await res.json()) as { linkedThoughts: TextFileLinkedThought[] };
	return data.linkedThoughts;
}

export async function createTextFile(input: {
	title?: string;
	body?: string;
}): Promise<TextFileRecord> {
	const res = await fetch('/api/text-files', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(input)
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(
			typeof err === 'object' && err && 'message' in err
				? String(err.message)
				: `Failed to create text file (${res.status})`
		);
	}
	const data = (await res.json()) as { textFile: TextFileRecord };
	return data.textFile;
}

export async function updateTextFile(
	fileId: string,
	input: { title?: string; body?: string }
): Promise<TextFileRecord> {
	const res = await fetch(`/api/text-files/${fileId}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(input)
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(
			typeof err === 'object' && err && 'message' in err
				? String(err.message)
				: `Failed to update text file (${res.status})`
		);
	}
	const data = (await res.json()) as { textFile: TextFileRecord };
	return data.textFile;
}

export async function deleteTextFile(fileId: string): Promise<void> {
	const res = await fetch(`/api/text-files/${fileId}`, { method: 'DELETE' });
	if (!res.ok) {
		throw new Error(`Failed to delete text file (${res.status})`);
	}
}

export async function linkTextFileToThought(
	thoughtId: string,
	textFileId: string
): Promise<void> {
	const res = await fetch(`/api/thoughts/${thoughtId}/text-files`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ textFileId })
	});
	if (!res.ok) {
		throw new Error(`Failed to link text file (${res.status})`);
	}
}

export async function unlinkTextFileFromThought(
	thoughtId: string,
	textFileId: string
): Promise<void> {
	const res = await fetch(`/api/thoughts/${thoughtId}/text-files/${textFileId}`, {
		method: 'DELETE'
	});
	if (!res.ok) {
		throw new Error(`Failed to unlink text file (${res.status})`);
	}
}

export type { CaptureAttachedFile };
