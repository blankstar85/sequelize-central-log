import { DataType, DataTypes, Model, ModelAttributes, Op, Sequelize } from 'sequelize';
import { createNamespace, getNamespace, Namespace } from 'cls-hooked';
import { ModelDefined, Logging as OriginalLogging } from 'sequelize/types/model';

interface ConfigOptions {
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
	failHard: boolean;
	freezeTableName: boolean;
	log: any;
	mysql: boolean;
	primaryKeyType: DataType;
	trackFullModel: boolean;
	useCompositeKeys: boolean;
	underscored: boolean;
	underscoredAttributes: boolean;
	userModel: ModelDefined<any, any> | null;
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
		 * Foreign Primary Key for user id INT
		 */
		userId?: number;
	}
}

export type CentralLogOptions = Partial<ConfigOptions>;

export class SequelizeCentralLog {
	private configuration: ConfigOptions;
	private log: any;
	private ns: Namespace | undefined;
	private settings: ConfigOptions = {
		attributeModelId: 'modelId',
		attributeModelId2: 'modelId2',
		attributeModelId3: 'modelId3',
		attributeRevision: 'revision',
		attributeRevisionModel: 'Revision',
		attributeRevisionModelTableName: 'Revision',
		attributeUserId: 'userId',
		continuationKey: 'userId',
		continuationNamespace: null,
		debug: false,
		enableMigration: false,
		enableRevisionAttributeMigration: false,
		exclude: [
			'id',
			'createdAt',
			'updatedAt',
			'deletedAt',
			'created_at',
			'updated_at',
			'deleted_at',
			'revision',
		],
		failHard: false,
		freezeTableName: false,
		// eslint-disable-next-line no-console
		log: console.log,
		mysql: false,
		primaryKeyType: DataTypes.INTEGER,
		trackFullModel: false,
		useCompositeKeys: false,
		underscored: false,
		underscoredAttributes: false,
		userModel: null,
	};
	private revisionModel: ModelDefined<any, any>;

	constructor(
		private sequelizeDB: Sequelize,
		private centralLogOptions?: CentralLogOptions,
	) {
		this.settings.mysql = this.sequelizeDB.getDialect() === 'mysql';

		this.configuration = <ConfigOptions>{
			...this.settings,
			...this.centralLogOptions,
		};

		this.log = this.configuration.log;
		if (this.configuration.continuationNamespace) {
			this.ns = getNamespace(this.configuration.continuationNamespace);
			if (!this.ns) {
				this.ns = createNamespace(this.configuration.continuationNamespace);
			}
		}
	}

	/**
	 * Setup Revision Model and returns Revision Model.
	 * @returns ModelDefined<any, any> Revision Model for querying change data
	 */
	public async defineModels(): Promise<ModelDefined<any, any>> {
		// set revision Model in sequelize.
		const attributes: ModelAttributes = {
			model: {
				type: DataTypes.TEXT,
				allowNull: false,
			},
			[this.configuration.attributeModelId]: {
				type: this.configuration.primaryKeyType,
				allowNull: false,
			},
			[this.configuration.attributeModelId2]: {
				type: this.configuration.primaryKeyType,
				allowNull: true,
			},
			[this.configuration.attributeModelId3]: {
				type: this.configuration.primaryKeyType,
				allowNull: true,
			},
			[this.configuration.attributeUserId]: {
				type: DataTypes.INTEGER,
				allowNull: true,
				defaultValue: null,
			},
			operation: DataTypes.STRING(7),
			[this.configuration.attributeRevision]: {
				type: DataTypes.INTEGER,
				allowNull: false,
			},
			current: {
				type: DataTypes.JSON,
				allowNull: false,
			},
			diff: {
				type: DataTypes.JSON,
				allowNull: false,
			},
		};

		if (!this.configuration.userModel) {
			delete attributes[this.configuration.attributeUserId];
		}
		if (!this.configuration.trackFullModel) {
			delete attributes.current;
		}
		if (!this.configuration.useCompositeKeys) {
			delete attributes[this.configuration.attributeModelId2];
			delete attributes[this.configuration.attributeModelId3];
		}

		const Revision = this.sequelizeDB.define(
			this.configuration.attributeRevisionModel,
			attributes,
			{
				freezeTableName: this.configuration.freezeTableName,
				underscored: this.configuration.underscored,
				tableName: this.configuration.attributeRevisionModelTableName,
				updatedAt: false,
			},
		);

		Revision.addHook('beforeUpdate', this.readOnlyHook);
		Revision.addHook('beforeDestroy', this.readOnlyHook);

		if (this.configuration.userModel) {
			Revision.belongsTo(this.configuration.userModel, {
				foreignKey: this.configuration.attributeUserId,
			});
		}
		if (this.configuration.enableMigration) await Revision.sync();

		this.revisionModel = Revision;
		return Revision;
	}

