import {
	DataTypes,
	Model,
	ModelAttributes,
	ModelCtor,
	ModelStatic,
	Op,
	Sequelize,
} from 'sequelize';
import { createNamespace, getNamespace, Namespace } from 'cls-hooked';

interface ConfigOptions {
	continuationKey: string;
	continuationNamespace: string | null;
	debug: boolean;
	defaultAttributes: {
		modelId: string; // Column name for Primary key on Model being tracked
		modelId2: string;
		revision: string; // Model Revision tracking Column
		revisionModel: string; // Sequelize name for Revision Model
		revisionModelTableName: string; // DB table name for Revision Model
		userId: string; // user id column for revision table
	};
	enableMigration: boolean;
	enableRevisionAttributeMigration: boolean;
	exclude: string[];
	failHard: boolean;
	freezeTableName: boolean;
	log: any;
	mysql: boolean;
	trackFullModel: boolean;
	useCompositeKeys: boolean;
	underscored: boolean;
	underscoredAttributes: boolean;
	userModel: ModelStatic<any> | null;
}

type DeepPartial<T> = {
	[P in keyof T]?: DeepPartial<T[P]>;
};

export default class SequelizeCentralLog {
	private configuration: ConfigOptions;
	private log: any;
	private ns: Namespace | undefined;
	private modelLevelExclude: { [key: string]: string[] } = {};
	private usesCompositeKeys: string[] = [];
	private settings: ConfigOptions = {
		continuationKey: 'userId',
		continuationNamespace: null,
		debug: false,
		defaultAttributes: {
			modelId: 'model_id',
			modelId2: 'model_id2',
			revision: 'revision',
			revisionModel: 'Revision',
			revisionModelTableName: 'Revision',
			userId: 'userId',
		},
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
		log: console.log,
		mysql: false,
		trackFullModel: false,
		useCompositeKeys: false,
		underscored: false,
		underscoredAttributes: false,
		userModel: null,
	};
	private revisionModel: ModelCtor<Model<any>>;

