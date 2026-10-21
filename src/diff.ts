import { DiffEntry } from './types';

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
 * Value equality that also covers JSON columns and dates.
 */
export function isSameValue(a: unknown, b: unknown): boolean {
	return a === b || JSON.stringify(a) === JSON.stringify(b);
}
