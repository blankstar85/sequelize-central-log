import { DataTypes, Model, Op, Transaction, WhereOptions } from 'sequelize';
import { ModelDefined } from 'sequelize/types/model';
import { buildDiff, formatDiff, isSameValue, snapshot } from './diff';
import {
	AddHistoryOptions,
	ConfigOptions,
	DiffEntry,
	RevisionDiff,
	RevisionMetadata,
	RevisionOperation,
	UserId,
} from './types';

// Index signature lets attribute names be passed to changed() / previous().
type Instance = Model & Record<string, any>;

type InstanceOperation = 'create' | 'update' | 'destroy';

interface HookOptions {
	noHistory?: boolean;
	userId?: UserId;
	skipLoggingUser?: boolean;
	metadata?: RevisionMetadata;
	individualHooks?: boolean;
	transaction?: Transaction | null;
}

interface UpsertOptions extends HookOptions {
	instance: Instance;
	fields: string[];
}

interface UpsertState {
	/** Row before the upsert: null when it didn't exist, undefined when it couldn't be looked up. */
	existing: Instance | null | undefined;
}

interface BulkCreateOptions extends HookOptions {
	updateOnDuplicate?: string[];
	conflictAttributes?: string[];
}

/** Attribute values that identify a row, e.g. { id: 1 } or { sku: 'A' }. */
type KeyCondition = Record<string, unknown>;

interface BulkUpsertRow {
	/** Key values the row could conflict on, taken before the insert. */
	conditions: KeyCondition[];
	/** The row as it was before the statement, when it already existed. */
	existing?: Instance;
	/** Diff for a row that turns out to be new. */
	createDiff: DiffEntry[];
}

interface BulkUpsertState {
	/** Tracked attributes the statement updates on existing rows. */
	updateKeys: string[];
	rows: Map<Instance, BulkUpsertRow>;
}

export interface HistoryContext {
	config: ConfigOptions;
	revisionModel: ModelDefined<any, any>;
	resolveUserId: () => UserId | null;
}

/**
 * Tracks changes for one model by writing to the central revision table from its hooks.
 */
export class ModelHistory {
	private readonly exclude: Set<string>;
	// Diffs computed in before* hooks, written in after* hooks.
	private readonly pending = new WeakMap<Instance, RevisionDiff>();
	private readonly upserts = new WeakMap<object, UpsertState>();
	private readonly bulkUpserts = new WeakMap<object, BulkUpsertState>();

	constructor(
		private readonly model: ModelDefined<any, any>,
		private readonly options: AddHistoryOptions,
		private readonly context: HistoryContext,
	) {
		this.exclude = new Set([
			...context.config.exclude,
			...(options.exclude ?? []),
			context.config.attributeRevision,
		]);
	}

	register(): void {
		const { model } = this;
		model.addHook('beforeCreate', this.beforeChange('create'));
		model.addHook('beforeUpdate', this.beforeChange('update'));
		model.addHook('beforeDestroy', this.beforeChange('destroy'));
		model.addHook('afterCreate', this.afterChange('create'));
		model.addHook('afterUpdate', this.afterChange('update'));
		model.addHook('afterDestroy', this.afterChange('destroy'));
		model.addHook('beforeUpsert', this.beforeUpsert);
		model.addHook('afterUpsert', this.afterUpsert);
		model.addHook('beforeBulkCreate', this.beforeBulkCreate);
		model.addHook('afterBulkCreate', this.afterBulkCreate);
		model.addHook('beforeBulkUpdate', this.forceIndividualHooks);
		model.addHook('beforeBulkDestroy', this.forceIndividualHooks);
	}

	private get config(): ConfigOptions {
		return this.context.config;
	}

	private debug(message: string): void {
		if (this.config.debug) {
			this.config.log(message);
		}
	}

