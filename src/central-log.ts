import { DataTypes, Op, Sequelize, Transaction } from 'sequelize';
import { ModelDefined } from 'sequelize/types/model';
import { defaultOptions } from './defaults';
import { formatDiff } from './diff';
import { ModelHistory } from './model-history';
import { defineRevisionModel } from './revision-model';
import {
	AddHistoryOptions,
	CentralLogOptions,
	ConfigOptions,
	RevisionOperation,
	UserId,
} from './types';
import { createUserIdResolver } from './user-context';

export class SequelizeCentralLog {
	private readonly configuration: ConfigOptions;
	private readonly resolveUserId: () => UserId | null;
	private revisionModel: ModelDefined<any, any> | undefined;

	constructor(
		private sequelizeDB: Sequelize,
		centralLogOptions?: CentralLogOptions,
	) {
		this.configuration = {
			...defaultOptions,
			mysql: sequelizeDB.getDialect() === 'mysql',
			...centralLogOptions,
		};
		this.resolveUserId = createUserIdResolver(this.configuration);
	}

	/**
	 * Setup Revision Model and returns Revision Model.
	 * @returns ModelDefined<any, any> Revision Model for querying change data
	 */
	public async defineModels(): Promise<ModelDefined<any, any>> {
		this.revisionModel = defineRevisionModel(
			this.sequelizeDB,
			this.configuration,
		);
		if (this.configuration.enableMigration) {
			await this.revisionModel.sync();
		}
		return this.revisionModel;
	}

	/**
	 * Enables and add history tracking to the passed in Model
	 * @param model Sequelize Model to add history tracking to
	 * @param options Model level Options exclude removes columns on model only, hasCompositeKey enables multi key tracking, thirdCompositeKey if it has three keys
	 */
	public async addHistory(
		model: ModelDefined<any, any>,
		options: AddHistoryOptions = {},
	): Promise<void> {
		const revisionModel = this.revisionModel;
		if (!revisionModel) {
			throw new Error('Call defineModels() before addHistory().');
		}
		this.validateCompositeKeys(model, options);
		this.debug(`Enabling Central Log on ${model.name}`);

		this.addRevisionAttribute(model);
		if (this.configuration.enableRevisionAttributeMigration) {
			await this.migrateRevisionAttribute(model);
		}

		new ModelHistory(model, options, {
			config: this.configuration,
			revisionModel,
			resolveUserId: this.resolveUserId,
		}).register();

		model.hasMany(revisionModel, {
			foreignKey: this.configuration.attributeModelId,
			constraints: false,
			scope: this.associationScope(model, options),
		});
	}

	/**
	 * Rewrites create, update and upsert diffs stored in the 'entries' format as 'compact'.
	 * Works in batches and skips rows that are already compact, so it can be stopped
	 * and run again. Set diffFormat: 'compact' first so new revisions are compact too.
	 * @returns the number of revisions converted
	 */
	public async migrateDiffFormat(
		options: { batchSize?: number; transaction?: Transaction } = {},
	): Promise<number> {
		const Revision = this.revisionModel;
		if (!Revision) {
			throw new Error('Call defineModels() before migrateDiffFormat().');
		}
		const batchSize = options.batchSize ?? 500;
		let lastId = 0;
		let converted = 0;
		for (;;) {
			const rows = await Revision.findAll({
				attributes: ['id', 'operation', 'diff'],
				where: { id: { [Op.gt]: lastId } },
				order: [['id', 'ASC']],
				limit: batchSize,
				transaction: options.transaction,
			});
			if (rows.length === 0) {
				return converted;
			}
			for (const row of rows) {
				const stored = row.get('diff');
				const diff = typeof stored === 'string' ? JSON.parse(stored) : stored;
				if (!Array.isArray(diff)) {
					continue;
				}
				// hooks: false skips the read-only guard on the revision table.
				await Revision.update(
					{
						diff: formatDiff(
							diff,
							row.get('operation') as RevisionOperation,
							'compact',
						),
					},
					{
						where: { id: row.get('id') },
						hooks: false,
						transaction: options.transaction,
					},
				);
				converted++;
			}
			lastId = rows[rows.length - 1].get('id') as number;
		}
	}

	private debug(message: string): void {
		if (this.configuration.debug) {
			this.configuration.log(message);
		}
	}

	private validateCompositeKeys(
		model: ModelDefined<any, any>,
		options: AddHistoryOptions,
	): void {
		if (!options.hasCompositeKey) {
			return;
		}
		const keyCount = model.primaryKeyAttributes.length;
		if (!this.configuration.useCompositeKeys) {
			throw new Error(
				`Model ${model.name}: hasCompositeKey requires useCompositeKeys: true on SequelizeCentralLog.`,
			);
		}
		if (keyCount < 2) {
			throw new Error(
				`Model ${model.name}: Only has one primary Key, please check Model definition or don't pass hasCompositeKey: true`,
			);
		}
		if (options.thirdCompositeKey && keyCount < 3) {
			throw new Error(
				`Model ${model.name}: Was marked to have three keys, but has less than 3, please check model definition or don't pass thirdCompositeKey.`,
			);
		}
	}

	private addRevisionAttribute(model: ModelDefined<any, any>): void {
		model.rawAttributes[this.configuration.attributeRevision] = {
			type: DataTypes.INTEGER,
			defaultValue: 0,
		};
		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		//@ts-ignore
		model.refreshAttributes();
	}

	private async migrateRevisionAttribute(
		model: ModelDefined<any, any>,
	): Promise<void> {
		const tableName = model.getTableName();
		const queryInterface = this.sequelizeDB.getQueryInterface();
		const revisionAttribute = this.configuration.attributeRevision;

		const tableAttributes = await queryInterface.describeTable(tableName);
		if (tableAttributes[revisionAttribute]) {
			return;
		}
		this.debug(`Adding revision attribute to ${tableName}`);
		try {
			await queryInterface.addColumn(tableName, revisionAttribute, {
				type: DataTypes.INTEGER,
				defaultValue: 0,
			});
		} catch (error) {
			this.configuration.log(
				`Error occured while adding revisionAttribute to ${tableName}.. ${error}`,
			);
		}
	}

	/**
	 * Scope for the model -> revisions association. Extra composite keys are matched by column.
	 */
	private associationScope(
		model: ModelDefined<any, any>,
		options: AddHistoryOptions,
	): Record<string, unknown> {
		const primaryKeys = model.primaryKeyAttributes;
		const scope: Record<string, unknown> = { model: model.name };
		if (options.hasCompositeKey) {
			scope[this.configuration.attributeModelId2] = {
				[Op.col]: `${model.name}.${primaryKeys[1]}`,
			};
			if (options.thirdCompositeKey) {
				scope[this.configuration.attributeModelId3] = {
					[Op.col]: `${model.name}.${primaryKeys[2]}`,
				};
			}
		}
		return scope;
	}
}
