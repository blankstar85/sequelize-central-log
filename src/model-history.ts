import { DataTypes, Model, Transaction, WhereOptions } from 'sequelize';
import { ModelDefined } from 'sequelize/types/model';
import { buildDiff, isSameValue, snapshot } from './diff';
import {
	AddHistoryOptions,
	ConfigOptions,
	RevisionDiff,
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
		model.addHook('beforeBulkCreate', (_instances, options) =>
			this.forceIndividualHooks(options),
		);
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

	private async writeRevision(
		operation: RevisionOperation,
		instance: Instance,
		revision: number,
		diff: RevisionDiff,
		options: HookOptions,
	): Promise<void> {
		const { config } = this;
		const primaryKeys = this.model.primaryKeyAttributes;

		const values: Record<string, unknown> = {
			model: this.model.name,
			[config.attributeModelId]: instance.get(primaryKeys[0]),
			operation,
			[config.attributeRevision]: revision,
			diff,
		};

		if (config.trackFullModel) {
			values.current = snapshot(this.trackedKeys(), (key) =>
				instance.getDataValue(key),
			);
		}
		// Option on the query takes precedence over getUserId / the cls namespace.
		if (config.userModel && !options.skipLoggingUser) {
			values[config.attributeUserId] =
				options.userId ?? this.context.resolveUserId();
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
