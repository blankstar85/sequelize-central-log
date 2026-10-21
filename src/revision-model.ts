import { DataTypes, ModelAttributes, Sequelize } from 'sequelize';
import { ModelDefined } from 'sequelize/types/model';
import { ConfigOptions } from './types';

export const READ_ONLY_MESSAGE =
	'This is a read-only revision table. You cannot update/destroy records.';

function readOnlyHook(): never {
	throw new Error(READ_ONLY_MESSAGE);
}

/**
 * Defines the central revision model and blocks every write path other than create.
 */
export function defineRevisionModel(
	sequelize: Sequelize,
	config: ConfigOptions,
): ModelDefined<any, any> {
	const attributes: ModelAttributes = {
		model: {
			type: DataTypes.TEXT,
			allowNull: false,
		},
		[config.attributeModelId]: {
			type: config.primaryKeyType,
			allowNull: false,
		},
		operation: DataTypes.STRING(7),
		[config.attributeRevision]: {
			type: DataTypes.INTEGER,
			allowNull: false,
		},
		diff: {
			type: DataTypes.JSON,
			allowNull: false,
		},
	};

	if (config.useCompositeKeys) {
		attributes[config.attributeModelId2] = {
			type: config.primaryKeyType,
			allowNull: true,
		};
		attributes[config.attributeModelId3] = {
			type: config.primaryKeyType,
			allowNull: true,
		};
	}
	if (config.userModel) {
		const userKey = config.userModel.primaryKeyAttribute;
		attributes[config.attributeUserId] = {
			// Match the user's key type so UUID / string ids work.
			type:
				config.userModel.getAttributes()[userKey]?.type ?? DataTypes.INTEGER,
			allowNull: true,
			defaultValue: null,
		};
	}
	if (config.trackFullModel) {
		attributes.current = {
			type: DataTypes.JSON,
			allowNull: false,
		};
	}

	const Revision = sequelize.define(config.attributeRevisionModel, attributes, {
		freezeTableName: config.freezeTableName,
		underscored: config.underscored,
		tableName: config.attributeRevisionModelTableName,
		updatedAt: false,
	});

	Revision.addHook('beforeUpdate', readOnlyHook);
	Revision.addHook('beforeDestroy', readOnlyHook);
	Revision.addHook('beforeBulkUpdate', readOnlyHook);
	Revision.addHook('beforeBulkDestroy', readOnlyHook);
	Revision.addHook('beforeUpsert', readOnlyHook);

	if (config.userModel) {
		Revision.belongsTo(config.userModel, {
			foreignKey: config.attributeUserId,
		});
	}

	return Revision;
}