	/**
	 * Attributes that end up in the diff: real columns that aren't excluded or primary keys.
	 */
	private trackedKeys(): string[] {
		const primaryKeys = this.model.primaryKeyAttributes;
		return Object.entries(this.model.getAttributes())
			.filter(
				([key, attribute]) =>
					!this.exclude.has(key) &&
					!primaryKeys.includes(key) &&
					!(attribute.type instanceof (DataTypes.VIRTUAL as any)),
			)
			.map(([key]) => key);
	}

	private forceIndividualHooks = (options: HookOptions): void => {
		if (this.options.disableHistoryAutoHook || options.noHistory) {
			return;
		}
		options.individualHooks = true;
	};

	private beforeChange(operation: InstanceOperation) {
		return (instance: Instance, options: HookOptions): void => {
			this.pending.delete(instance);
			if (options.noHistory) {
				this.debug('Transaction set to ignore logging, opt.noHistory: true');
				return;
			}

			const revisionKey = this.config.attributeRevision;
			const storedRevision = instance.previous(revisionKey) as
				number | undefined;
			// Don't allow revision to be modified by the caller.
			instance.set(revisionKey, storedRevision);

			const keys = this.trackedKeys();
			let diff: RevisionDiff;
			if (operation === 'destroy') {
				diff = snapshot(keys, (key) => instance.previous(key));
			} else {
				diff = buildDiff(
					keys.filter((key) => instance.changed(key)),
					(key) => (operation === 'create' ? null : instance.previous(key)),
					(key) => instance.getDataValue(key),
				);
				if (diff.length === 0) {
					return;
				}
			}

			instance.set(
				revisionKey,
				operation === 'create' ? 0 : (storedRevision ?? 0) + 1,
			);
			this.pending.set(instance, diff);
			if (this.config.debug) {
				this.debug(
					`${this.model.name} ${operation} diff: ${JSON.stringify(diff)}`,
				);
			}
		};
	}

	private afterChange(operation: InstanceOperation) {
		return async (instance: Instance, options: HookOptions): Promise<void> => {
			const diff = this.pending.get(instance);
			if (!diff) {
				return;
			}
			this.pending.delete(instance);
			await this.writeRevision(
				operation,
				instance,
				instance.get(this.config.attributeRevision) as number,
				diff,
				options,
			);
		};
	}

	private beforeUpsert = async (
		_values: unknown,
		options: UpsertOptions,
	): Promise<void> => {
		if (options.noHistory) {
			return;
		}
		// Look the row up by primary key so the diff has real old values.
		// Upserts that conflict on another unique key can't be resolved this way.
		const where = options.instance.where() as Record<string, unknown>;
		const hasPrimaryKey = Object.values(where).every((value) => value != null);
		const existing = hasPrimaryKey
			? await this.model.unscoped().findOne({
					where: where as WhereOptions,
					paranoid: false,
					transaction: options.transaction,
				})
			: undefined;
		this.upserts.set(options, { existing });
	};

	private afterUpsert = async (
		[record]: [Instance, boolean | null],
		options: UpsertOptions,
	): Promise<void> => {
		const state = this.upserts.get(options);
		if (!state) {
			return;
		}
		this.upserts.delete(options);

		const { existing } = state;
		const revisionKey = this.config.attributeRevision;
		const written = options.instance;
		const fields = new Set(options.fields);
		const keys = this.trackedKeys().filter((key) => fields.has(key));

		let operation: RevisionOperation;
		let revision: number;
		let diff: RevisionDiff;
		if (existing) {
			const changedKeys = keys.filter(
				(key) =>
					!isSameValue(existing.getDataValue(key), written.getDataValue(key)),
			);
			if (changedKeys.length === 0) {
				return;
			}
			operation = 'update';
			revision = ((existing.getDataValue(revisionKey) as number) ?? 0) + 1;
			diff = buildDiff(
				changedKeys,
				(key) => existing.getDataValue(key),
				(key) => written.getDataValue(key),
			);
		} else {
			operation = existing === null ? 'create' : 'upsert';
			revision =
				existing === null
					? 0
					: ((record.getDataValue(revisionKey) as number) ?? -1) + 1;
			diff = buildDiff(
				keys,
				() => null,
				(key) => written.getDataValue(key),
			);
		}

		// The upsert has already run, so the revision column is updated separately.
		await this.model.update(
			{ [revisionKey]: revision },
			{
				where: record.where() as WhereOptions,
				hooks: false,
				silent: true,
				transaction: options.transaction,
			},
		);
		record.set(revisionKey, revision, { raw: true });

		await this.writeRevision(operation, record, revision, diff, options);
	};

