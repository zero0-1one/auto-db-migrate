# db-auto-migration

开发者经常需要反复调整数据库结构， 如：修改字段名、添加默认值、添加字段、添加索引、修改注释等，而手动维护费时费力。  
`db-auto-migration` 提供了全自动数据库表结构同步。你只需要维护一份 `'CREATE TABLE'` 的`'.sql'`文件，`db-auto-migration`就会自动帮你把数据可同步至`'.sql'`文件所定义的状态。

## 功能

- 数据库迁移
- 表结构自动同步
- SQL 文件自动格式
- 结构一致性签名校验
- 安全可靠
- 目前仅支持 `mysql`

## 使用

```
npm install db-auto-migrate  --save
```

```js
const Migration = require('db-auto-migrate')
const options = require('./options')

async function startServer() {
  let migration = new Migration(options)
  await migration.upgrade()
}
```

## Upgrade 介绍

生产环境下你应该只依赖 `Upgrade` 来同步数据库，它可以处理表结构变化，也可处理数据变化。  
它是单向不可逆的，如果你重命名了一个 `table` 后又想改回来，你只能向后追加新的重命名 `alter` 语句。  
通常这些小改动你可以通过 AutoSync 自动在本地实现，而不用着急的写进 `upgrade` 中，当你测试完成后再复制到 `upgrade` 中。

`Upgrade` 会再数据库中创建一张 `prefix_upgrade` 的表，并会记录所有执行过的 `upgrade，` 如果执行异常将不会向下执行。
你需要手动修复 `upgrade` 后重试。

## AutoSync 介绍

**注意！你不应该在生产环境下使用`AutoSync`功能。**  
为了更好和更安全的使用 `AutoSync` 你应该了解它的进本实现，自动同步算法依赖一个空的数据库,
在计算过程中不会对正式的数据库有任何修改。成功计算出结果后会输出到 [`auto_sync/migration.js`] 文件中。
然后根据 `migration.up` 进行数据库同步。

## AutoSync 与 Upgrade 区别

为什么有如此便捷的`AutoSync` 还要使用`Upgrade`呢？
`AutoSync`应该只作为本地开发便捷工具使用，它只实现了数据库表结构的同步而没有处理任何数据，
自动生成的迁移 `sql` 语句通常大部分都可以直接复制到 `upgrade` 中，但当存在复杂或需要处理数据时将无法满足需求。
此时你需要手动实现 `upgrade。`

## 配置

```js
let options = {
  /**
   * 指定的 dir 需要是下面约定的目录结构
   * migration
   *   ├── upgrade             编写迁移文件
   *   │   ├──── v1.0.0.js     按版本编写升级逻辑, 通常只能追加而不能修改历史逻辑
   *   │   └──── v2.1.0.js     升级会按版本顺序执行
   *   │
   *   ├── sql                 存放所有 create table .sql文件的目录
   *   │   ├──── account.sql   你的一些 sql 文件
   *   │   └──── log.sql
   *   └── auto_sync           开启 autoSync 会自动生成此目录及目录内的文件, 通常不应该将它加入版本控制
   *       ├──── migration.js  自动生成的迁移文件,
   *       └──── .gitignore
   */
  dir: __dirname,
  //正式的数据库配置选项
  db: {
    'host': 'localhost',
    'user': 'root',
    'password': '123',
    'database': 'dbName'
  },
  //文件名前缀，非该 prefix 前缀的文件会被忽略
  prefix: '',
  showLog: true,

  /***** 以下是开启 autoSync 需要配置的选项 *****/

  //自动同步数据库结构模式, 'auto', 'manual', 'off'   默认是 manual'模式
  //auto: 开启 根据指定目录的 create table sql 自动同步数据库
  //manual: 仅生成迁移文件, 但是不执行, 需要手动在迁移文件内 将 execute: false  改为 true
  //off: 关闭自动同步, 非 'auto','manual' 都会被认为是 'off'
  autoSync: 'manual',
  //是否在 upgrade 后自动格式化所有 create table sql, 如果为 false 也可以单独调用 migration.format()
  autoFormat: true,
  //格式化规则, 默认内置的 'normal', 也可以使用数组配置多个规则组合, 更多规则查看 lib/sqlFormat.js
  formatRules: 'simple',
  // true: 需要配置 tempDb, 格式化会先把 sql 导入tempDb 通过 show create table 获取 sql 后格式化
  // false: 仅仅通过文件夹内的文件格式化
  formatByDb: true,

  //最大试错次数
  autoSyncMaxTry: 10,
  //数据库同步中, 临时数据库会反复清空重建多次, 为了防止配置失误 database 必须以 '__temp_sync__' 开头
  tempDb: {
    'host': 'localhost',
    'user': 'root',
    'password': '123',
    'database': '__temp_sync__'
  }
}
```

