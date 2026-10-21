# sequelize-central-log

[![npm](https://img.shields.io/npm/v/sequelize-central-log.svg)](https://www.npmjs.com/package/sequelize-central-log)
[![CI](https://github.com/blankstar85/sequelize-central-log/actions/workflows/node.js.yml/badge.svg)](https://github.com/blankstar85/sequelize-central-log/actions/workflows/node.js.yml)
[![license](https://img.shields.io/github/license/blankstar85/sequelize-central-log.svg)](LICENSE)

Keeps the change history of your Sequelize models in one shared revision table. Every create, update, upsert and destroy writes a row with what changed, who changed it, and a revision number.

```typescript
const post = await Post.create({ title: 'Draft', published: false });
await post.update({ title: 'Launch notes', published: true }, { userId: 42 });
```

The update above writes this row to the `Revision` table:

```json
{
  "id": 2,
  "model": "Post",
  "modelId": 1,
  "operation": "update",
  "revision": 1,
  "userId": 42,
  "diff": [
    { "key": "title", "values": { "old": "Draft", "new": "Launch notes" } },
    { "key": "published", "values": { "old": false, "new": true } }
  ],
  "createdAt": "2026-10-21T14:02:11.000Z"
}
```

Written in TypeScript and ships its own types. Works with models defined through `sequelize.define`, `Model.init` classes and sequelize-typescript.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [What gets recorded](#what-gets-recorded)
- [Choosing which columns to track](#choosing-which-columns-to-track)
- [Recording who made the change](#recording-who-made-the-change)
- [Composite primary keys](#composite-primary-keys)
- [Bulk operations and upsert](#bulk-operations-and-upsert)
- [Transactions and errors](#transactions-and-errors)
- [Skipping history](#skipping-history)
- [Limitations](#limitations)
- [Options](#options)
- [Upgrading from 1.x](#upgrading-from-1x)

## Install

```sh
npm install sequelize-central-log
```

The major version follows Sequelize: 6.x of this package is for Sequelize v6 (6.37 or later). Fixes go out as patch releases. It needs Node.js 22 or later.

## Quick start

Create the central log with your Sequelize connection, define the revision model, then add history to each model you want to track. Define your own models first.

```typescript
import { Sequelize } from 'sequelize';
import { SequelizeCentralLog } from 'sequelize-central-log';

const sequelize = new Sequelize('database', 'username', 'password');
// ... define your models

const centralLog = new SequelizeCentralLog(sequelize, {
  enableMigration: true, // create the Revision table if it doesn't exist
  enableRevisionAttributeMigration: true, // add the revision column to tracked tables
});
const Revision = await centralLog.defineModels();

await centralLog.addHistory(sequelize.model('Post'));
await centralLog.addHistory(Comment); // a Model.init class works too
```

`addHistory` adds a `hasMany` association from the model to the revision model, so you can load a record's history with it:

```typescript
const post = await Post.findByPk(1, { include: [Revision] });
post.Revisions; // every revision for this post

await post.getRevisions();
```

If you manage your schema with migrations, leave both `enable*Migration` options off and create the `Revision` table and the `revision` columns yourself.

## What gets recorded

Each revision row has these columns:

| Column      | Contents                                                                                     |
|-------------|----------------------------------------------------------------------------------------------|
| `model`     | The model name.                                                                              |
| `modelId`   | The record's primary key. `modelId2` and `modelId3` hold the extra keys of a composite key.  |
| `operation` | `create`, `update`, `destroy`, or `upsert`.                                                  |
| `revision`  | The record's revision number. It starts at 0 on create and goes up by one with each change.  |
| `diff`      | For create and update, a list of `{ key, values: { old, new } }`. For destroy, the removed values as an object. |
| `userId`    | Who made the change. Only present when `userModel` is set.                                    |
| `current`   | The full tracked state of the record after the change. Only present when `trackFullModel` is set. |
| `createdAt` | When the revision was written.                                                               |

Each tracked model also gets a `revision` column holding its current revision number. Callers can't set it; the hooks overwrite any value passed in.

An update that changes no tracked columns doesn't write a revision or bump the number.

The revision model is read-only. Updating, destroying or upserting revisions throws an error, including bulk calls such as `Revision.destroy({ where: {} })` and `Revision.truncate()`.

## Choosing which columns to track

By default every column is tracked except primary keys and the columns in the global `exclude` list: `id`, `createdAt`, `updatedAt`, `deletedAt`, `created_at`, `updated_at`, `deleted_at` and `revision`.

Passing `exclude` replaces that default list, so include the timestamps again if you still want them left out:

```typescript
const centralLog = new SequelizeCentralLog(sequelize, {
  exclude: ['createdAt', 'updatedAt', 'passwordHash'],
});
```

To exclude columns on one model only, pass `exclude` to `addHistory`. It is added to the global list for that model:

```typescript
await centralLog.addHistory(User, { exclude: ['lastLoginAt'] });
await centralLog.addHistory(Post); // only the global list applies
```

Virtual attributes and included associations are never recorded. JSON and array columns are recorded with their full values.

## Recording who made the change

Set `userModel` to add a nullable `userId` foreign key to the revision table. Its type matches the user model's primary key, so integer, UUID and string ids all work.

```typescript
const centralLog = new SequelizeCentralLog(sequelize, { userModel: User });
```

The user id is resolved in this order:

1. A `userId` option passed to the query.
2. The `getUserId` function, if you set one.
3. The cls-hooked namespace set in `continuationNamespace`.

If none of them returns a value, `userId` is `null`.

### AsyncLocalStorage

`getUserId` can read from `AsyncLocalStorage` or any request context your app already has. This is the recommended setup.

```typescript
import { AsyncLocalStorage } from 'node:async_hooks';

const requestContext = new AsyncLocalStorage<{ userId: number }>();

const centralLog = new SequelizeCentralLog(sequelize, {
  userModel: User,
  getUserId: () => requestContext.getStore()?.userId,
});

// Express middleware: every query in the request is attributed to the user
app.use((req, res, next) => requestContext.run({ userId: req.user.id }, next));
```

### Per query

```typescript
await post.update({ title: 'Edited' }, { userId: admin.id });
```

To record a change with no user even when one is in context, for example a public form submission, pass `skipLoggingUser`:

```typescript
await Feedback.create(values, { skipLoggingUser: true });
```

### cls-hooked

cls-hooked still works, but it's an optional peer dependency, so install it yourself:

```sh
npm install cls-hooked
```

```typescript
import { getNamespace } from 'cls-hooked';

const centralLog = new SequelizeCentralLog(sequelize, {
  userModel: User,
  continuationNamespace: 'app',
  continuationKey: 'userId', // the default
});

const namespace = getNamespace('app');
await namespace.runPromise(async () => {
  namespace.set('userId', user.id);
  await post.update({ title: 'Edited' });
});
```

## Composite primary keys

Models with up to three primary key columns are supported. Turn on `useCompositeKeys` to add the `modelId2` and `modelId3` columns to the revision table, then mark each composite model:

```typescript
const centralLog = new SequelizeCentralLog(sequelize, { useCompositeKeys: true });

await centralLog.addHistory(Membership, { hasCompositeKey: true });
await centralLog.addHistory(Assignment, { hasCompositeKey: true, thirdCompositeKey: true });
```

The keys are stored in the order they appear in the model's `primaryKeyAttributes`. `addHistory` throws if the model has fewer keys than you declared, or if `useCompositeKeys` is off.

## Bulk operations and upsert

Sequelize only runs per-row hooks for bulk calls when `individualHooks` is set, so the central log turns it on for `bulkCreate`, `Model.update` and `Model.destroy` on tracked models. Each affected row gets its own revision. That means a bulk update first loads every matching row.

To keep bulk calls fast on a model and skip their history, pass `disableHistoryAutoHook`:

```typescript
await centralLog.addHistory(PageView, { disableHistoryAutoHook: true });
```

`bulkCreate` with `updateOnDuplicate` stays a single statement. Before it runs, existing rows are looked up by `conflictAttributes` if you pass it, otherwise by the primary key and unique keys. New rows are logged as `create`. Existing rows whose updated columns changed are logged as `update` with the old values, and their revision number goes up.

`Model.upsert` is tracked too. When the values include the primary key, the existing row is looked up first and the revision is logged as `create` or `update` with the real old values. An upsert that matches on a different unique key is logged as `upsert` with only the new values, because the previous state isn't known.

## Transactions and errors

Revisions are written in the same transaction as the change, so a rolled back change leaves no revision behind. Pass `transaction` on the query as usual, or use `Sequelize.useCLS` to have it picked up automatically.

If writing a revision fails, the error is passed to `log` and the change still succeeds. Set `failHard: true` to rethrow the error instead. Inside a transaction, that rolls back the change too.

## Skipping history

Pass `noHistory: true` to any query to skip its revision:

```typescript
await post.update({ viewCount: 10 }, { noHistory: true });
```

## Limitations

The central log works through model hooks, so it can't see changes that bypass them:

- raw queries and `queryInterface` calls, including migrations and seeders
- `increment()` and `decrement()`, which Sequelize runs without hooks
- `Model.update` and `Model.destroy` with `hooks: false`

For a log that also covers those, use database triggers or change data capture.

## Options

| Option                             | Type          | Default                  | Description                                                                                       |
|------------------------------------|---------------|--------------------------|---------------------------------------------------------------------------------------------------|
| `attributeModelId`                 | string        | `'modelId'`              | Revision column for the tracked record's primary key.                                             |
| `attributeModelId2`                | string        | `'modelId2'`             | Revision column for the second key of a composite key.                                            |
| `attributeModelId3`                | string        | `'modelId3'`             | Revision column for the third key of a composite key.                                             |
| `attributeRevision`                | string        | `'revision'`             | Name of the revision column, on both the tracked models and the revision table.                   |
| `attributeRevisionModel`           | string        | `'Revision'`             | Sequelize model name of the revision table.                                                       |
| `attributeRevisionModelTableName`  | string        | `'Revision'`             | Database table name of the revision table.                                                        |
| `attributeUserId`                  | string        | `'userId'`               | Revision column for the user id.                                                                  |
| `continuationKey`                  | string        | `'userId'`               | Key that holds the user id in the cls-hooked namespace.                                           |
| `continuationNamespace`            | string        | `null`                   | cls-hooked namespace to read the user id from.                                                    |
| `debug`                            | boolean       | `false`                  | Log what the hooks are doing.                                                                     |
| `enableMigration`                  | boolean       | `false`                  | Create the revision table with `sync()` when `defineModels()` runs.                               |
| `enableRevisionAttributeMigration` | boolean       | `false`                  | Add the revision column to each tracked table when `addHistory()` runs.                           |
| `exclude`                          | string[]      | see [above](#choosing-which-columns-to-track) | Columns never recorded, on any model. Replaces the default list.             |
| `failHard`                         | boolean       | `false`                  | Rethrow errors from writing a revision instead of logging them.                                   |
| `freezeTableName`                  | boolean       | `false`                  | `freezeTableName` for the revision model.                                                         |
| `getUserId`                        | function      | `null`                   | Returns the current user id. Checked before `continuationNamespace`.                              |
| `log`                              | function      | `console.log`            | Receives debug output and revision write errors.                                                  |
| `primaryKeyType`                   | DataType      | `DataTypes.INTEGER`      | Column type of `modelId`, `modelId2` and `modelId3`. Use `DataTypes.STRING` to mix key types.      |
| `trackFullModel`                   | boolean       | `false`                  | Add a `current` column with the full tracked state after each change.                             |
| `underscored`                      | boolean       | `false`                  | `underscored` for the revision model (`created_at` instead of `createdAt`).                       |
| `useCompositeKeys`                 | boolean       | `false`                  | Add the `modelId2` and `modelId3` columns for composite keys.                                     |
| `userModel`                        | Model         | `null`                   | User model to link revisions to. Adds the `userId` column.                                        |

Options for `addHistory(model, options)`:

| Option                   | Type     | Description                                                       |
|--------------------------|----------|-------------------------------------------------------------------|
| `exclude`                | string[] | Columns to leave out for this model, added to the global list.    |
| `hasCompositeKey`        | boolean  | The model has two primary key columns.                            |
| `thirdCompositeKey`      | boolean  | The model has three primary key columns.                          |
| `disableHistoryAutoHook` | boolean  | Don't turn on `individualHooks` for bulk calls on this model.     |

Options you can pass to any query:

| Option            | Type             | Description                                       |
|-------------------|------------------|---------------------------------------------------|
| `noHistory`       | boolean          | Don't write a revision.                           |
| `userId`          | number or string | User to record, overriding `getUserId` and cls.   |
| `skipLoggingUser` | boolean          | Record the revision with no user.                 |

## Upgrading from 1.x

Version 6.0 follows 1.7.4. The jump matches the Sequelize major version and isn't a sign of five releases' worth of changes.

Requirements:

- Node.js 22 or later and Sequelize 6.37 or later.
- cls-hooked is now an optional peer dependency. If you use `continuationNamespace`, add it to your own dependencies.

Fixes that change what gets stored:

- Old values of `0`, `false` and `''` are recorded as they are. 1.x recorded them as `null`. Existing revision rows keep their `null` values.
- JSON and array columns are recorded. 1.x left their new value out.
- Primary keys are never part of the diff.
- Upserts are recorded.
- `attributeRevision` is used everywhere. 1.x always named the column on tracked models `revision`.

Behavior changes:

- The association from `addHistory` returns revisions. In 1.x, `include: [Revision]` and `getRevisions()` came back empty.
- Revisions are written in the caller's transaction.
- `failHard: true` rethrows revision errors. In 1.x the option did nothing.
- Bulk updates, bulk destroys and truncates on the revision model throw. If your test suite clears the table with `truncate()`, use `sync({ force: true })` or `queryInterface.bulkDelete('Revision', {})` instead.
- `addHistory` with `hasCompositeKey` throws unless `useCompositeKeys` is on.
- The `userId` column type follows the user model's primary key. Existing tables aren't altered.

## Support

Report bugs and ask questions on the [issue tracker](https://github.com/blankstar85/sequelize-central-log/issues).

## License

MIT © Jacob Copeland. See [LICENSE](LICENSE).

Inspired by [sequelize-paper-trail](https://github.com/nielsgl/sequelize-paper-trail).
