import 'mocha';
import { expect } from 'chai';
import { DataTypes, Model, Op, Optional, Sequelize } from 'sequelize';
import { SequelizeCentralLog } from './index';
import { getNamespace } from 'cls-hooked';
import { AsyncLocalStorage } from 'async_hooks';
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
		sequelize = new Sequelize({
			dialect: 'sqlite',
			storage: ':memory:',
			logging: false,
		});

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
		sequelize.define('Typed', {
			count: {
				type: DataTypes.INTEGER,
			},
			flag: {
				type: DataTypes.BOOLEAN,
			},
			meta: {
				type: DataTypes.JSON,
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
			} catch {
				// die silently, we know
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
			user = await User.create({ name: 'Bob' });
			await CentralLog.addHistory(Table);
			await CentralLog.addHistory(User);
		});
		it('use namespace to record author id', async () => {
			const ns: any = getNamespace('nameSpaceKey');
			await ns.runPromise(async () => {
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
			const ns: any = getNamespace('nameSpaceKey');
			await ns.runPromise(async () => {
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
			const ns: any = getNamespace('nameSpaceKey');
			await ns.runPromise(async () => {
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
			// cls-hooked can leak contexts from earlier tests into later async continuations.
			const ns: any = getNamespace('nameSpaceKey');
			const table = await ns.runPromise(async () => {
				ns.set('userId', undefined);
				return Table.create({ name: 'bob', value: true });
			});
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
			} catch (error: any) {
				errors = errors + 1;
				expect(error);
				expect(error.message).to.equal(
					'This is a read-only revision table. You cannot update/destroy records.',
				);
				expect(revision.id).to.equal(1);
			}
			try {
				await revision.destroy();
			} catch (error: any) {
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
				declare id: number;
				declare name: string;
				declare revision: number;
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
	describe('Revision Associations', () => {
		let CentralLog;
		let Revision;
		beforeEach(async () => {
			CentralLog = new SequelizeCentralLog(sequelize, {
				enableRevisionAttributeMigration: true,
				enableMigration: true,
				useCompositeKeys: true,
			});
			Revision = await CentralLog.defineModels();
		});
		it('should include revisions for the model', async () => {
			const Table: any = sequelize.model('PrimaryKey');
			await CentralLog.addHistory(Table);
			const table = await Table.create({ name: 'dave', value: true });
			await table.update({ name: 'bob' });
			const other = await Table.create({ name: 'other' });

			const found: any = await Table.findByPk(table.id, {
				include: [Revision],
			});
			expect(found.Revisions.map((r) => r.revision)).to.have.members([0, 1]);
			expect(await table.getRevisions()).to.have.length(2);
			expect(await other.getRevisions()).to.have.length(1);
		});
		it('should include revisions for a composite key model', async () => {
			const Table: any = sequelize.model('TwoKey');
			await CentralLog.addHistory(Table, { hasCompositeKey: true });
			await Table.create({ id1: 1, id2: 1, name: 'a' });
			await Table.create({ id1: 1, id2: 2, name: 'b' });

			const found: any = await Table.findOne({
				where: { id1: 1, id2: 2 },
				include: [Revision],
			});
			expect(found.Revisions).to.have.length(1);
			expect(found.Revisions[0].modelId2).to.equal(2);
		});
		it('should require useCompositeKeys for hasCompositeKey', async () => {
			const log = new SequelizeCentralLog(sequelize, {
				attributeRevisionModel: 'OtherRevision',
			});
			await log.defineModels();
			let error;
			try {
				await log.addHistory(sequelize.model('TwoKey'), {
					hasCompositeKey: true,
				});
			} catch (e) {
				error = e;
			}
			expect(error?.message).to.contain('useCompositeKeys');
		});
	});
	describe('Diff Values', () => {
		let Revision;
		let Table;
		beforeEach(async () => {
			const CentralLog = new SequelizeCentralLog(sequelize, {
				enableRevisionAttributeMigration: true,
				enableMigration: true,
				trackFullModel: true,
			});
			Revision = await CentralLog.defineModels();
			Table = sequelize.model('Typed');
			await CentralLog.addHistory(Table);
		});
		it('should keep falsy old values', async () => {
			const table = await Table.create({ count: 0, flag: false });
			await table.update({ count: 5, flag: true });
			const revisions = await Revision.findAll({ order: [['id', 'ASC']] });
			expect(revisions[1].diff).to.eql([
				{ key: 'count', values: { old: 0, new: 5 } },
				{ key: 'flag', values: { old: false, new: true } },
			]);
		});
		it('should track JSON columns', async () => {
			const table = await Table.create({ meta: { a: 1 } });
			await table.update({ meta: { a: 2, tags: ['x'] } });
			const revisions = await Revision.findAll({ order: [['id', 'ASC']] });
			expect(revisions[0].diff).to.eql([
				{ key: 'meta', values: { old: null, new: { a: 1 } } },
			]);
			expect(revisions[1].diff).to.eql([
				{ key: 'meta', values: { old: { a: 1 }, new: { a: 2, tags: ['x'] } } },
			]);
			expect(revisions[1].current).to.eql({ meta: { a: 2, tags: ['x'] } });
		});
		it('should not log an update without tracked changes', async () => {
			const table = await Table.create({ count: 1 });
			await table.update({ count: 1 });
			expect(await Revision.count()).to.equal(1);
			expect(table.revision).to.equal(0);
		});
	});
	describe('Custom Revision Attribute', () => {
		it('should use attributeRevision on the tracked model', async () => {
			sequelize.define('Versioned', { name: DataTypes.STRING });
			await sequelize.sync();
			const CentralLog = new SequelizeCentralLog(sequelize, {
				enableRevisionAttributeMigration: true,
				enableMigration: true,
				attributeRevision: 'version',
			});
			const Revision: any = await CentralLog.defineModels();
			const Table: any = sequelize.model('Versioned');
			await CentralLog.addHistory(Table);

			const table = await Table.create({ name: 'a' });
			await table.update({ name: 'b' });
			await table.reload();
			expect(table.get('version')).to.equal(1);
			const revisions = await Revision.findAll({ order: [['id', 'ASC']] });
			expect(revisions.map((r) => r.version)).to.eql([0, 1]);
			expect(revisions[1].diff).to.eql([
				{ key: 'name', values: { old: 'a', new: 'b' } },
			]);
		});
	});
	describe('Upsert', () => {
		let Revision;
		let Table;
		beforeEach(async () => {
			const CentralLog = new SequelizeCentralLog(sequelize, {
				enableRevisionAttributeMigration: true,
				enableMigration: true,
			});
			Revision = await CentralLog.defineModels();
			Table = sequelize.model('PrimaryKey');
			await CentralLog.addHistory(Table);
		});
		it('should log create and update revisions for upserts by primary key', async () => {
			await Table.upsert({ id: 1, name: 'dave', value: true });
			await Table.upsert({ id: 1, name: 'bob', value: true });
			const revisions = await Revision.findAll({ order: [['id', 'ASC']] });
			expect(revisions.map((r) => r.operation)).to.eql(['create', 'update']);
			expect(revisions.map((r) => r.revision)).to.eql([0, 1]);
			expect(revisions[1].diff).to.eql([
				{ key: 'name', values: { old: 'dave', new: 'bob' } },
			]);
			const table = await Table.findByPk(1);
			expect(table.revision).to.equal(1);
		});
		it('should not log upserts without changes or with noHistory', async () => {
			await Table.upsert({ id: 1, name: 'dave' });
			await Table.upsert({ id: 1, name: 'dave' });
			await Table.upsert({ id: 1, name: 'bob' }, { noHistory: true });
			expect(await Revision.count()).to.equal(1);
		});
	});
	describe('Transactions and Errors', () => {
		let Revision;
		let Table;
		const setup = async (options = {}) => {
			const CentralLog = new SequelizeCentralLog(sequelize, {
				enableRevisionAttributeMigration: true,
				enableMigration: true,
				log: () => undefined,
				...options,
			});
			Revision = await CentralLog.defineModels();
			Table = sequelize.model('PrimaryKey');
			await CentralLog.addHistory(Table);
		};
		it('should write the revision in the same transaction', async () => {
			await setup();
			let revisionTransaction;
			Revision.addHook('beforeCreate', (_revision, options) => {
				revisionTransaction = options.transaction;
			});
			let transaction;
			await sequelize.transaction(async (t) => {
				transaction = t;
				await Table.create({ name: 'bob' }, { transaction: t });
			});
			expect(revisionTransaction).to.equal(transaction);
		});
		it('should swallow revision errors by default', async () => {
			await setup();
			Revision.addHook('beforeCreate', () => {
				throw new Error('revision failed');
			});
			const table = await Table.create({ name: 'bob' });
			expect(table.id).to.equal(1);
		});
		it('should rethrow revision errors with failHard', async () => {
			await setup({ failHard: true });
			Revision.addHook('beforeCreate', () => {
				throw new Error('revision failed');
			});
			let error;
			try {
				await sequelize.transaction(async (t) => {
					await Table.create({ name: 'bob' }, { transaction: t });
				});
			} catch (e) {
				error = e;
			}
			expect(error?.message).to.equal('revision failed');
			expect(await Table.count()).to.equal(0);
		});
	});
	describe('Recording Author ID with getUserId', () => {
		it('should resolve the user from AsyncLocalStorage', async () => {
			const storage = new AsyncLocalStorage<{ userId: number }>();
			const User = sequelize.model('User');
			const CentralLog = new SequelizeCentralLog(sequelize, {
				enableRevisionAttributeMigration: true,
				enableMigration: true,
				userModel: User,
				getUserId: () => storage.getStore()?.userId,
			});
			const Revision: any = await CentralLog.defineModels();
			const Table: any = sequelize.model('PrimaryKey');
			await CentralLog.addHistory(Table);

			const alice: any = await User.create({ name: 'Alice' });
			const bob: any = await User.create({ name: 'Bob' });
			await storage.run({ userId: alice.id }, async () => {
				await Table.create({ name: 'a' });
				await Table.create({ name: 'b' }, { userId: bob.id });
				await Table.create({ name: 'c' }, { skipLoggingUser: true });
			});
			await Table.create({ name: 'd' });
			const revisions = await Revision.findAll({ order: [['id', 'ASC']] });
			expect(revisions.map((r) => r.userId)).to.eql([
				alice.id,
				bob.id,
				null,
				null,
			]);
		});
	});
	describe('Read-only Revision Model bulk operations', () => {
		it('should not allow bulk update, bulk destroy or upsert', async () => {
			const CentralLog = new SequelizeCentralLog(sequelize, {
				enableRevisionAttributeMigration: true,
				enableMigration: true,
			});
			const Revision: any = await CentralLog.defineModels();
			const Table: any = sequelize.model('PrimaryKey');
			await CentralLog.addHistory(Table);
			await Table.create({ name: 'bob' });

			const attempts = [
				() => Revision.update({ modelId: 3 }, { where: {} }),
				() => Revision.destroy({ where: {} }),
				() => Revision.upsert({ id: 1, model: 'x', modelId: 1 }),
			];
			for (const attempt of attempts) {
				let error;
				try {
					await attempt();
				} catch (e) {
					error = e;
				}
				expect(error?.message).to.equal(
					'This is a read-only revision table. You cannot update/destroy records.',
				);
			}
			expect(await Revision.count()).to.equal(1);
		});
	});
});