	/**
	 * Enables and add history tracking to the passed in Model
	 * @param model Sequelize Model to add history tracking to
	 * @param options Model level Options exclude removes columns on model only, hasCompositeKey enables multi key tracking, thirdCompositeKeyCount if it has three keys
	 */
	public async addHistory(
		model: ModelDefined<any, any>,
		options?: {
			exclude?: string[];
			hasCompositeKey?: boolean;
			thirdCompositeKey?: boolean;
			disableHistoryAutoHook?: boolean;
		},
	): Promise<void> {
		if (this.configuration.debug) {
			this.log(`Enabling Central Log on ${model.name}`);
		}

		model['modelLevelExclude'] = options?.exclude || [];

		const primaryKeys = model.primaryKeyAttributes;

		// Add the Revision column to the model
		model.rawAttributes['revision'] = {
			type: DataTypes.INTEGER,
			defaultValue: 0,
		};
		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		//@ts-ignore
		model.refreshAttributes();

		// add revision attribute to the model
		if (this.configuration.enableRevisionAttributeMigration) {
			const tableName = model.getTableName();
			const queryInterface = this.sequelizeDB.getQueryInterface();
			const revisionAttribute = this.configuration.attributeRevision;

			const tableAttributes = await queryInterface.describeTable(tableName);

			if (!tableAttributes[revisionAttribute]) {
				if (this.configuration.debug) {
					this.log(`Adding revision attribute to ${tableName}`);
				}
				try {
					await queryInterface.addColumn(tableName, revisionAttribute, {
						type: DataTypes.INTEGER,
						defaultValue: 0,
					});
				} catch (error) {
					this.log(`Error occured while adding revisionAttribute to ${tableName}.. ${error}`);
				}
			}
		}

		model.addHook('beforeCreate', this.createBeforeHook('create'));
		model.addHook('beforeUpdate', this.createBeforeHook('update'));
		model.addHook('beforeDestroy', this.createBeforeHook('destroy'));
		model.addHook('afterCreate', this.createAfterHook('create'));
		model.addHook('afterUpdate', this.createAfterHook('update'));
		model.addHook('afterDestroy', this.createAfterHook('destroy'));
		model.addHook('beforeBulkCreate', this.bulkCreateHook);
		model.addHook('beforeBulkUpdate', this.bulkUpdateDestroyHook);
		model.addHook('beforeBulkDestroy', this.bulkUpdateDestroyHook);

		const scope: { [key: string]: string | number | { [Op.col]: any } } = {
			model: Model.name,
		};

		if (options?.disableHistoryAutoHook) {
			model['disableAutoHistoryIndividualHook'] = true;
		}

		if (options?.hasCompositeKey) {
			if (primaryKeys.length < 2) {
				throw new Error(
					`Model ${Model.name}: Only has one primary Key, please check Model definition or don't pass hasCompositeKey: true`,
				);
			}
			scope[this.configuration.attributeModelId2] = {
				[Op.col]: `${Model.name}.${primaryKeys[1]}`,
			};

			model['usesCompositeKeys'] = true;

			if (options?.thirdCompositeKey) {
				if (primaryKeys.length < 3) {
					throw new Error(
						`Model ${Model.name}: Was marked to have three keys, but has less or more than 3, please check model definition or don't pass thirdCompositeKey.`,
					);
				}
				model['thirdCompositeKey'] = true;
				scope[this.configuration.attributeModelId3] = {
					[Op.col]: `${Model.name}.${primaryKeys[2]}`,
				};
			}
		}

		// Add association to revision.
		model.hasMany(this.sequelizeDB.models[this.configuration.attributeRevisionModel], {
			foreignKey: this.configuration.attributeModelId,
			constraints: false,
			scope,
		});
	}

	private getPrimaryKeys(instance: any): string[] {
		return Object.getPrototypeOf(instance).constructor.primaryKeyAttributes;
	}

	private removeKeys(obj: any, instance: any): void {
		const finalExclude = [
			...this.configuration.exclude,
			...instance.constructor.modelLevelExclude,
			...this.getPrimaryKeys(instance),
		];
		for (const k in obj) {
			if (
				(obj[k] instanceof Object && !(obj[k] instanceof Date)) ||
				finalExclude.some((rm) => rm === k)
			) {
				delete obj[k];
			}
		}
	}

	private readOnlyHook() {
		throw new Error(`This is a read-only revision table. You cannot update/destroy records.`);
	}

