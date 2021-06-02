import 'mocha';
// Simport { expect } from 'chai';
import { DataTypes, Sequelize } from 'sequelize';
// import SequelizeCentralLog from './index';

describe('SequelizeCentralLog', () => {
	let sequelize: Sequelize;
	beforeEach(async () => {
		// DB Setup
		sequelize = new Sequelize('sqlite::memory:', { logging: false });
		sequelize.define('user', { name: { type: DataTypes.STRING } });
		sequelize.define('primary_key', {
			id_something: {
				primaryKey: true,
				type: DataTypes.INTEGER,
				allowNull: false,
			},
		});
		sequelize.define('two_key', {
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
		await sequelize.sync();
	});

	describe('Changes to Models', () => {
		it('on update it should log a revision', () => {});
		it('on create/delete should log the current values', () => {
			//
		});
	});
	describe('Should not log Revision', () => {
		it('should not log failed transactions', () => {});
		it('should not log when noHistory added as option', () => {
			//
		});
	});
	describe('Should work with author', () => {
		it('use namespace to record author id', () => {
			//
		});
		it('use userId from model options, should override namespace', () => {
			//
		});
		it('should log null when author cannot be identified', () => {
			//
		});
	});
	describe('Ignore Attributes', () => {
		it('should ignore excluded attributes from options', () => {
			//
		});
		it('should ignore model level excluded attributes', () => {
			//
		});
		it('should ignore model primary key when not id', () => {
			//
		});
	});
	describe('Relate revision model to models', () => {
		it('should add hasMany revisions to tracked model', () => {
			//
		});
	});
});
