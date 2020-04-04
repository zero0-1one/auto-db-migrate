'use strict'
const AutoSync = require('./autoSync')
const sqlFormat = require('./sqlFormat')
const sqlParser = require('./sqlParser')
const fs = require('fs')
const path = require('path')
const Db = require('./db')
const util = require('./util')
const compareVersions = require('compare-versions')
const requireAll = require('require-all')
const jsStringify = require('javascript-stringify')
const assert = require('assert')

//不提供 down 功能, 您应该追加新的 upgrade 来实现回退.\n在开发环境你可以非常方便的使用 autoSync 功能
module.exports = class Migration {
  constructor(options) {
    this.checkOptions(options)
    this.options = Object.assign({
      prefix: '',
      env: 'development',
      autoSync: 'off',
      onlyOutFile: false,
      autoFormat: true,
      autoSyncMaxTry: 10,
      formatRules: 'normal',
      checkNotNull: true,
      gitignore: true,
      showLog: true,
      sqlDir: 'sql',
      upgradeDir: 'upgrade',
      autoSyncDir: 'auto_sync',
    }, options)
    this.sync = new AutoSync({
      maxTry: this.options.autoSyncMaxTry,
      tableFilter: [
        this.tableName(),
        this.tableName('lock'),
        this.tableName('back_point')
      ]
    })
  }

  checkOptions(options) {
    //todo:
    return true
  }


  tableName(type = 'upgrade') {
    let prefix = this.options.prefix || ''
    if (prefix && !prefix.endsWith('_')) prefix = prefix + '_'
    return `${prefix}db_auto_migrate__${type}`
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

  autoSyncFile(name) {
    return path.join(this.outDir(), name + '.js')
  }

  log(str, ...args) {
    if (!this.options.showLog) return
    console.log(`[ ${this.options.db.database} ]  ` + str, ...args)
  }

  //加锁 防止多进程部署时候同时执行
  async lock(cb) {
    let db = new Db(this.options.db)
    let tempDb = new Db(this.options.tempDb)
    try {
      await Db.transaction(this.options.db, async (lockDb) => {
        await this.createUpgradeTable(lockDb)
        await db.query(`REPLACE INTO ${this.tableName('lock')}(id) VALUES(?)`, [1])
        return await cb(db, tempDb)
      })
    } finally {
      db.close()
      tempDb.close()
    }
  }

  async upgrade() {
    return await this.lock(async (db, tempDb) => {
      this.log(`数据库升级中...`)
      let count = await this._upgrade(db, tempDb)
      this.log(`数据库升级成功 共执行了 ${count} 个 upgrade`)
      let { autoSync, autoFormat, checkNotNull } = this.options
      if (autoSync == 'auto' || autoSync == 'manual') await this._autoSync(db, tempDb)
      if (autoFormat) await this._format(tempDb)
      if (checkNotNull) await this._checkNotNull(db)
      return count
    })
  }

  async _upgrade(db, tempDb) {
    let upgradeData = this.loadUpgradeData()
    if (upgradeData.length == 0) return 0

    let tableName = this.tableName()
    let { logs, lastLog } = await this._getUpgradeLogs(db, tableName)
    let lastUpgrade = upgradeData[upgradeData.length - 1]
    if (lastLog && lastLog.version == lastUpgrade.version && lastLog.seqName == lastUpgrade.seqName) return 0
    await this._autoSyncBack(db, tempDb)//执行新的 upgrade 前需要回退本地 autoSync 
    let count = 0
    for (const { version, seqName, up, comment, sign } of upgradeData) {
      if (logs[version] && logs[version][seqName].status == 1) continue//已经执行
      if (lastLog && this.compareSequence({ version, seqName }, lastLog) < 0) {
        throw new Error(`!! 之前已经更新到 ${lastLog.version}(${lastLog.seqName}), `
          + `但 ${version}(${seqName}) 未执行过,不应该在历史版本中添加新的 upgrade`
        )
      }
      await this.doUpgrade(db, tableName, version, seqName, up, comment, sign)
      count++
    }
    await this._saveBackPoint(db, lastUpgrade)
    return count
  }

  async _saveBackPoint(db, lastUpgrade) {
    let createTables = await this.sync.getCreateTables(db)
    let sign = this.sync.getTablesSign(createTables)
    //back_point 永远只有一条id(1)的记录
    await db.query(`REPLACE INTO ${this.tableName('back_point')}(id, version, seqName, sign, createTables) VALUES(1,?,?,?,?)`,
      [lastUpgrade.version, lastUpgrade.seqName, sign, JSON.stringify(createTables)]
    )
  }

  async _getBackPoint(db) {
    let rt = await db.query(`SELECT sign, createTables FROM ${this.tableName('back_point')} WHERE id = 1`)
    if (rt.length > 0) return {
      sign: rt[0].sign,
      createTables: JSON.parse(rt[0].createTables)
    }
  }


  async autoSyncBack() {
    return await this.lock((db, tempDb) => this._autoSyncBack(db, tempDb))
  }

  //仅仅回退 autoSync 部分
  async _autoSyncBack(db, tempDb) {
    if (this.options.env != 'development') return false

    let backPoint = await this._getBackPoint(db)
    if (!backPoint) return
    await this._doSync(db, tempDb, backPoint.createTables, 'autoSyncBack')
    await db.query(`DELETE FROM ${this.tableName('back_point')} WHERE id = 1`)
    return true
  }

  async autoSync() {
    return await this.lock((db, tempDb) => this._autoSync(db, tempDb))
  }

  async _autoSync(db, tempDb) {
    if (this.options.env != 'development') return false

    await this.sync.initTempDbByDir(tempDb, this.sqlDir(), this.options.prefix)
    let tgtTables = await this.sync.getCreateTables(tempDb)
    await this._doSync(db, tempDb, tgtTables, 'autoSync')
    return true
  }

  async _doSync(db, tempDb, tgtTables, name) {
    let curTables = await this.sync.getCreateTables(db)
    let data = await this._getMigrationData(tempDb, curTables, tgtTables, name)
    if (this.options.autoSync == 'auto' || data.confirm) {
      this.log(`开始执行 ${name} ...`)
      let sign = await this.sync.doMigration(db, data.up)
      let newCurTables = await this.sync.getCreateTables(db)
      let diffData = await this.sync.diffByCreateTables(newCurTables, tgtTables)
      if (sign != data.sign.end) throw new Error(`执行 ${name} 后未能达到目标状态 ！！\n` + JSON.stringify(diffData, null, 2))
      this.log(`执行 ${name} 完成, 当前数据库签名: ${sign}`)
    } else {
      assert(this.options.autoSync == 'manual')
      this.log(`当前 autoSync 为 'manual'， 需要手动将 ${this.autoSyncFile(name)} 文件中 confirm  改为 true `)
    }
  }

  //先加载文件， 如果没有则通过迁移算法计算
  async _getMigrationData(tempDb, curTables, tgtTables, name) {
    let beginSign = this.sync.getTablesSign(curTables)
    let endSign = this.sync.getTablesSign(tgtTables)
    let filePath = this.autoSyncFile(name)
    let data = this.requireNoCache(filePath)

    if (data && data.sign.begin == beginSign && data.sign.end == endSign) {
      this.log(`已存在 ${filePath} 文件, 无需重新计算。 进行验证...`)
      let succeed = await this.sync.verifyMigration(tempDb, curTables, data.up, endSign)
      if (!succeed) {
        let diffData = this.sync.diffByCreateTables(curTables, tgtTables)
        throw new Error(`验证失败! 需手动修改或删除重新计算 \n` + JSON.stringify(diffData))
      }
      return data
    }
    //需要重新计算
    this.log(`开始计算${name}迁移算法...`)
    let results = await this.sync.createMigrationByTables(tempDb, curTables, tgtTables)
    let newData = this.writeAutoSyncFile(results, name)
    if (!results.succeed) {
      throw new Error(`${name}迁移算法计算失败(${results.msg})! 结果已经记录到 ${filePath}, 你可以手动修复后再试`)
    } else {
      this.log(`${name}迁移算法计算成功, 已经写入到 ${filePath}`)
    }
    return newData
  }

  async format() {
    return await this.lock((db, tempDb) => this._format(tempDb))
  }

  async _format(tempDb) {
    if (this.options.env != 'development') return false

    if (this.options.formatByDb) {
      await this._formatByDb(tempDb)
    } else {
      this._formatByDir()
    }
    this.log(`sql文件格式化完成`)
    return true
  }

  _formatByDir() {
    let { prefix, formatRules } = this.options
    let dir = this.sqlDir()
    let group = this.sync.getTableGroup(dir, prefix)
    for (const name in group) {
      let content = group[name].map(t => t.sql).join(';\n')
      content = sqlFormat.format(content, formatRules)
      fs.writeFileSync(path.join(dir, name + '.sql'), content, 'utf8')
    }
  }

  async _formatByDb(tempDb) {
    let { prefix, formatRules } = this.options
    let dir = this.sqlDir()
    let group = await this.sync.initTempDbByDir(tempDb, dir, prefix)
    let createTables = await this.sync.getCreateTables(tempDb)
    for (const name in group) {
      let content = '';
      for (const { tableName } of group[name]) {
        content += createTables[tableName]
      }
      content = sqlFormat.format(content, formatRules)
      fs.writeFileSync(path.join(dir, name + '.sql'), content, 'utf8')
    }
  }

  async _checkNotNull(db) {
    if (this.options.env != 'development') return

    let createTables = await this.sync.getCreateTables(db)
    let noNotNull = []
    for (const tableName in createTables) {
      let info = sqlParser.parseCreateSql(createTables[tableName])
      for (const colName in info.columns) {
        let col = info.columns[colName]
        if (col.notNull) continue
        if (!col.comment || !(col.comment.startsWith('CBN')
          || col.comment.toLowerCase().startsWith('can be null'))) {
          noNotNull.push({ tableName, colName, sql: col.sql })
        }
      }
    }
    if (noNotNull.length > 0) {
      this.log(`存在 ${noNotNull.length} 个字段未指定 NOT NULL，可添加以 'Can be null' 开头 COMMENT 来忽略这个警告`)
      this.log(noNotNull.map(c => `${c.tableName}.${c.colName}  : ${c.sql}`).join('\n'))
    }
  }


  async _getUpgradeLogs(db, tableName) {
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

  getUpgradeData(version, seq, up, comment = '', sign = {}) {
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
      let s = {
        begin: i == 0 ? sign.begin : '',
        end: i == up.length - 1 ? sign.end : ''
      }
      upgrades.push({ version, seqName, up: sql, comment, sign: s })
    })
    return upgrades
  }

  async doUpgrade(db, tableName, version, seqName, up, comment, sign = {}) {
    await db.query(
      `REPLACE INTO ${tableName}(version, seqName, detail, comment) VALUES(?,?,?,?)`,
      [version, seqName, up.toString(), comment, sign]
    )
    try {
      if (sign.begin) {
        let curSign = await this.sync.getTablesSignByDb(db)
        if (sign.begin != curSign) throw new Error(`执行前签名不一致， 期望签名：'${sign.begin}'   实际签名：'${curSign}'`)
      }
      if (typeof up == 'function') {
        await db.transaction(db => up(db))
      } else {
        await db.query(up)
      }
      if (sign.end) {
        let curSign = await this.sync.getTablesSignByDb(db)
        if (sign.end != curSign) throw new Error(`执行后签名不一致， 期望签名：'${sign.end}'   实际签名：'${curSign}'`)
      }
      await db.query(
        `UPDATE ${tableName} SET status = 1, error = "", sign = ? WHERE version =? AND seqName = ?`,
        [sign.end || '', version, seqName]
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

    if (this.options.env == 'development') {
      await db.query(
        `CREATE TABLE IF NOT EXISTS ${this.tableName('back_point')} (
          id int unsigned NOT NULL,
          version varchar(255) NOT NULL,
          seqName char(6) NOT NULL,
          sign varchar(255) NOT NULL,
          createTables mediumtext NOT NULL DEFAULT '',
          time datetime NOT NULL DEFAULT NOW(),
          PRIMARY KEY (id)
        ) ENGINE=InnoDB COMMENT='Create by db-auto-migrate'`
      )
    }
  }

  requireNoCache(filePath) {
    try {
      delete require.cache[require.resolve(filePath)]
      return require(filePath)
    } catch (e) { }
  }

  writeAutoSyncFile(results, name) {
    let filePath = this.autoSyncFile(name)
    let data = Object.assign({
      confirm: false,
      comment: '',
      date: new Date().toLocaleString(),
      up: results.migration.map(s => s.endsWith(';') ? s : s + '; ')
    }, results)

    delete data.migration
    let content = jsStringify.stringify(data, null, 2)
    content = util.changeByQuote(content, { char: '\'', type: 'in' }, item => {
      let str = item.str
      let index = content.lastIndexOf('\n', item.start)
      let indent = new Array(item.start - index - 1).fill(' ').join('')
      str = str.replace(/\\n/g, `\\n' +\n${indent}'`)
      return str == item.str ? str : str + '\n'
    })

    content = util.changeByQuote(content, { char: '\'', type: 'out' }, item => {
      return item.str.replace(/\n,\n/, ',\n\n')
    })
    let header = '//如果需要重新计算,请删除此文件.\n'
      + '//如果 autoSync 为 \'manual\' ,需要将 confirm : false  改为 true, 才会执行\n'
      + '//测试稳定后, 可将下面对象直接追加到对应的 upgrade 文件后\n'
      + 'module.exports ='

    if (fs.existsSync(filePath)) {
      let data = this.requireNoCache(filePath)
      let date = (data && data.date) ? data.date : new Date().toLocaleString()
      date = date.replace(/:/g, '_')
      fs.renameSync(filePath, this.autoSyncFile(name + ' ' + date))
    }
    fs.writeFileSync(filePath, header + content, 'utf8')
    return data
  }
}