	private beforeBulkCreate = async (
		instances: Instance[],
		options: BulkCreateOptions,
	): Promise<void> => {
		if (!options.updateOnDuplicate) {
			this.forceIndividualHooks(options);
			return;
		}
		if (
			this.options.disableHistoryAutoHook ||
			options.noHistory ||
			options.individualHooks
		) {
			return;
		}
		// Saving row by row would log updated rows as creates on MySQL and fails on
		// Postgres and SQLite, so the statement stays a bulk insert and is tracked here.
		const keySets = this.conflictKeySets(options);
		const tracked = this.trackedKeys();
		const rows = new Map<Instance, BulkUpsertRow>();
		for (const instance of instances) {
			rows.set(instance, {
				conditions: keySets
					.map((keys) => this.keyCondition(instance, keys))
					.filter((condition): condition is KeyCondition => !!condition),
				createDiff: buildDiff(
					tracked.filter((key) => instance.changed(key)),
					() => null,
					(key) => instance.getDataValue(key),
				),
			});
			instance.set(this.config.attributeRevision, 0);
		}

		const allConditions = [...rows.values()].flatMap((row) => row.conditions);
		const existingRows = await this.findRows(allConditions, options);
		for (const row of rows.values()) {
			row.existing = matchRow(existingRows, row.conditions);
		}

		const trackedSet = new Set(tracked);
		this.bulkUpserts.set(options, {
			updateKeys: options.updateOnDuplicate.filter((key) =>
				trackedSet.has(key),
			),
			rows,
		});
	};

	private afterBulkCreate = async (
		instances: Instance[],
		options: BulkCreateOptions,
	): Promise<void> => {
		const state = this.bulkUpserts.get(options);
		if (!state) {
			return;
		}
		this.bulkUpserts.delete(options);

		// MySQL can report wrong auto-increment ids for new rows in a batch that also
		// updates rows, so new rows are read back by the keys they were inserted with.
		const created = [...state.rows.values()].filter((row) => !row.existing);
		const createdRows = await this.findRows(
			created.flatMap((row) => row.conditions),
			options,
		);

		const revisionKey = this.config.attributeRevision;
		for (const instance of instances) {
			const row = state.rows.get(instance);
			if (!row) {
				continue;
			}
			const { existing } = row;
			if (!existing) {
				if (row.createDiff.length > 0) {
					const stored = matchRow(createdRows, row.conditions) ?? instance;
					await this.writeRevision(
						'create',
						stored,
						0,
						row.createDiff,
						options,
					);
				}
				continue;
			}

			const changedKeys = state.updateKeys.filter(
				(key) =>
					!isSameValue(existing.getDataValue(key), instance.getDataValue(key)),
			);
			if (changedKeys.length === 0) {
				continue;
			}
			const revision =
				((existing.getDataValue(revisionKey) as number) ?? 0) + 1;
			// The statement wrote revision 0 to new rows only, so bump updated rows here.
			await this.model.update(
				{ [revisionKey]: revision },
				{
					where: existing.where() as WhereOptions,
					hooks: false,
					silent: true,
					transaction: options.transaction,
				},
			);
			const changed = new Set(changedKeys);
			const readNew = (key: string) =>
				changed.has(key)
					? instance.getDataValue(key)
					: existing.getDataValue(key);
			await this.writeRevision(
				'update',
				existing,
				revision,
				buildDiff(changedKeys, (key) => existing.getDataValue(key), readNew),
				options,
				readNew,
			);
		}
	};

