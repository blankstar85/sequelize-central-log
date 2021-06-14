# [**Sequelize Central Log**](https://github.com/forwardemail/email-templates)

[![styled with prettier](https://img.shields.io/badge/styled_with-prettier-ff69b4.svg)](https://github.com/prettier/prettier)
[![license](https://img.shields.io/github/license/forwardemail/email-templates.svg)](LICENSE)

Maintain Sequelize Model change history in a central table. This is highly configurable and supports
composite primary keys ( up to 2 for now). Written in Typescript and provides typing. 

Can be used with Sequelize-typescript as well.

## Table of Contents
* [Install](#install)
* [Usage](#usage)
  * [Setup](#setup)
  * [Exclude Columns](#excluding-columns)
  * [Composite Keys](#composite-keys)
  * [Tracking Author](#tracking-author)
* [Options](#options)
* [Support](#support)
* [Author](#author)
* [Thanks](#thanks)

## Install

To install run the following npm command: 

```sh
npm install sequelize-central-log
```


## Usage

### Setup

Sequelize Central log needs your initated sequelize connection for example:

```typescript
import { Sequelize } from 'sequelize';

const sequelize = new Sequelize('database', 'username', 'password');
```

Import Sequelize Central Log, create a new instance by passing in your sequelize instance and options ( see below ) as
well as defineModels() to setup the revision model, which should be done after initalizing them in sequelize.

```typescript
import { SequelizeCentralLog } from 'sequelize-central-log';
const options = {...}; // define options from list below
const centralLog = new SequelizeCentralLog(sequelize, options);
const Revision = centralLog.defineModels(); // returns your revision model instance for querying
```
This sets up your central log (revision table) and returns the table instance to be used for querying.

Lastly for each model you want to track history on call the addHistory function passing in the model.
```typescript
centralLog.addHistory(sequelize.model('ModelName'));

// For those that define their models as a class, you can simply pass that class in.
import SequelizeModelClass from '../sequelize_model_class';
centralLog.addHistory(SequelizeModelClass);
```
The hasHistory function will add a hasMany association from the model to the revision model so you can include and have 
revisions returned with your results.


### Excluding Columns
There are two ways to exclude columns from being tracked in the revision history table. 

You can pass them in as a string array your options when instantiating the Sequelize Central Log ( this will override the defaults).
See options below for the defaults. You can override the defaults by passing an empty array.
```typescript
const centralLog = new SequelizeCentralLog(sequelizeDB, { exclude: ['column1', 'column2']});

```
or you can pass them in per model as a string array when adding the history to the sequelize model:
```typescript
centralLog.addHistory(ModelA, {exclude: ['columnModelA']});
centralLog.addHistory(ModelB);
```
General exclude and model level exclude are added together on the model level. So a globally excluded id column will apply to every 
model while a column excluded when adding history to the model will be excluded only for that table.

  Example based on the setup above:
  1. Table A will have the columns id and columnModelA excluded.
  2. Table B will only have the id column excluded.

### Composite Keys
You can use composite keys while tracking history. Current limitations are limited to 2 keys currently. 
The second key is tracked in a column added to the revision table modelId2, (which you can override the column name).

This is configured by passing the option when creating the log and then per model.
```typescript
const centralLog = new SequelizeCentralLog(sequelizeDB, {useCompositeKeys: true});
centralLog.addHistory(Model, { hasCompositeKey: true });
```

This will still create the hasMany association on the model and will pull back the revisions. YAY!

### Tracking Author

You can track the author of the revision by passing the user model as an option when creating the SequelizeCentralLog
instance( model must be initialized in sequelize first).

```typescript
const centralLog = SequelizeCentralLog(sequelizeDB, {userModel: User});
```

This will create a foreign key ( allowed null ) column on the revision table pointing to the id column in the user model.

There are two ways to set the userid when tracking the author. You can use a namespace (cls-hooked) or pass a userId as an option on the
sequelize query. The option passed on the query will override the namespace if you want to for some reason.

```typescript
import { createNamespace } from 'cls-hooked';

const nameSpace = createNamespace('amespaceName');

// don't forget to call run on the namespace.
nameSpace.run(() => {
  nameSpace.set('keyName', userID);
  // somehwere in your async chain..
  Model.update(...{});
  Model.create(...{});
});

/**
 * OR
 */

Model.update({...values}, {userId: userID});

```


## Options
| Option                                | Type          | Default Value                                                                                                         | Description                                                                                                                                                                                                            |
| ---------------------------           | ------------- | --------------------------------------------------------------------------------------------------------------------  | -----------------------------------------------------------------------------------------------------------------------|
| [attributeModelId                     | String        | modelID                                                                                                               | column name for primary key of model tracked.                                                                          |
| [attributeModelId2                    | String        | modelID2                                                                                                              | column name for the 2nd primary key for a composite key.                                                               |
| [attributeRevision]                   | String        | revision                                                                                                              | column name added to model being tracked with hasHistory()                                                             |
| [attributeRevisionModel]              | String        | Revision                                                                                                              | revision table sequelize model name                                                                                    |
| [attributeRevisionModelTableName]     | String        | Revision                                                                                                              | revision table name in database, if different.                                                                         |
| [attributeUserId]                     | String        | userId                                                                                                                | column name on revision table for the user id.                                                                         |
| [continuationKey]                     | String        | userId                                                                                                                | continuation key to set / get when tracking author.                                                                    |
| [continuationNamespace]               | String        | NULL                                                                                                                  | continuation namespace name.                                                                                           |
| [debug]                               | Boolean       | false                                                                                                                 | Enables console logging.                                                                                               |
| [enableMigration]                     | Boolean       | false                                                                                                                 | Enables Database sync of only the revision model so the table will be created in database.                             |
| [enableRevisionAttributeMigration]    | Boolean       | false                                                                                                                 | Enables addHistory to add the revision column on the model in the database.                                            |
| [exclude]                             | Array(string) | ['id', 'createdAt', 'updatedAt', 'deletedAt', 'created_at', 'updated_at', 'deleted_at', [options.revisionAttribute]]  | Array of global attributes to exclude from the revision log.                                                           |
| [freezeTableName]                     | Boolean       | false                                                                                                                 | Adds revision model level option of freeze table name.                                                                 |
| [trackFullModel]                      | Boolean       | false                                                                                                                 | Adds another column (current) to the table and tracks the full non excluded current values ( not just what changed ).  |
| [useCompositeKeys]                    | Boolean       | false                                                                                                                 | Denotes that composite keys are used in your models and adds the attributeModelId2 column to the revision table.       |
| [underscored]                         | Boolean       | false                                                                                                                 | Adds revision model level option of underscored column names ( created_at ).                                           |
| [userModel]                           | Model Object  | NULL                                                                                                                  | Sequelize Model instance for the user.                                                                                 |


## Support
Please use GitHub's [Issue Tracker](https://github.com/blankstar85/sequelize-central-log/issues)

## Author

© Jacob Copeland

Distributed under the MIT license. See [LICENSE](https://github.com/blankstar85/sequelize-central-log/blob/master/LICENSE) for more information.


## Thanks
This project was inspired by:
* [Sequelize Paper Trail](https://github.com/nielsgl/sequelize-paper-trail)