	private bulkCreateHook(instances, options) {
		if (
			!options.individualHooks &&
			!instances.some((instance) => instance.constructor.disableAutoHistoryIndividualHook)
		) {
			options.individualHooks = true;
		}
	}

	private bulkUpdateDestroyHook(options) {
		if (!options.individualHooks && !options.model.disableAutoHistoryIndividualHook) {
			options.individualHooks = true;
		}
	}

	private createBeforeHook(operation: string) {
		return (instance: any, opt: any) => {
			// Allow disabling of history for a transaction // No reason to go further
			if (opt.noHistory) {
				if (this.configuration.debug) {
					this.log('Transaction set to ignore logging, opt.noHistory: true');
				}
				return;
			}

			// Setup
			const destroyOperation = operation === 'destroy';
			const modelName = instance.constructor.name;
			const previousVersion = { ...instance._previousDataValues };
			const currentVersion = { ...instance.dataValues };
			const changedValues: string[] = Array.from(instance._changed);

			// Filter columns from data that we don't care to track.
			const diffValuesToRead = changedValues.filter(
				(value) =>
					![...this.configuration.exclude, ...instance.constructor.modelLevelExclude].some(
						(filterValue) => filterValue === value,
					),
			);
			this.removeKeys(currentVersion, instance);
			this.removeKeys(previousVersion, instance);

			// Don't allow revision to be modified.
			instance.set(this.configuration.attributeRevision, instance._previousDataValues['revision']);
			const currentRevision = instance.get(this.configuration.attributeRevision);

			if (this.configuration.debug) {
				this.log(`BeforeHook Called on instance: ${modelName}`);
				this.log(`PrefilterChanges: ${changedValues.toString()}`);
			}

			let diff;
			if (destroyOperation) {
				diff = previousVersion;
			} else {
				diff = diffValuesToRead.map((attribute: string) => {
					return {
						key: attribute,
						values: {
							old: previousVersion[attribute] || null,
							new: currentVersion[attribute],
						},
					};
				});
			}

			if (destroyOperation || (diff && diff.length > 0)) {
				// Set current revision, starting at 0 for create and adding one for every revision. If record already exists, start incrementing.
				let revision = 0;
				if (operation !== 'create') {
					revision = (currentRevision || 0) + 1;
				}
				instance.set(this.configuration.attributeRevision, revision);
				if (!instance.context) {
					instance.context = {};
				}
				instance.context.diff = diff;
			}

			if (this.configuration.debug) {
				this.log(`Diff: ${JSON.stringify(diff)}`);
				this.log('End of beforeHook');
			}
		};
	}

	private createAfterHook(operation: string) {
		return async (instance: any, opt: any) => {
			const modelName = instance.constructor.name;
			const currenVersion = { ...instance.dataValues };
			const destroyOperation = operation === 'destroy';
			const primaryKeys = this.getPrimaryKeys(instance);

			if (this.configuration.debug) {
				this.log(`afterHook Called on instance: ${modelName}`);
				this.log(`Operation: ${operation}`);
				this.log('afterHook called');
				// Log cls ns
				if (this.ns) {
					this.log(this.ns.get(this.configuration.continuationKey));
				}
			}

			// filter values
			this.removeKeys(currenVersion, instance);

			if (
				instance.context &&
				((instance.context.diff && instance.context.diff.length > 0) || destroyOperation)
			) {
				const diff = instance.context.diff;
				const currentRevision = instance.get(this.configuration.attributeRevision);
				const revisionValues = {
					model: modelName,
					[this.configuration.attributeModelId]: instance.get(primaryKeys[0]),
					operation,
					[this.configuration.attributeRevision]: currentRevision,
					diff,
				};

				if (this.configuration.trackFullModel) {
					revisionValues.current = currenVersion;
				}

				// Set User by Continuation Key, userId set on the Option for the transaction or null if it can't figure it out.
				// Opt params take precedent.
				if (this.configuration.userModel) {
					revisionValues[this.configuration.attributeUserId] =
						opt.userId || (this.ns && this.ns.get(this.configuration.continuationKey)) || null;
				}
				if (this.configuration.useCompositeKeys && instance.constructor.usesCompositeKeys) {
					revisionValues[this.configuration.attributeModelId2] = instance.get(primaryKeys[1]);
					if (instance.constructor.thirdCompositeKey) {
						revisionValues[this.configuration.attributeModelId3] = instance.get(primaryKeys[2]);
					}
				}

				try {
					await this.revisionModel.create(revisionValues);
				} catch (error) {
					this.log(error);
				}
			}

			if (this.configuration.debug) {
				this.log('End of AfterHook');
			}
			return;
		};
	}
}
