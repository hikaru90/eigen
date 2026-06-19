import type { CaptureAttachedFile } from '$lib/capture/capture-result-types';

export type TextFileRecord = {
	id: string;
	title: string;
	body: string;
	createdAt: string;
	updatedAt: string;
};

export async function fetchTextFiles(limit = 20): Promise<TextFileRecord[]> {
	const res = await fetch(`/api/text-files?limit=${limit}`);
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

export async function fetchTextFile(fileId: string): Promise<TextFileRecord> {
	const res = await fetch(`/api/text-files/${fileId}`);
	if (!res.ok) {
		throw new Error(`Failed to load text file (${res.status})`);
	}
	const data = (await res.json()) as { textFile: TextFileRecord };
	return data.textFile;
}

export async function createTextFile(input: {
	title?: string;
	body: string;
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
