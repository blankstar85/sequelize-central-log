import { ConfigOptions, UserId } from './types';

type ClsHooked = typeof import('cls-hooked');

function loadClsHooked(): ClsHooked {
	try {
		// cls-hooked is an optional peer dependency, only loaded when continuationNamespace is used.
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		return require('cls-hooked');
	} catch {
		throw new Error(
			'continuationNamespace requires the optional peer dependency "cls-hooked". Install it, or use the getUserId option (e.g. with AsyncLocalStorage) instead.',
		);
	}
}

/**
 * Returns a function resolving the current user id from getUserId, then the cls namespace.
 */
export function createUserIdResolver(
	config: ConfigOptions,
): () => UserId | null {
	const { getUserId, continuationNamespace, continuationKey } = config;

	let cls: ClsHooked | undefined;
	if (continuationNamespace) {
		cls = loadClsHooked();
		// Create it up front so callers can getNamespace() it.
		if (!cls.getNamespace(continuationNamespace)) {
			cls.createNamespace(continuationNamespace);
		}
	}

	return () => {
		const userId = getUserId?.();
		if (userId != null) {
			return userId;
		}
		if (!cls || !continuationNamespace) {
			return null;
		}
		// Looked up on every call since the namespace may be recreated after setup.
		return (
			cls.getNamespace(continuationNamespace)?.get(continuationKey) ?? null
		);
	};
}
