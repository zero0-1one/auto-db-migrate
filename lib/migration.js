'use strict'
const autoSync = require('./autoSync')
const sqlFormat = require('./sqlFormat')
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
      autoSync: false,
      onlyOutFile: false,
      autoFormat: true,
      autoSyncMaxTry: 10,
      formatRules: 'normal',
    }, options)
  }

  checkOptions(options) {
    //todo:
    return true
  }


  tableName(type = '') {
    let prefix = this.options.prefix || ''
    if (prefix && !prefix.endsWith('_')) prefix = prefix + '_'
    let tableName = prefix + 'upgrade'
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
    return this.workDir('upgrade')
  }

  sqlDir() {
    return this.workDir('sql')
  }

  outDir() {
    let dir = this.workDir('auto_sync')
    fs.writeFileSync(path.join(dir, '.gitignore'), '/*', 'utf8')
    return dir
  }


  log(...args) {
    if (!this.options.showLog) return
    console.log(...args)
  }

  async upgrade() {
    let db = new Db(this.options.db)
    this.log(`[${db.database}] 数据库升级中`)
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
          if (lastLog && compareVersions(version, lastLog.version) < 0) {
            throw new Error(`!! 之前已经更新到 ${lastLog.version}(${lastLog.seqName}), `
              + `但 ${version}(${seqName}) 未执行过, 不应该在历史版本中添加新的 upgrade`
            )
          }
          await this.doUpgrade(db, tableName, version, seqName, up, comment, sign)
          count++
        }
        return count
      })
      let autoSync = this.options.autoSync
      if (autoSync == 'auto' || autoSync == 'manual') await this.autoSync()
    } finally {
      await db.close()
    }
  }

  async autoSync() {
    let dir = this.sqlDir()
    let db = new Db(this.options.db)
    let tempDb = new Db(this.options.tempDb)
    try {
      this.log(`开始自动同步  ${db.database},  dir:${dir}`)
      autoSync.setTableFilter([this.tableName(), this.tableName('lock')])

      await autoSync.clearTempDataBase(tempDb)
      await autoSync.initTempDbByDir(tempDb, dir, this.options.prefix)
      let { migration, succeed, diffData } = await autoSync.createMigration(db, tempDb, this.options.autoSyncMaxTry)
      this.writeMigrationFile(migration, succeed, diffData)
      if (!succeed) {
        throw new Error('迁移算法,未能使数据库结构最终状态一致. 可以调大 `autoSyncMaxTry` 参数再尝试,\n' + JSON.stringify(diffData, null, 2))
      }
      if (this.options.autoSync == 'auto') {
        await autoSync.sync(db, migration, 'up')
      }
    } finally {
      db.close()
      tempDb.close()
    }
  }

  async format() {
    let dir = this.sqlDir()
    let { prefix, formatRules, formatByDb } = this.options
    let group = autoSync.getTableGroup(dir, prefix)

    if (formatByDb) {
      await this._formatByDb(dir, group, formatRules)
    } else {
      await this._formatByDir(dir, group, formatRules)
    }
  }

  _formatByDir(dir, group, rules) {
    for (const name in group) {
      let content = sqlFormat.format(group[name].content, rules)
      fs.writeFileSync(path.join(dir, name + '.sql'), content, 'utf8')
    }
  }

  async _formatByDb(dir, group, rules) {
    await Db.transaction(this.options.tempDb, async tempDb => {
      let createTables = await autoSync.getCreateTables(tempDb)
      for (const name in group) {
        let content = '';
        for (const tableName of group[name].tables) {
          content += createTables[tableName]
        }
        content = sqlFormat.format(content, rules)
        fs.writeFileSync(path.join(dir, name + '.sql'), content, 'utf8')
      }
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
    let versions = Object.keys(logs).sort((a, b) => -compareVersions(a, b))
    return { logs, lastLog: versions[0] }
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
      `REPLACE INTO ${tableName}(version, seqName, detail, comment, sign) VALUES(?,?,?,?,?)`,
      [version, seqName, up.toString(), comment, sign]
    )
    try {
      if (typeof up == 'function') {
        await db.transaction(db => up(db))
      } else {
        await db.query(up)
      }
      await db.query(
        `UPDATE ${tableName} SET status = 1, error = "" WHERE version =? AND seqName = ?`,
        [version, seqName]
      )
    } catch (e) {
      await db.query(
        `UPDATE ${tableName} SET error = ? WHERE version =? AND seqName = ?`,
        [e.toString(), version, seqName]
      )
      throw new Error(`版本升级失败！！  ${version}(${seqName})  msg:${e.toString()} \nupgrade: ${up.toString()}`)
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
  }

}