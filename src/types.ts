import { DataType } from 'sequelize';
import {
	ModelDefined,
	Logging as OriginalLogging,
} from 'sequelize/types/model';

export type UserId = number | string;

export interface ConfigOptions {
	attributeModelId: string;
	attributeModelId2: string;
	attributeModelId3: string;
	attributeRevision: string;
	attributeRevisionModel: string;
	attributeRevisionModelTableName: string;
	attributeUserId: string;
	continuationKey: string;
	continuationNamespace: string | null;
	debug: boolean;
	enableMigration: boolean;
	enableRevisionAttributeMigration: boolean;
	exclude: string[];
	/**
	 * Rethrow errors from writing a revision instead of logging them.
	 * Inside a transaction this rolls back the change being tracked.
	 */
	failHard: boolean;
	freezeTableName: boolean;
	/**
	 * Returns the current user's id, e.g. from AsyncLocalStorage.
	 * Takes precedence over continuationNamespace; options.userId on the query overrides both.
	 */
	getUserId: (() => UserId | null | undefined) | null;
	log: (...args: unknown[]) => void;
	/** @deprecated Unused. */
	mysql: boolean;
	primaryKeyType: DataType;
	trackFullModel: boolean;
	useCompositeKeys: boolean;
	underscored: boolean;
	/** @deprecated Unused. */
	underscoredAttributes: boolean;
	userModel: ModelDefined<any, any> | null;
}

export type CentralLogOptions = Partial<ConfigOptions>;

export interface AddHistoryOptions {
	/** Attributes to exclude for this model only, added to the global exclude. */
	exclude?: string[];
	hasCompositeKey?: boolean;
	thirdCompositeKey?: boolean;
	/** Don't force individualHooks on bulk create/update/destroy. */
	disableHistoryAutoHook?: boolean;
}

export type RevisionOperation = 'create' | 'update' | 'destroy' | 'upsert';

export interface DiffEntry {
	key: string;
	values: { old: unknown; new: unknown };
}

/** Destroy revisions store the removed values instead of a key/value diff. */
export type RevisionDiff = DiffEntry[] | Record<string, unknown>;

// Add Typings for noHistory and userId on options.
declare module 'sequelize' {
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore
	export interface Logging extends OriginalLogging {
		/**
		 * Don't Track revision for this instance. defaults false.
		 */
		noHistory?: boolean;
		/**
		 * Primary key of the user making the change.
		 */
		userId?: UserId;
		/**
		 * Should Skip Logging User, useful for Tables that require Anonymous users.
		 */
		skipLoggingUser?: boolean;
	}
}
