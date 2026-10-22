import {
	DiffChange,
	DiffEntry,
	DiffFormat,
	RevisionDiff,
	RevisionOperation,
} from './types';

type ValueReader = (key: string) => unknown;

/**
 * Builds the key/value diff stored on create and update revisions.
 * Missing values are stored as null so falsy values (0, false, '') survive.
 */
export function buildDiff(
	keys: string[],
	readOld: ValueReader,
	readNew: ValueReader,
): DiffEntry[] {
	return keys.map((key) => ({
		key,
		values: { old: readOld(key) ?? null, new: readNew(key) ?? null },
	}));
}

/**
 * Copies the given attributes into a plain object, skipping ones that were never loaded.
 */
export function snapshot(
	keys: string[],
	read: ValueReader,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const key of keys) {
		const value = read(key);
		if (value !== undefined) {
			result[key] = value;
		}
	}
	return result;
}

/**
 * Converts a create, update or upsert diff to the stored format.
 */
export function formatDiff(
	entries: DiffEntry[],
	operation: RevisionOperation,
	format: DiffFormat,
): RevisionDiff {
	if (format === 'entries') {
		return entries;
	}
	const compact: Record<string, unknown> = {};
	for (const { key, values } of entries) {
		compact[key] =
			operation === 'update' ? [values.old, values.new] : values.new;
	}
	return compact;
}

/**
 * Reads a revision's diff in either format as a list of changed columns.
 * Accepts a revision instance or a raw row.
 */
export function readDiff(revision: {
	operation: string;
	diff: unknown;
}): DiffChange[] {
	// Raw queries on SQLite and MySQL can return JSON columns as text.
	const diff =
		typeof revision.diff === 'string'
			? JSON.parse(revision.diff)
			: revision.diff;
	if (Array.isArray(diff)) {
		return (diff as DiffEntry[]).map(({ key, values }) => ({
			key,
			old: values.old,
			new: values.new,
		}));
	}
	const columns = Object.entries((diff ?? {}) as Record<string, unknown>);
	switch (revision.operation) {
		case 'update':
			return columns.map(([key, [oldValue, newValue]]: [string, any]) => ({
				key,
				old: oldValue,
				new: newValue,
			}));
		case 'destroy':
			return columns.map(([key, value]) => ({ key, old: value, new: null }));
		default:
			return columns.map(([key, value]) => ({ key, old: null, new: value }));
	}
}

/**
 * Value equality that also covers JSON columns and dates.
 */
export function isSameValue(a: unknown, b: unknown): boolean {
	return a === b || JSON.stringify(a) === JSON.stringify(b);
}