	/**
	 * Attribute sets an insert can conflict on: conflictAttributes when given,
	 * otherwise the primary key and each unique key.
	 */
	private conflictKeySets(options: BulkCreateOptions): string[][] {
		if (options.conflictAttributes?.length) {
			return [options.conflictAttributes];
		}
		const attributeByField = new Map<string, string>();
		for (const [name, attribute] of Object.entries(
			this.model.getAttributes(),
		)) {
			attributeByField.set(attribute.field ?? name, name);
		}
		const toAttributes = (
			fields: (string | { name?: string; attribute?: string })[],
		) =>
			fields.map((field) => {
				const name =
					typeof field === 'string'
						? field
						: (field.attribute ?? field.name ?? '');
				return attributeByField.get(name) ?? name;
			});

		// uniqueKeys and _indexes aren't in Sequelize's types.
		const model = this.model as any;
		const keySets: string[][] = [[...this.model.primaryKeyAttributes]];
		for (const key of Object.values<{ fields: string[] }>(
			model.uniqueKeys ?? {},
		)) {
			keySets.push(toAttributes(key.fields));
		}
		for (const index of model._indexes ?? []) {
			if (index.unique && !index.where) {
				keySets.push(toAttributes(index.fields));
			}
		}
		return keySets.filter((keys) => keys.length > 0);
	}

	private keyCondition(
		instance: Instance,
		keys: string[],
	): KeyCondition | null {
		const condition: KeyCondition = {};
		for (const key of keys) {
			const value = instance.getDataValue(key);
			if (value == null) {
				return null;
			}
			condition[key] = value;
		}
		return condition;
	}

	private async findRows(
		conditions: KeyCondition[],
		options: HookOptions,
	): Promise<Instance[]> {
		if (conditions.length === 0) {
			return [];
		}
		return this.model.unscoped().findAll({
			where: { [Op.or]: conditions },
			paranoid: false,
			transaction: options.transaction,
		});
	}

	private async writeRevision(
		operation: RevisionOperation,
		instance: Instance,
		revision: number,
		diff: RevisionDiff,
		options: HookOptions,
		readCurrent: (key: string) => unknown = (key) => instance.getDataValue(key),
	): Promise<void> {
		const { config } = this;
		const primaryKeys = this.model.primaryKeyAttributes;

		const values: Record<string, unknown> = {
			model: this.model.name,
			[config.attributeModelId]: instance.get(primaryKeys[0]),
			operation,
			[config.attributeRevision]: revision,
			diff: Array.isArray(diff)
				? formatDiff(diff, operation, config.diffFormat)
				: diff,
		};

		if (config.trackFullModel) {
			values.current = snapshot(this.trackedKeys(), readCurrent);
		}
		// Option on the query takes precedence over getUserId / the cls namespace.
		if (config.userModel && !options.skipLoggingUser) {
			values[config.attributeUserId] =
				options.userId ?? this.context.resolveUserId();
		}
		if (config.metadata) {
			// Query options override getMetadata key by key; undeclared keys are ignored.
			const metadata = { ...config.getMetadata?.(), ...options.metadata };
			for (const key of Object.keys(config.metadata)) {
				if (metadata[key] !== undefined) {
					values[key] = metadata[key];
				}
			}
		}
		if (config.useCompositeKeys && this.options.hasCompositeKey) {
			values[config.attributeModelId2] = instance.get(primaryKeys[1]);
			if (this.options.thirdCompositeKey) {
				values[config.attributeModelId3] = instance.get(primaryKeys[2]);
			}
		}

		try {
			await this.context.revisionModel.create(values, {
				transaction: options.transaction,
			});
		} catch (error) {
			if (config.failHard) {
				throw error;
			}
			config.log(error);
		}
	}
}

/**
 * First row matching any of the conditions. Values are compared as strings
 * because drivers can return keys as a different type than they were set.
 */
function matchRow(
	rows: Instance[],
	conditions: KeyCondition[],
): Instance | undefined {
	for (const condition of conditions) {
		const row = rows.find((candidate) =>
			Object.entries(condition).every(
				([key, value]) => String(candidate.getDataValue(key)) === String(value),
			),
		);
		if (row) {
			return row;
		}
	}
	return undefined;
}
