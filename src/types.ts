import { BelongsToOptions, DataType, ModelAttributes } from 'sequelize';
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
	/**
	 * How create, update and upsert diffs are stored. 'entries' is a list of
	 * { key, values: { old, new } }. 'compact' is { column: [old, new] } for updates
	 * and { column: value } for creates, about half the size. Read either with readDiff().
	 */
	diffFormat: DiffFormat;
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
	/**
	 * Returns metadata for the current change, e.g. a request id from AsyncLocalStorage.
	 * options.metadata on the query overrides it key by key.
	 */
	getMetadata: (() => RevisionMetadata | null | undefined) | null;
	log: (...args: unknown[]) => void;
	/**
	 * Extra columns on the revision table, e.g. { reason: DataTypes.STRING }.
	 * Values come from getMetadata and options.metadata.
	 */
	metadata: ModelAttributes | null;
	/** @deprecated Unused. */
	mysql: boolean;
	primaryKeyType: DataType;
	trackFullModel: boolean;
	useCompositeKeys: boolean;
	underscored: boolean;
	/** @deprecated Unused. */
	underscoredAttributes: boolean;
	userModel: ModelDefined<any, any> | null;
	/**
	 * Options for the revision -> user association. Defaults to constraints: false,
	 * so deleting a user keeps their id on the revisions they made.
	 */
	userAssociationOptions: Omit<BelongsToOptions, 'foreignKey'> | null;
}

export type DiffFormat = 'entries' | 'compact';

export type RevisionMetadata = Record<string, unknown>;

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

/**
 * Stored diff. Destroys store the removed values as { column: value } in either format.
 * Compact updates store { column: [old, new] }, compact creates and upserts { column: value }.
 */
export type RevisionDiff = DiffEntry[] | Record<string, unknown>;

/** One changed column, as returned by readDiff() for either format. */
export interface DiffChange {
	key: string;
	old: unknown;
	new: unknown;
}

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
		/**
		 * Values for the revision's metadata columns.
		 */
		metadata?: RevisionMetadata;
	}
}
