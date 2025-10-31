import 'mocha';
import { expect } from 'chai';
import { DataTypes, Model, Op, Optional, Sequelize } from 'sequelize';
import { SequelizeCentralLog } from './index';
import { createNamespace } from 'cls-hooked';
import { describe } from 'mocha';

interface TableClassAttributes {
	id: string;
	name: string;
}
type TableClassAttributesCreate = Optional<TableClassAttributes, 'id'>;

// Common Reduce function for column names
const reduceArray = (
	array: { key: string; values: { new: any; old; any } }[],
) => {
	return array.reduce((keyArray, currentkey) => {
		keyArray[currentkey.key] = currentkey.key;
		return keyArray;
	}, {});
};

describe('SequelizeCentralLog', () => {
	let sequelize: Sequelize;
	beforeEach(async () => {
		// DB Setup
		sequelize = new Sequelize('sqlite::memory:', { logging: false });

		sequelize.define('User', {
			name: {
				type: DataTypes.STRING,
			},
		});
		sequelize.define('PrimaryKey', {
			name: {
				type: DataTypes.STRING,
			},
			author: {
				type: DataTypes.STRING,
			},
			value: {
				type: DataTypes.BOOLEAN,
			},
		});
		sequelize.define('TwoKey', {
			id1: {
				primaryKey: true,
				type: DataTypes.INTEGER,
				allowNull: false,
			},
			id2: {
				primaryKey: true,
				type: DataTypes.INTEGER,
				allowNull: false,
			},
			name: {
				type: DataTypes.STRING,
			},
		});
		sequelize.define('ThreeKey', {
			id1: {
				primaryKey: true,
				type: DataTypes.INTEGER,
				allowNull: false,
			},
			id2: {
				primaryKey: true,
				type: DataTypes.INTEGER,
				allowNull: false,
			},
			id3: {
				primaryKey: true,
				type: DataTypes.INTEGER,
				allowNull: false,
			},
			name: {
				type: DataTypes.STRING,
			},
		});
		sequelize.define('NotIdPrimary', {
			notID: {
				type: DataTypes.INTEGER,
				primaryKey: true,
				autoIncrement: true,
			},
			value: {
				type: DataTypes.BOOLEAN,
			},
		});
		await sequelize.sync();
	});
	describe('Changes to Models', () => {
		let CentralLog;
		let Revision;
		let Table;
		beforeEach(async () => {
			CentralLog = new SequelizeCentralLog(sequelize, {
				enableRevisionAttributeMigration: true,
				enableMigration: true,
			});
			Revision = await CentralLog.defineModels();
			await CentralLog.addHistory(sequelize.model('PrimaryKey'));
			Table = sequelize.model('PrimaryKey');
		});
		it('on create should log a revision', async () => {
			const table = await Table.create({ name: 'dave', value: true });
			const revisions = await Revision.findAll();
			expect(table);
			expect(table.revision).to.equal(0);
			expect(revisions.length).to.equal(1);
			if (revisions) {
				expect(revisions[0]?.model).to.equal('PrimaryKey');
				expect(revisions[0]?.operation).to.equal('create');
				expect(revisions[0]?.diff).to.eql([
					{ key: 'name', values: { old: null, new: 'dave' } },
					{ key: 'value', values: { old: null, new: true } },
				]);
			}
		});
		it('on update it should log a revision', async () => {
			const table = await Table.create({ name: 'dave', value: true });
			await table.update({ name: 'bob', value: false });
			await table.update({ name: 'viviana' });
			const revisions = await Revision.findAll();
			expect(table);
			expect(table.revision).to.equal(2);
			expect(revisions.length).to.equal(3);
			expect(revisions[1].operation).to.equal('update');
			expect(revisions.map((value) => value.model)).to.eql([
				'PrimaryKey',
				'PrimaryKey',
				'PrimaryKey',
			]);
			expect(revisions.map((value) => value.revision)).eql([0, 1, 2]);
			expect(revisions[2]);
			if (revisions[2]) {
				expect(revisions[2].diff).to.eql([
					{ key: 'name', values: { old: 'bob', new: 'viviana' } },
				]);
				expect(revisions[2].revision).to.equal(2);
			}
		});
		it('on delete it should log a revision', async () => {
			const table = await Table.create({ name: 'dave', value: true });
			await table.destroy();
			const revisions = await Revision.findAll();
			expect(revisions.length).to.equal(2);
			expect(revisions[1]);
			if (revisions[1]) {
				expect(revisions[1].revision).to.equal(1);
				expect(revisions[1].operation).to.equal('destroy');
				expect(revisions[1].diff).to.eql({ name: 'dave', value: true });
			}
		});
	});
	describe('Bulk Changes to Models', () => {
		let CentralLog;
		let Revision;
		let Table;
		beforeEach(async () => {
			Table = sequelize.model('PrimaryKey');
			CentralLog = new SequelizeCentralLog(sequelize, {
				enableRevisionAttributeMigration: true,
				enableMigration: true,
			});
			Revision = await CentralLog.defineModels();
		});
		it('on bulkcreate it should log revisions', async () => {
			await CentralLog.addHistory(Table);
			const tables = await Table.bulkCreate([
				{ name: 'Dave' },
				{ name: 'Bob' },
				{ name: 'george' },
			]);
			const revisions = await Revision.findAll();
			expect(tables);
			expect(revisions.length).to.equal(3);
			expect(
				revisions.map((instance) => {
					return instance.diff[0];
				}),
			).to.eql([
				{ key: 'name', values: { old: null, new: 'Dave' } },
				{ key: 'name', values: { old: null, new: 'Bob' } },
				{ key: 'name', values: { old: null, new: 'george' } },
			]);
		});
		it('on bulkdelete it should log a revision', async () => {
			await CentralLog.addHistory(Table);
			const tables = await Table.bulkCreate([
				{ name: 'Dave' },
				{ name: 'Bob' },
				{ name: 'george' },
			]);
			await Table.destroy({ where: { id: { [Op.lte]: 3 } } });
			const revisions = await Revision.findAll();
			expect(tables);
			expect(revisions);
			expect(revisions.length).to.equal(6);
		});
		it('on bulkupdate it should log a revision', async () => {
			await CentralLog.addHistory(Table);
			const tables = await Table.bulkCreate([
				{ name: 'Dave' },
				{ name: 'Bob' },
				{ name: 'george' },
			]);
			await Table.update(
				{ value: true },
				{ where: { id: { [Op.in]: [1, 2, 3] } } },
			);
			const revisions = await Revision.findAll();
			expect(tables);
			expect(revisions);
			expect(revisions.length).to.equal(6);
			expect(revisions[5].diff).to.eql([
				{ key: 'value', values: { new: true, old: null } },
			]);
		});
		it('on bulk create/update/delete it should not log, disableHistoryAutoHook', async () => {
			await CentralLog.addHistory(Table, {
				disableHistoryAutoHook: true,
			});
			const tables = await Table.bulkCreate([
				{ name: 'Dave' },
				{ name: 'Bob' },
				{ name: 'george' },
			]);
			await Table.update(
				{ value: true },
				{ where: { id: { [Op.in]: [1, 2, 3] } } },
			);
			await Table.destroy({ where: { id: { [Op.lte]: 3 } } });
			const revisions = await Revision.findAll();
			expect(tables);
			expect(revisions);
			expect(revisions.length).to.equal(0);
		});
	});
	describe('Will not log Revision', () => {
		let CentralLog;
		let Revision;
		let Table;
		beforeEach(async () => {
			CentralLog = new SequelizeCentralLog(sequelize, {
				enableRevisionAttributeMigration: true,
				enableMigration: true,
			});
			Revision = await CentralLog.defineModels();
			await CentralLog.addHistory(sequelize.model('PrimaryKey'));
			Table = sequelize.model('PrimaryKey');
		});
		it('when there is a failed sequelize transaction', async () => {
			let table;
			try {
				table = await sequelize.transaction(async (t) => {
					const table = await Table.create(
						{ name: 'bob', value: 'true' },
						{ transaction: t },
					);
					await table.update({ name: 'bobs' });
					throw new Error();
				});
			} catch (error) {
				// die silently, we know}
			}
			const revisions = await Revision.findAll();
			expect(revisions.length).to.equal(0);
			expect(table).to.equal(undefined);
		});
		it('when noHistory added as option to', async () => {
			await Table.create({ name: 'bob', value: true }, { noHistory: true });
			const revisions = await Revision.findAll();
			expect(revisions.length).to.equal(0);
		});
	});
	describe('Recording Author ID', () => {
		let CentralLog;
		let Revision;
		let Table;
		let User;
		let user;
		beforeEach(async () => {
			Table = sequelize.model('PrimaryKey');
			User = sequelize.model('User');
			CentralLog = new SequelizeCentralLog(sequelize, {
				enableRevisionAttributeMigration: true,
				enableMigration: true,
				userModel: User,
				attributeUserId: 'userId',
				continuationNamespace: 'nameSpaceKey',
			});
			Revision = await CentralLog.defineModels();
			user = User.create({ name: 'Bob' });
			await CentralLog.addHistory(Table);
			await CentralLog.addHistory(User);
		});
		it('use namespace to record author id', async () => {
			const ns = createNamespace('nameSpaceKey');
			ns.run(async () => {
				ns.set('userId', 1);
				const table = await Table.create({ name: 'bob', value: true });
				const revisions = await Revision.findAll();
				expect(user.id).to.equal(1);
				expect(table);
				expect(revisions.length).to.equal(1);
				if (revisions[0]) {
					expect(revisions[0].userId).to.equal(1);
				}
			});
		});
		it('while using namespace to record author id, skip logging author id', async () => {
			const ns = createNamespace('nameSpaceKey');
			ns.run(async () => {
				ns.set('userId', 1);
				const table = await Table.create(
					{ name: 'bob', value: true },
					{ skipLoggingUser: true },
				);
				const revisions = await Revision.findAll();
				expect(user.id).to.equal(1);
				expect(table);
				expect(revisions.length).to.equal(1);
				if (revisions[0]) {
					expect(revisions[0].userId).to.equal(null);
				}
			});
		});
		it('use userId from model options to log user id, should override namespace', async () => {
			const user2 = await User.create(
				{ name: 'OtherBob' },
				{ noHistory: true },
			);
			const ns = createNamespace('nameSpaceKey');
			ns.run(async () => {
				ns.set('userId', 1);
				const table = await Table.create(
					{ name: 'Bobs Cousin', value: true },
					{ userId: 2 },
				);
				const revisions = await Revision.findAll();
				expect(user2);
				expect(user);
				expect(table);
				expect(revisions.length).to.equal(1);
				if (revisions) {
					expect(revisions[0].userId).to.equal(2);
				}
			});
		});
		it('should log null when author cannot be identified', async () => {
			const table = await Table.create({ name: 'bob', value: true });
			const revisions = await Revision.findAll();
			expect(table);
			expect(revisions.length).to.equal(1);
			expect(revisions[0]);
			if (revisions[0]) {
				expect(revisions[0].model).to.equal('PrimaryKey');
				expect(revisions[0].userId).to.equal(null);
			}
		});
	});
	describe('Should work with Composite Keys', () => {
		let CentralLog;
		let Revision;
		let Table;
		beforeEach(async () => {
			CentralLog = new SequelizeCentralLog(sequelize, {
				enableRevisionAttributeMigration: true,
				enableMigration: true,
				useCompositeKeys: true,
			});
			Revision = await CentralLog.defineModels();
		});
		it('should log the revision to a 2 composite key instance', async () => {
			Table = sequelize.model('TwoKey');
			await CentralLog.addHistory(Table, { hasCompositeKey: true });
			const table = await Table.create({ id1: 1, id2: 2, name: 'OtherBob' });
			const revisions = await Revision.findByPk(1);
			expect(table);
			expect(revisions);
			expect(revisions.modelId).to.equal(1);
			expect(revisions.modelId2).to.equal(2);
		});
		it('should log the revision to a 3 composite key instance', async () => {
			Table = sequelize.model('ThreeKey');
			await CentralLog.addHistory(Table, {
				hasCompositeKey: true,
				thirdCompositeKey: true,
			});
			const table = await Table.create({
				id1: 1,
				id2: 2,
				id3: 3,
				name: 'OtherBob',
			});
			const revisions = await Revision.findByPk(1);
			expect(table);
			expect(revisions);
			expect(revisions.modelId).to.equal(1);
			expect(revisions.modelId2).to.equal(2);
			expect(revisions.modelId3).to.equal(3);
		});
	});
	describe('Exclude Attributes from diff', () => {
		let CentralLog;
		let Revision;
		let Table;
		const excludeCentralOptions = [
			'id',
			'createdAt',
			'updatedAt',
			'deletedAt',
			'created_at',
			'updated_at',
			'deleted_at',
			'revision',
			'author',
		];
		beforeEach(async () => {
			Table = sequelize.model('PrimaryKey');
			CentralLog = new SequelizeCentralLog(sequelize, {
				enableRevisionAttributeMigration: true,
				enableMigration: true,
				exclude: excludeCentralOptions,
			});
			Revision = await CentralLog.defineModels();
		});
		it('should ignore excluded attributes from options', async () => {
			await CentralLog.addHistory(Table);
			const table = await Table.create({
				name: 'bob',
				author: 'bob2',
				value: true,
			});
			const revisions = await Revision.findAll();
			expect(table);
			expect(table.author).to.equal('bob2');
			expect(revisions.length).to.equal(1);
			if (revisions) {
				expect(reduceArray(revisions[0].diff)).to.not.include.any.keys(
					excludeCentralOptions,
				);
			}
		});
		it('should ignore model level excluded attributes', async () => {
			const modelExclude = ['value'];
			await CentralLog.addHistory(Table, { exclude: modelExclude });
			const table = await Table.create({
				name: 'bob',
				author: 'bob2',
				value: true,
			});
			const revisions = await Revision.findAll();
			expect(table);
			expect(table.author).to.equal('bob2');
			expect(revisions.length).to.equal(1);
			if (revisions) {
				expect(reduceArray(revisions[0].diff)).to.not.include.any.keys([
					...excludeCentralOptions,
					...modelExclude,
				]);
			}
		});
		it('should ignore model primary key when not id', async () => {
			const NotIdPrimary = sequelize.model('NotIdPrimary');
			await CentralLog.addHistory(NotIdPrimary);
			const table = await NotIdPrimary.create({ value: true });
			const revisions = await Revision.findAll();
			expect(table);
			expect(revisions.length).to.equal(1);
			if (revisions) {
				expect(reduceArray(revisions[0].diff)).to.not.include.any.keys([
					'notID',
				]);
			}
		});
	});
	describe('Disallow Changes to Revision Model', () => {
		let CentralLog;
		let Revision;
		let Table;
		beforeEach(async () => {
			Table = sequelize.model('PrimaryKey');
			CentralLog = new SequelizeCentralLog(sequelize, {
				enableRevisionAttributeMigration: true,
				enableMigration: true,
			});
			Revision = await CentralLog.defineModels();
			await CentralLog.addHistory(Table);
			await Table.create({ name: 'bob', value: true });
		});
		it('should not allow update or destroy to revision model', async () => {
			let revision = await Revision.findByPk(1);
			let errors = 0;
			try {
				revision = await revision.update({ modelId: 3 });
			} catch (error) {
				errors = errors + 1;
				expect(error);
				expect(error.message).to.equal(
					'This is a read-only revision table. You cannot update/destroy records.',
				);
				expect(revision.id).to.equal(1);
			}
			try {
				await revision.destroy();
			} catch (error) {
				errors = errors + 1;
				expect(error);
				expect(error.message).to.equal(
					'This is a read-only revision table. You cannot update/destroy records.',
				);
				const revisionStillExist = await Revision.findByPk(1);
				expect(revisionStillExist);
			}
			expect(errors).to.equal(2);
		});
	});
	describe('Should work with ES6 classes', () => {
		let CentralLog;
		let Revision;
		it('Should work with ES6 classes', async () => {
			CentralLog = new SequelizeCentralLog(sequelize, {
				enableRevisionAttributeMigration: true,
				enableMigration: true,
			});
			class TestModel extends Model<
				TableClassAttributes,
				TableClassAttributesCreate
			> {
				public id: number;
				public name: string;
				public revision: number;
			}
			TestModel.init(
				{
					id: {
						type: DataTypes.INTEGER,
						allowNull: false,
						primaryKey: true,
						autoIncrement: true,
					},
					name: DataTypes.STRING,
				},
				{ sequelize, freezeTableName: true },
			);
			await sequelize.sync();
			Revision = await CentralLog.defineModels();
			await CentralLog.addHistory(TestModel);
			const table = await TestModel.create({ name: 'bob' });
			const revision = await Revision.findAll();
			expect(table);
			expect(table.revision).to.equal(0);
			expect(revision.length).to.equal(1);
		});
	});
});
