import 'mocha';
import { expect } from 'chai';
import { DataTypes, Dialect, Model, Op, Optional, Sequelize } from 'sequelize';
import { readDiff, SequelizeCentralLog } from './index';
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

// Tests run on in-memory SQLite unless DB_DIALECT points them at MySQL or Postgres.
const createSequelize = () => {
	const dialect = (process.env.DB_DIALECT ?? 'sqlite') as Dialect;
	if (dialect === 'sqlite') {
		return new Sequelize({ dialect, storage: ':memory:', logging: false });
	}
	return new Sequelize({
		dialect,
		host: process.env.DB_HOST ?? '127.0.0.1',
		port: Number(process.env.DB_PORT),
		username: process.env.DB_USER,
		password: process.env.DB_PASSWORD,
		database: process.env.DB_NAME,
		logging: false,
	});
};

describe('SequelizeCentralLog', () => {
	let sequelize: Sequelize;
	beforeEach(async () => {
		// DB Setup
		sequelize = createSequelize();
		await sequelize.getQueryInterface().dropAllTables();

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
		sequelize.define('Product', {
			sku: {
				type: DataTypes.STRING,
				unique: true,
			},
			qty: {
				type: DataTypes.INTEGER,
			},
			label: {
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
	afterEach(async () => {
		await sequelize.close();
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
				expect(revisions[1].diff).to.deep.include({
					name: 'dave',
					value: true,
				});
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
			// Rows are saved concurrently, so revisions can be written in any order.
			expect(
				revisions.map((instance) => {
					return instance.diff[0];
				}),
			).to.have.deep.members([
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
					await table.update({ name: 'bobs' }, { transaction: t });
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
			expect(revisions[1].current).to.deep.include({
				meta: { a: 2, tags: ['x'] },
			});
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
	describe('Bulk create with updateOnDuplicate', () => {
		let Revision;
		let Product;
		const setup = async (options = {}, historyOptions = {}) => {
			const CentralLog = new SequelizeCentralLog(sequelize, {
				enableRevisionAttributeMigration: true,
				enableMigration: true,
				...options,
			});
			Revision = await CentralLog.defineModels();
			Product = sequelize.model('Product');
			await CentralLog.addHistory(Product, historyOptions);
			// One at a time so A gets id 1 and B gets id 2.
			await Product.create({ sku: 'A', qty: 1, label: 'first' });
			await Product.create({ sku: 'B', qty: 2, label: 'second' });
		};
		const revisionsAfterSetup = async () =>
			(await Revision.findAll({ order: [['id', 'ASC']] })).slice(2);

		it('should log updates for rows that conflict on the primary key', async () => {
			await setup();
			await Product.bulkCreate(
				[
					{ id: 1, sku: 'A', qty: 5 },
					{ id: 3, sku: 'C', qty: 3 },
				],
				{ updateOnDuplicate: ['qty'] },
			);
			const revisions = await revisionsAfterSetup();
			expect(revisions.map((r) => [r.modelId, r.operation, r.revision])).to.eql(
				[
					[1, 'update', 1],
					[3, 'create', 0],
				],
			);
			expect(revisions[0].diff).to.eql([
				{ key: 'qty', values: { old: 1, new: 5 } },
			]);
			expect((await Product.findByPk(1)).revision).to.equal(1);
			expect((await Product.findByPk(3)).revision).to.equal(0);
		});
		it('should log updates for rows that conflict on a unique key', async () => {
			await setup();
			await Product.bulkCreate(
				[
					{ sku: 'B', qty: 7 },
					{ sku: 'D', qty: 4 },
				],
				{ updateOnDuplicate: ['qty'], conflictAttributes: ['sku'] },
			);
			const revisions = await revisionsAfterSetup();
			const storedD = await Product.findOne({ where: { sku: 'D' } });
			expect(revisions.map((r) => [r.modelId, r.operation, r.revision])).to.eql(
				[
					[2, 'update', 1],
					[storedD.id, 'create', 0],
				],
			);
			expect(revisions[0].diff).to.eql([
				{ key: 'qty', values: { old: 2, new: 7 } },
			]);
		});
		it('should only diff the columns the statement updates', async () => {
			await setup({ trackFullModel: true });
			await Product.bulkCreate(
				[{ id: 1, sku: 'A', qty: 9, label: 'changed' }],
				{
					updateOnDuplicate: ['qty'],
				},
			);
			const [revision] = await revisionsAfterSetup();
			expect(revision.diff).to.eql([
				{ key: 'qty', values: { old: 1, new: 9 } },
			]);
			expect(revision.current).to.eql({ sku: 'A', qty: 9, label: 'first' });
		});
		it('should not log rows that did not change', async () => {
			await setup();
			await Product.bulkCreate([{ id: 1, sku: 'A', qty: 1 }], {
				updateOnDuplicate: ['qty'],
			});
			expect(await revisionsAfterSetup()).to.have.length(0);
			expect((await Product.findByPk(1)).revision).to.equal(0);
		});
		it('should not log with noHistory', async () => {
			await setup();
			await Product.bulkCreate([{ id: 1, sku: 'A', qty: 5 }], {
				updateOnDuplicate: ['qty'],
				noHistory: true,
			});
			expect(await revisionsAfterSetup()).to.have.length(0);
			expect((await Product.findByPk(1)).qty).to.equal(5);
		});
		it('should not log when disableHistoryAutoHook is set on the model', async () => {
			await setup({}, { disableHistoryAutoHook: true });
			await Product.bulkCreate([{ id: 1, sku: 'A', qty: 5 }], {
				updateOnDuplicate: ['qty'],
			});
			expect(await revisionsAfterSetup()).to.have.length(0);
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
	describe('Compact diff format', () => {
		let Revision;
		let Table;
		beforeEach(async () => {
			const CentralLog = new SequelizeCentralLog(sequelize, {
				enableRevisionAttributeMigration: true,
				enableMigration: true,
				diffFormat: 'compact',
			});
			Revision = await CentralLog.defineModels();
			Table = sequelize.model('PrimaryKey');
			await CentralLog.addHistory(Table);
		});
		it('should store creates, updates and destroys compactly', async () => {
			const table = await Table.create({ name: 'dave', value: false });
			await table.update({ name: 'bob', value: true });
			await table.destroy();
			const revisions = await Revision.findAll({ order: [['id', 'ASC']] });
			expect(revisions.map((r) => r.operation)).to.eql([
				'create',
				'update',
				'destroy',
			]);
			expect(revisions[0].diff).to.eql({ name: 'dave', value: false });
			expect(revisions[1].diff).to.eql({
				name: ['dave', 'bob'],
				value: [false, true],
			});
			expect(revisions[2].diff).to.deep.include({ name: 'bob', value: true });
		});
		it('should store upsert updates as old and new pairs', async () => {
			await Table.upsert({ id: 1, name: 'dave' });
			await Table.upsert({ id: 1, name: 'bob' });
			const revisions = await Revision.findAll({ order: [['id', 'ASC']] });
			expect(revisions[1].diff).to.eql({ name: ['dave', 'bob'] });
		});
		it('should be less than half the size of the entries format', async () => {
			const table = await Table.create({ name: 'dave', value: false });
			await table.update({ name: 'bob', value: true });
			const [, update] = await Revision.findAll({ order: [['id', 'ASC']] });
			const entries = readDiff(update).map(({ key, old, new: value }) => ({
				key,
				values: { old, new: value },
			}));
			expect(JSON.stringify(update.diff).length).to.be.lessThan(
				JSON.stringify(entries).length / 2,
			);
		});
	});
	describe('readDiff', () => {
		const changes = [
			{ key: 'name', old: 'dave', new: 'bob' },
			{ key: 'value', old: false, new: true },
		];
		it('should read the entries format', () => {
			const diff = changes.map(({ key, old, new: value }) => ({
				key,
				values: { old, new: value },
			}));
			expect(readDiff({ operation: 'update', diff })).to.eql(changes);
		});
		it('should read the compact format for every operation', () => {
			expect(
				readDiff({
					operation: 'update',
					diff: { name: ['dave', 'bob'], value: [false, true] },
				}),
			).to.eql(changes);
			expect(readDiff({ operation: 'create', diff: { name: 'bob' } })).to.eql([
				{ key: 'name', old: null, new: 'bob' },
			]);
			expect(readDiff({ operation: 'destroy', diff: { name: 'bob' } })).to.eql([
				{ key: 'name', old: 'bob', new: null },
			]);
		});
		it('should parse diffs returned as JSON text', () => {
			expect(
				readDiff({ operation: 'update', diff: '{"name":["dave","bob"]}' }),
			).to.eql([changes[0]]);
		});
	});
	describe('migrateDiffFormat', () => {
		it('should convert entries diffs to compact and keep their meaning', async () => {
			let CentralLog = new SequelizeCentralLog(sequelize, {
				enableRevisionAttributeMigration: true,
				enableMigration: true,
			});
			let Revision: any = await CentralLog.defineModels();
			const Table: any = sequelize.model('PrimaryKey');
			await CentralLog.addHistory(Table);
			const table = await Table.create({ name: 'dave', value: false });
			await table.update({ name: 'bob', value: true });
			await table.update({ name: 'viviana' });
			await table.destroy();
			const before = (await Revision.findAll({ order: [['id', 'ASC']] })).map(
				readDiff,
			);

			CentralLog = new SequelizeCentralLog(sequelize, {
				diffFormat: 'compact',
			});
			Revision = await CentralLog.defineModels();
			expect(await CentralLog.migrateDiffFormat({ batchSize: 2 })).to.equal(3);
			const after = await Revision.findAll({ order: [['id', 'ASC']] });
			expect(after.every((r) => !Array.isArray(r.diff))).to.equal(true);
			expect(after.map(readDiff)).to.eql(before);

			// Running it again finds nothing left to convert.
			expect(await CentralLog.migrateDiffFormat()).to.equal(0);
		});
		it('should keep the revision table read-only', async () => {
			const CentralLog = new SequelizeCentralLog(sequelize, {
				enableMigration: true,
			});
			const Revision: any = await CentralLog.defineModels();
			await CentralLog.migrateDiffFormat();
			let error;
			try {
				await Revision.update({ operation: 'x' }, { where: {} });
			} catch (e) {
				error = e;
			}
			expect(error?.message).to.contain('read-only');
		});
	});
	describe('Revision metadata', () => {
		const storage = new AsyncLocalStorage<{ requestId: string }>();
		let Revision;
		let Table;
		const setup = async (options = {}) => {
			const CentralLog = new SequelizeCentralLog(sequelize, {
				enableRevisionAttributeMigration: true,
				enableMigration: true,
				metadata: {
					reason: DataTypes.STRING,
					requestId: DataTypes.STRING,
				},
				getMetadata: () => storage.getStore(),
				...options,
			});
			Revision = await CentralLog.defineModels();
			Table = sequelize.model('PrimaryKey');
			await CentralLog.addHistory(Table);
		};
		it('should store metadata from getMetadata and the query', async () => {
			await setup();
			await storage.run({ requestId: 'req-1' }, async () => {
				await Table.create({ name: 'a' }, { metadata: { reason: 'import' } });
				await Table.create(
					{ name: 'b' },
					{ metadata: { requestId: 'override', ignored: 'x' } },
				);
			});
			await Table.create({ name: 'c' });
			const revisions = await Revision.findAll({
				order: [['id', 'ASC']],
				raw: true,
			});
			expect(revisions.map((r) => [r.reason, r.requestId])).to.eql([
				['import', 'req-1'],
				[null, 'override'],
				[null, null],
			]);
			expect(revisions[1]).to.not.have.property('ignored');
		});
		it('should store metadata on bulk updates', async () => {
			await setup();
			await Table.bulkCreate([{ name: 'a' }, { name: 'b' }]);
			await Table.update(
				{ value: true },
				{ where: {}, metadata: { reason: 'backfill' } },
			);
			const updates = await Revision.findAll({
				where: { operation: 'update' },
			});
			expect(updates.map((r) => r.reason)).to.eql(['backfill', 'backfill']);
		});
		it('should reject metadata columns that clash with revision columns', async () => {
			let error;
			try {
				await setup({ metadata: { operation: DataTypes.STRING } });
			} catch (e) {
				error = e;
			}
			expect(error?.message).to.contain('"operation"');
		});
		it('should fail the change when required metadata is missing with failHard', async () => {
			await setup({
				metadata: { reason: { type: DataTypes.STRING, allowNull: false } },
				failHard: true,
			});
			let error;
			try {
				await Table.create({ name: 'a' });
			} catch (e) {
				error = e;
			}
			expect(error).to.not.equal(undefined);
			await Table.create({ name: 'b' }, { metadata: { reason: 'ok' } });
			expect(await Revision.count()).to.equal(1);
		});
	});
	describe('User association', () => {
		it('should keep the user id on revisions after the user is deleted', async () => {
			const User: any = sequelize.model('User');
			const CentralLog = new SequelizeCentralLog(sequelize, {
				enableRevisionAttributeMigration: true,
				enableMigration: true,
				userModel: User,
			});
			const Revision: any = await CentralLog.defineModels();
			const Table: any = sequelize.model('PrimaryKey');
			await CentralLog.addHistory(Table);
			const user = await User.create({ name: 'Bob' });
			await Table.create({ name: 'a' }, { userId: user.id });
			await user.destroy();
			const [revision] = await Revision.findAll();
			expect(revision.userId).to.equal(user.id);
		});
		it('should pass userAssociationOptions to the association', async () => {
			const User: any = sequelize.model('User');
			const CentralLog = new SequelizeCentralLog(sequelize, {
				enableRevisionAttributeMigration: true,
				enableMigration: true,
				userModel: User,
				userAssociationOptions: { as: 'author' },
			});
			const Revision: any = await CentralLog.defineModels();
			const Table: any = sequelize.model('PrimaryKey');
			await CentralLog.addHistory(Table);
			const user = await User.create({ name: 'Bob' });
			await Table.create({ name: 'a' }, { userId: user.id });
			const revision = await Revision.findOne({ include: ['author'] });
			expect(revision.author.name).to.equal('Bob');
		});
	});
});
