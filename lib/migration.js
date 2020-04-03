'use strict'
const autoSync = require('./autoSync')
const sqlFormat = require('./sqlFormat')
const sqlParser = require('./sqlParser')
const fs = require('fs')
const path = require('path')
const Db = require('./db')
const util = require('./util')
const compareVersions = require('compare-versions')
const requireAll = require('require-all')

//不提供 down 功能, 您应该追加新的 upgrade 来实现回退.\n在开发环境你可以非常方便的使用 autoSync 功能
module.exports = class Migration {
  constructor(options) {
    this.checkOptions(options)
    this.options = Object.assign({
      prefix: '',
      showLog: true,
      autoSync: 'off',
      onlyOutFile: false,
      autoFormat: true,
      autoSyncMaxTry: 10,
      formatRules: 'normal',
      checkNotNull: true,
      gitignore: true,
      sqlDir: 'sql',
      upgradeDir: 'upgrade',
      autoSyncDir: 'auto_sync',
    }, options)
  }

  checkOptions(options) {
    //todo:
    return true
  }


  tableName(type = '') {
    let prefix = this.options.prefix || ''
    if (prefix && !prefix.endsWith('_')) prefix = prefix + '_'
    let tableName = prefix + '_db_auto_migrate__upgrade'
    return type ? tableName + '_' + type : tableName
  }

  mkdirs(dirPath) {
    if (fs.existsSync(dirPath)) {
      return
    }
    this.mkdirs(path.dirname(dirPath))
    fs.mkdirSync(dirPath)
  }

  workDir(name) {
    let dir = path.join(this.options.dir, name)
    this.mkdirs(dir)
    return dir
  }

  upgradeDir() {
    return this.workDir(this.options.upgradeDir)
  }

  sqlDir() {
    return this.workDir(this.options.sqlDir)
  }

  outDir() {
    let dir = this.workDir(this.options.autoSyncDir)
    if (this.options.gitignore) fs.writeFileSync(path.join(dir, '.gitignore'), '/*', 'utf8')
    return dir
  }


  log(...args) {
    if (!this.options.showLog) return
    console.log(...args)
  }

  async upgrade() {
    let db = new Db(this.options.db)
    this.log(`[${db.database}] 数据库升级中...`)
    try {
      let upgradeData = this.loadUpgradeData()
      let count = 0
      await this.createUpgradeTable(db)
      await Db.transaction(this.options.db, async (dbLock) => {
        let tableName = this.tableName()
        //加锁 防止多进程部署时候同时执行
        await dbLock.query(`REPLACE INTO ${this.tableName('lock')}(id) VALUES(?)`, [1])

        let { logs, lastLog } = await this.getUpgradeLogs(db, tableName)
        for (const { version, seqName, up, comment, sign } of upgradeData) {
          if (logs[version] && logs[version][seqName].status == 1) continue//已经执行
          if (lastLog && this.compareSequence({ version, seqName }, lastLog) < 0) {
            throw new Error(`!! 之前已经更新到 ${lastLog.version}(${lastLog.seqName}), `
              + `但 ${version}(${seqName}) 未执行过, 不应该在历史版本中添加新的 upgrade`
            )
          }
          await this.doUpgrade(db, tableName, version, seqName, up, comment, sign)
          count++
        }
        return count
      })

      this.log(`[${db.database}] 数据库升级成功 共执行了 ${count} 个 upgrade`)

      let { autoSync, autoFormat, checkNotNull } = this.options
      if (autoSync == 'auto' || autoSync == 'manual') await this.autoSync()
      if (autoFormat) await this.format()
      if (checkNotNull) await this.checkNotNull()
    } finally {
      await db.close()
    }
  }

  async autoSync() {
    let dir = this.sqlDir()
    let db = new Db(this.options.db)
    let tempDb = new Db(this.options.tempDb)
    try {
      this.log(`[${db.database}] 正在计算迁移算法...`)
      autoSync.setTableFilter([this.tableName(), this.tableName('lock')])
      await autoSync.clearTempDataBase(tempDb)
      await autoSync.initTempDbByDir(tempDb, dir, this.options.prefix)
      let { migration, succeed, diffData } = await autoSync.createMigration(db, tempDb, this.options.autoSyncMaxTry)
      let filePath = this.writeMigrationFile(migration, succeed, diffData)
      if (!succeed) {
        this.log(`[${db.database}] 迁移算法计算失败!!! 结果已经记录到 ${filePath}\n你可以手动修复后再试`)
        throw new Error('迁移算法,未能使数据库结构最终状态一致. 可以调大 `autoSyncMaxTry` 参数再尝试,\n' + JSON.stringify(diffData, null, 2))
      }
      this.log(`[${db.database}] 迁移算法计算成功, 已经写入到 ${filePath}`)
      if (this.options.autoSync == 'auto') {
        this.log(`[${db.database}] 开始自动同步...`)
        let sign = await autoSync.sync(db, migration, 'up')
        this.log(`[${db.database}] 开始自动同步完成, 当前数据库结构签名: ${sign}`)
      }
    } finally {
      db.close()
      tempDb.close()
    }
  }

  async format() {
    if (this.options.formatByDb) {
      await this._formatByDb()
    } else {
      this._formatByDir()
    }
    this.log(`sql文件格式化完成`)
  }

  _formatByDir() {
    let { prefix, formatRules } = this.options
    let dir = this.sqlDir()
    let group = autoSync.getTableGroup(dir, prefix)
    for (const name in group) {
      let content = group[name].map(t => t.sql).join(';\n')
      content = sqlFormat.format(content, formatRules)
      fs.writeFileSync(path.join(dir, name + '.sql'), content, 'utf8')
    }
  }

  async _formatByDb() {
    let { prefix, formatRules } = this.options
    let dir = this.sqlDir()
    await Db.transaction(this.options.tempDb, async tempDb => {
      let group = await autoSync.initTempDbByDir(tempDb, dir, prefix)
      let createTables = await autoSync.getCreateTables(tempDb)
      for (const name in group) {
        let content = '';
        for (const { tableName } of group[name]) {
          content += createTables[tableName]
        }
        content = sqlFormat.format(content, formatRules)
        fs.writeFileSync(path.join(dir, name + '.sql'), content, 'utf8')
      }
    })
  }

  async checkNotNull() {
    await Db.transaction(this.options.db, async db => {
      let createTables = await autoSync.getCreateTables(db)
      let noNotNull = []
      for (const tableName in createTables) {
        let info = sqlParser.parseCreateSql(createTables[tableName])
        for (const colName in info.columns) {
          let col = info.columns[colName]
          if (col.notNull) continue
          if (!col.comment || !col.comment.startsWith('CBN')
            || !col.comment.toLowerCase().startsWith('can be null')) {
            noNotNull.push({ tableName, colName, sql: col.sql })
          }
        }
      }
      this.log(`存在 ${noNotNull.length} 个字段未指定 NOT NULL，可添加以 'Can be null' 开头 COMMENT 来忽略这个警告`)
      this.log(noNotNull.map(c => `${c.tableName}.${c.colName}  : ${c.sql}`).join('\n'))
    })
  }


  async getUpgradeLogs(db, tableName) {
    let rt = await db.query(`SELECT version, seqName, status, detail, sign FROM ${tableName} ORDER BY id`)
    let logs = {}
    for (const row of rt) {
      let v = row.version
      if (!logs[v]) logs[v] = {}
      logs[v][row.seqName] = row
    }
    return { logs, lastLog: rt[rt.length - 1] }
  }

  //返回排好序的 UpgradeData
  loadUpgradeData() {
    let dir = this.upgradeDir()
    let all = requireAll(dir)
    let upgradeData = []
    for (const version in all) {
      let rawUpgrades = all[version]
      for (let seq = 0; seq < rawUpgrades.length; seq++) {
        let item = rawUpgrades[seq]
        if (typeof item == 'object' && !Array.isArray(item)) {
          upgradeData.push(...this.getUpgradeData(version, seq, item.up, item.comment, item.sign))
        } else {
          upgradeData.push(...this.getUpgradeData(version, seq, item))
        }
      }
    }
    upgradeData.sort(this.compareSequence)
    return upgradeData
  }

  compareSequence(a, b) {
    let v = compareVersions(a.version, b.version)
    if (v != 0) return v
    let seqA = a.seqName.split('-').map(v => parseInt(v))
    let seqB = b.seqName.split('-').map(v => parseInt(v))
    if (seqA[0] != seqB[0]) return seqA[0] - seqB[0]
    return (seqA[1] || 0) - (seqB[1] || 0)
  }

  getUpgradeData(version, seq, up, comment = '', sign = '') {
    let upgrades = []
    if (typeof up == 'function') {
      upgrades.push({ version, seqName: `${seq}`, up: up, comment, sign })
      return upgrades
    } else if (typeof up == 'string') {
      up = util.splitOutQuote(up, ';').map(s => s.trim()).filter(s => s != '')
    }
    if (!Array.isArray(up)) throw new Error('不支持的 upgrade 类型:' + up)
    up.forEach((sql, i) => {
      let seqName = i == 0 ? `${seq}` : `${seq}-${i}`
      let s = i == up.length - 1 ? sign : '' //只有最后一个需要 sign
      upgrades.push({ version, seqName, up: sql, comment, sign: s })
    })
    return upgrades
  }

  async doUpgrade(db, tableName, version, seqName, up, comment, sign) {
    await db.query(
      `REPLACE INTO ${tableName}(version, seqName, detail, comment) VALUES(?,?,?,?)`,
      [version, seqName, up.toString(), comment, sign]
    )
    try {
      if (typeof up == 'function') {
        await db.transaction(db => up(db))
      } else {
        await db.query(up)
      }
      if (sign) {
        let curSign = await autoSync.getTablesSignByDb(db)
        if (sign != curSign) throw new Error(`数据库签名不一致， 期望签名：'${sign}'   实际签名：'${curSign}'`)
      }
      await db.query(
        `UPDATE ${tableName} SET status = 1, error = "", sign = ? WHERE version =? AND seqName = ?`,
        [sign || '', version, seqName]
      )
    } catch (e) {
      await db.query(
        `UPDATE ${tableName} SET error = ? WHERE version =? AND seqName = ?`,
        [e.toString(), version, seqName]
      )
      throw new Error(`版本升级失败！！ ${version}(${seqName})  msg:${e.toString()} \nupgrade: ${up.toString()}`)
    }
  }

  async createUpgradeTable(db) {
    await db.query(
      `CREATE TABLE IF NOT EXISTS ${this.tableName()} (
        id bigint unsigned NOT NULL AUTO_INCREMENT,
        version varchar(255) NOT NULL,
        seqName char(6) NOT NULL,
        comment varchar(255) NOT NULL,
        execTime datetime NOT NULL DEFAULT NOW(),
        status tinyint unsigned NOT NULL DEFAULT 0 COMMENT '0:unfinished 1：finished',
        detail text NOT NULL DEFAULT '',
        error text NOT NULL DEFAULT '',
        sign varchar(255) NOT NULL DEFAULT '',
        PRIMARY KEY (id),
        UNIQUE KEY (version, seqName)
      ) ENGINE=InnoDB COMMENT='Create by db-auto-migrate'`
    )
    await db.query(
      `CREATE TABLE IF NOT EXISTS ${this.tableName('lock')} (
        id int unsigned NOT NULL,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB COMMENT='Create by db-auto-migrate'`
    )
  }

  writeMigrationFile(migration, succeed, diffData) {
    let filePath = path.join(this.outDir(), 'migration.js')

    return filePath
  }

}