	constructor(
		private sequelizeDB: Sequelize,
		private options: DeepPartial<ConfigOptions>,
	) {
		this.settings.mysql = this.sequelizeDB.getDialect() === 'mysql';

		this.configuration = <ConfigOptions>{
			...this.settings,
			...this.options,
			defaultAttributes: {
				...this.settings.defaultAttributes,
				...this.options.defaultAttributes,
			},
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
	 */
	public defineModels(): ModelCtor<Model<any>> {
		// set revision Model in sequelize.
		const attributes: ModelAttributes = {
			model: {
				type: DataTypes.TEXT,
				allowNull: false,
			},
			[this.configuration.defaultAttributes.modelId]: {
				type: DataTypes.INTEGER,
				allowNull: false,
			},
			[this.configuration.defaultAttributes.modelId2]: {
				type: DataTypes.INTEGER,
				allowNull: true,
			},
			[this.configuration.defaultAttributes.userId]: {
				type: DataTypes.INTEGER,
				allowNull: true,
				defaultValue: 0,
			},
			operation: DataTypes.STRING(7),
			[this.configuration.defaultAttributes.revision]: {
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
			delete attributes[this.configuration.defaultAttributes.userId];
		}
		if (!this.configuration.trackFullModel) {
			delete attributes.current;
		}
		if (!this.configuration.useCompositeKeys) {
			delete attributes[this.configuration.defaultAttributes.modelId2];
		}

		const Revision = this.sequelizeDB.define(
			this.configuration.defaultAttributes.revisionModel,
			attributes,
			{
				freezeTableName: this.configuration.freezeTableName,
				underscored: this.configuration.underscored,
				tableName: this.configuration.defaultAttributes.revisionModelTableName,
				updatedAt: false,
			},
		);

		if (this.configuration.userModel) {
			Revision.belongsTo(this.configuration.userModel);
		}
		if (this.configuration.enableMigration) Revision.sync();

		this.revisionModel = Revision;
		return Revision;
	}

	/**
	 * Enables and add history tracking to the passed in Model
	 * @param model Sequelize Model to add history tracking to
	 * @param options
	 */
	public addHistory(
		model: any,
		options?: { exclude?: string[]; hasCompositeKey?: boolean },
	): void {
		if (this.configuration.debug) {
			this.log(`Enabling paper trail on ${model.name}`);
		}

		if (options?.exclude) {
			this.modelLevelExclude[model.name] = options.exclude;
		} else {
			this.modelLevelExclude[model.name] = [];
		}

		const primaryKeys = model.primaryKeyAttributes;

		// Add the Revision column to the model
		model.rawAttributes['revision'] = {
			type: DataTypes.INTEGER,
			defaultValue: 0,
		};
		model.refreshAttributes();

		// add revision attribute to the model
		if (this.configuration.enableRevisionAttributeMigration) {
			const tableName = model.getTableName();
			const queryInterface = this.sequelizeDB.getQueryInterface();
			const revisionAttribute = this.configuration.defaultAttributes.revision;

			queryInterface.describeTable(tableName).then((attributes) => {
				if (!attributes[revisionAttribute]) {
					if (this.configuration.debug) {
						this.log(`Adding revision attribute to ${tableName}`);
					}

					queryInterface
						.addColumn(tableName, revisionAttribute, {
							type: DataTypes.INTEGER,
							defaultValue: 0,
						})
						.catch((error) => {
							this.log(
								`Error occured while adding revisionAttribute to ${tableName}.. ${error}`,
							);
						});
				}
			});
		}

		model.addHook('beforeCreate', this.createBeforeHook('create'));
		model.addHook('beforeUpdate', this.createBeforeHook('update'));
		model.addHook('beforeDestroy', this.createBeforeHook('destroy'));
		model.addHook('afterCreate', this.createAfterHook('create'));
		model.addHook('afterUpdate', this.createAfterHook('update'));
		model.addHook('afterDestroy', this.createAfterHook('destroy'));

		const scope: { [key: string]: string | number | { [Op.col]: any } } = {
			model: model.name,
		};
		if (options?.hasCompositeKey) {
			if (primaryKeys.length < 2) {
				throw new Error(
					`Model ${model.name}: Only has one primary Key, please check Model definition or don't pass hasCompositeKey: true`,
				);
			}
			scope[this.configuration.defaultAttributes.modelId2] = {
				[Op.col]: `${model.name}.${primaryKeys[1]}`,
			};
			this.usesCompositeKeys.push(model.name);
		}

		// Add association to revision.
		model.hasMany(
			this.sequelizeDB.models[
				this.configuration.defaultAttributes.revisionModel
			],
			{
				foreignKey: this.configuration.defaultAttributes.modelId,
				constraints: false,
				scope,
			},
		);
	}

	private getPrimaryKeys(instance: any): string[] {
		return Object.getPrototypeOf(instance).constructor.primaryKeyAttributes;
	}

	private removeKeys(obj: any, instance: any): void {
		const finalExclude = [
			...this.configuration.exclude,
			...this.modelLevelExclude[instance.constructor.name],
			...this.getPrimaryKeys(instance),
		];
		for (const k in obj) {
			if (
				(obj[k] instanceof Object && !(obj[k] instanceof Date)) ||
				!obj[k] ||
				finalExclude.some((rm) => rm === k)
			) {
				delete obj[k];
			}
		}
	}

	private createBeforeHook(operation: string) {
		return (instance: any, opt: any) => {
			// Allow disabling of history for a transaction // No reason to go further
			if (opt.noHistory) {
				if (this.configuration.log) {
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
					![
						...this.configuration.exclude,
						...this.modelLevelExclude[modelName],
					].some((filterValue) => filterValue === value),
			);
			this.removeKeys(currentVersion, instance);
			this.removeKeys(previousVersion, instance);

			// Don't allow revision to be modified.
			instance.set('revision', previousVersion['revision']);
			const currentRevision = instance.get('revision');

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
						[attribute]: {
							old: previousVersion[attribute],
							new: currentVersion[attribute],
						},
					};
				});
			}

			if (destroyOperation || (diff && diff.length > 0)) {
				instance.set(
					this.configuration.defaultAttributes.revision,
					(currentRevision || 0) + 1,
				);
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
		return (instance: any, opt: any) => {
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
				((instance.context.diff && instance.context.diff.length > 0) ||
					destroyOperation)
			) {
				const diff = instance.context.diff;
				const currentRevision = instance.get(
					this.configuration.defaultAttributes.revision,
				);
				const revisionValues = {
					model: modelName,
					[this.configuration.defaultAttributes.modelId]: instance.get(
						primaryKeys[0],
					),
					operation,
					[this.configuration.defaultAttributes.revision]: currentRevision,
					diff,
				};

				if (this.configuration.trackFullModel) {
					revisionValues.current = currenVersion;
				}

				// Set User by Continuation Key, userId set on the Option for the transaction or null if it can't figure it out.
				// Opt params take precedent.
				if (this.configuration.userModel) {
					revisionValues[this.configuration.defaultAttributes.userId] =
						opt.userId ||
						(this.ns && this.ns.get(this.configuration.continuationKey)) ||
						null;
				}
				if (
					this.configuration.useCompositeKeys &&
					this.usesCompositeKeys.some((key) => key === modelName)
				) {
					revisionValues[this.configuration.defaultAttributes.modelId2] =
						instance.get(primaryKeys[1]);
				}

				this.revisionModel.create(revisionValues).catch((error) => {
					console.log(error);
				});
			}

			if (this.configuration.debug) {
				this.log('End of AfterHook');
			}
			return;
		};
	}
}
