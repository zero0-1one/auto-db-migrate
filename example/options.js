'use strict'

module.exports = {
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
   *   └── .auto_sync          开启 autoSync 会自动生成此目录及目录内的文件,通常不应该将它加入版本控制
   *       ├──── migration.js  自动生成的迁移文件,
   *       ├──── .cache        为了提高效率缓存当前状态, 可以删除但不要修改内容
   *       └──── .gitignore
   */
  dir: __dirname,
  //正式的数据库配置选项
  db: {
    'host': 'localhost',
    'user': 'root',
    'password': '1',
    'database': 'auto_db_migrate',
  },
  //文件名前缀，非该 prefix 前缀的文件会被忽略
  prefix: '',
  //需要过滤的 table, 数组可以是字符串, 或 正则表达式. 默认为空(内置自动过滤 auto_db_migrate__* 系列表)
  tableFilter: [],
  //设置为 非 'development' 将只会有 Upgrade 功能生效.  默认： 'development'
  env: 'development',

  //自动同步数据库结构模式, 'auto', 'manual', 'off'   默认是 manual'模式
  //'auto': 开启 根据指定目录的 create table sql 自动同步数据库
  //'manual': 仅生成迁移文件, 但是不执行, 需要手动在迁移文件内 将 confirm : false  改为 true
  //'off': 关闭自动同步, 非 'auto','manual' 都会被认为是 'off'
  autoSync: 'auto',
  //autoSync 为 'auto' 时最大允许的风险值. 如果超过 maxRisk 则 autoSync 会自动转化为 'manual' 模式.
  //默认为 5, 相当于同步要删除 5 表 或 删除 20 个字段
  maxRisk: 5,
  //是否在 upgrade 后自动格式化所有 create table sql, 如果为 false 也可以单独调用 migration.format()
  autoFormat: true,
  //格式化规则, 默认内置的 'normal', 也可以使用数组配置多个规则组合, 更多规则查看 lib/sqlFormat.js
  formatRules: 'simple',
  // true: 需要配置 tempDb, 格式化会先把 sql 导入tempDb 通过 show create table 获取 sql 后格式化
  // false: 仅仅通过文件夹内的文件格式化
  formatByDb: true,
  //是否进行字段 notNull 检测，没有指定 notNull 的字段会输出一个警告，
  //可通过添加 COMMENT 以'Can be null' 或 'CBN' 开头来忽略这个警告,
  checkNotNull: true,

  //最大试错次数
  autoSyncMaxTry: 10,
  //数据库同步中, 临时数据库会反复清空重建多次, 为了防止配置失误 database 必须以 '__temp_sync__' 开头
  tempDb: {
    'host': 'localhost',
    'user': 'root',
    'password': '1',
    'database': '__temp_sync__temp_db',
  },
  //logs对象(拥有 log, warn, error 方法), 默认为: console,  设置 false 将不输出日志
  logs: false,
  //是否输出 gitignore文件， 默认 true
  gitignore: false,
}