## upgrade 文件编写

文件名必须为 version 命名规范如 `'1.0'`, `'v2.1.1'` 等 会按版本从小大大执行.

```js
// v1.0.js
'use strict'
//返回 upgrade 数组,按顺序执行, 只允许向后追加, 即使是取消上一步, 也应该是在最后追加一个 upgrade
//本地开发过程中频繁变化, 请使用 autoSync 功能, 等测试完成后, 将 autoSync 的内容追加到 upgrade 中
//所有 upgrade 执行都会在 `prefix_upgrade` 表中记录日志,
//如果异常就会终止, 后续不再执行, 下次执行(重启服务器) 会从上次异常处重新尝试.
module.exports = [
  //最简单的是使用一个 SQL 字符串,
  'CREATE TABLE a (id int PRIMARY KEY, val int)',

  //可以指定多条 SQL 语句, 使用 ';' 隔开. 他们拥有 [2], [2-1], [2-2], ...的默认序号
  `
  CREATE TABLE d (id int, val int);
  CREATE TABLE e (
    id int ,
    val int
  );
  `,

  //可以是 SQL 字符串数组,每个元素必须是但语句. 他们拥有 [3], [3-1], [3-2], ... 的默认序号
  [
    'CREATE TABLE b (id int, val int)',
    `CREATE TABLE c (
      id int, 
      val int
    )`
  ],

  //可以使用一个异步函数
  async db => {
    // 函数内所有内容会自动在同一个事务中执行,(只有函数类型会自动开启事务)
    // 具有隐性 commit 的命令. 如 ALTER 语句, 应该放在外部独立字符串中
    await db.query('INSERT INTO a(id, val) values(1, 10)')
    await db.query('INSERT INTO a(id, val) values(2, 20)')
    // throw new Error('')   //如果抛异常 就会回滚上面两条语句
  },

  //可对象配置跟多详细内容
  {
    //与外部相同, 支持单语句,多语句字符串,数组或异步函数
    up: 'ALTER TABLE a RENAME TO aaa',
    //指定校验签名,  执行完本条 upgrade 会进行校验, 如果失败将终止执行
    sign: 'sha1|791ae95b6b8c2e0a95865098bc9f0e85bea5030a',
    //添加注释, 会记录进 `prefix_upgrade` 表中
    comment: 'RENAME TABLE a TO aaa'
  }
]
```

## sql 文件格式化

对`create table`的`sql`文件进行格式, 更多内置规则查看[sqlFormat.js](https://github.com/zero0-1one/db-auto-migrate/blob/master/lib/sqlFormat.js),你可以按下面方式配置自己的格式规则:

```js
//options.js
{
  //...
  //为方便内置了 simple 和 normal 规则集合, 他们和普通规则一样可自由组合
  formatRules: ['simple'],
  //如果只有一个规则,也可以使用 字符串
  formatRules: 'simple',

  //多规则组合
  formatRules: ['simple', 'noBackQuote'],
  //或添加自定义规则, 与上一句效果相同
  formatRules: [
    'simple',
    [/^`(.+)`$/gi, '$1', 'in']  // in:代表在(' " `) 3种引号提取的字符串中替换, out:正好相反是,这些字符串的外部内容
  ],
  //也可以配置函数
  formatRules: ['simple', (sql)=>{
    //注意!! 这里只是简单实现,它存在一定的bug, 比如在注释中有 `` 的情况下会误替换
    return sql.replace(/`(.+)`/gi, '$1')
  }
}
```

## TODO

- 支持 `CREATE VIEW`

## 后记

开启你飞一般的编程体验吧！！
