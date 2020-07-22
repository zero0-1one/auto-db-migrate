'use strict'
const AutoSync = require('./autoSync')
const sqlFormat = require('./sqlFormat')
const sqlParser = require('./sqlParser')
const fs = require('fs')
const path = require('path')
const Db = require('./db')
const util = require('./util')
const compareVersions = require('compare-versions')
const jsStringify = require('javascript-stringify')
const assert = require('assert')

//不提供 down 功能, 您应该追加新的 upgrade 来实现回退.\n在开发环境你可以非常方便的使用 autoSync 功能
module.exports = class Migration {
  constructor(options) {
    this.checkOptions(options)
    this.options = Object.assign(
      {
        prefix: '',
        env: 'development',
        autoSync: 'manual',
        maxRisk: 6,
        onlyOutFile: false,
        autoFormat: true,
        autoSyncMaxTry: 10,
        formatRules: 'normal',
        checkNotNull: true,
        checkPrimaryKey: true,
        gitignore: true,
        logs: console,
        sqlDir: 'sql',
        upgradeDir: 'upgrade',
        autoSyncDir: '.auto_sync',
        tableFilter: [],
      },
      options
    )
    this.sync = new AutoSync({
      maxTry: this.options.autoSyncMaxTry,
      tableFilter: [this.tableName(), this.tableName('lock'), this.tableName('back_point'), ...this.options.tableFilter],
    })
  }

  checkOptions(options) {
    //todo:
    return true
  }

  tableName(type = 'upgrade') {
    let prefix = this.options.prefix || ''
    if (prefix && !prefix.endsWith('_')) prefix = prefix + '_'
    return `${prefix}auto_db_migrate__${type}`
  }

  mkdirs(dirPath) {
    if (fs.existsSync(dirPath)) {
      return
    }
    this.mkdirs(path.dirname(dirPath))
    fs.mkdirSync(dirPath)
  }

  rmdir(dirPath) {
    let files = []
    if (!fs.existsSync(dirPath)) return
    files = fs.readdirSync(dirPath)
    for (const file of files) {
      let curPath = path.join(dirPath, file)
      if (fs.statSync(curPath).isDirectory()) {
        this.rmdir(curPath)
      } else {
        fs.unlinkSync(curPath)
      }
    }
    fs.rmdirSync(dirPath)
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
    let filePath = path.join(dir, '.gitignore')
    if (this.options.gitignore && !fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '/*', 'utf8')
    }
    return dir
  }

  autoSyncFilePath(name) {
    return path.join(this.outDir(), name + '.js')
  }

  cacheFilePath() {
    return path.join(this.outDir(), '.cache')
  }

  compareSeqName(a, b) {
    let seqA = a.split('-').map(v => parseInt(v))
    let seqB = b.split('-').map(v => parseInt(v))
    if (seqA[0] != seqB[0]) return seqA[0] - seqB[0]
    return (seqA[1] || 0) - (seqB[1] || 0)
  }

  compareSequence(a, b) {
    let v = compareVersions(a.version, b.version)
    if (v != 0) return v
    return this.compareSeqName(a.seqName, b.seqName)
  }

  info(str) {
    if (!this.options.logs) return
    this.options.logs.info(`[ ${this.options.db.database} ]  ` + str)
  }

  warn(str) {
    if (!this.options.logs) return
    this.options.logs.warn(`[ ${this.options.db.database} ]  ` + str)
  }

  //加锁 防止多进程部署时候同时执行，（升级过程中可能临时删除外键约束， 期间有时间修改将导致约束失效）
  async lock(cb) {
    let db = new Db(this.options.db)
    let tempDb = new Db(this.options.tempDb)
    try {
      await Db.transaction(this.options.db, async lockDb => {
        if (this.options.__reinit__) {
          //仅测试用,
          this.rmdir(this.outDir())
          await this._clearUpgradeTable(db)
        }
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
      this.info('数据库升级中...')
      this.info('升级过程中不应该有其他数据库操作，因为存在数据不一致的风险， 比如：升级过程中可能临时删除外键约束，导致约束失效')
      let count = await this._upgrade(db, tempDb)
      this.info(`数据库升级成功 共执行了 ${count} 个 upgrade`)
      let { autoSync, autoFormat, checkNotNull, checkPrimaryKey } = this.options
      if (autoSync == 'auto' || autoSync == 'manual') await this._autoSync(db, tempDb)
      if (autoFormat) await this._format(tempDb)
      if (checkNotNull) await this._checkNotNull(db)
      if (checkPrimaryKey) await this._checkPrimaryKey(db)
      return count
    }, true) //锁住所有表 （升级过程中可能临时删除外键约束， 期间有时间修改将导致约束失效）
  }

  async _upgrade(db, tempDb) {
    let tableName = this.tableName()
    let { logs, lastLog } = await this._getUpgradeLogs(db, tableName)
    if (this.options.env == 'development' && !lastLog) {
      //无 upgrade 记录
      let backPoint = await this._getBackPoint(db)
      if (!backPoint) {
        //说明是第一次使用 upgrade
        let createTables = await this.sync.getCreateTablesByDb(db)
        let sign = this.sync.getTablesSign(createTables)
        this.sync.checkForeignKey(createTables)
        this._dumpOldTables(createTables, sign)
        await this._saveBackPoint(db, createTables, sign)
      }
    }

    let upgradeData = this._loadUpgradeData(lastLog && lastLog.version)
    if (upgradeData.length == 0) return 0

    let lastUpgrade = upgradeData[upgradeData.length - 1]
    if (lastLog && lastLog.version == lastUpgrade.version && lastLog.status == 1 && lastLog.seqName == lastUpgrade.seqName) {
      return 0
    }
    if (!lastLog || lastLog.status == 1) await this._autoSyncBack(db, tempDb) //执行新的 upgrade 前需要回退本地 autoSync (如果上次异常则无需回退)
    let count = 0
    for (const { version, seqName, up, comment, sign } of upgradeData) {
      if (logs[version] && logs[version][seqName] && logs[version][seqName].status == 1) continue //已经执行
      if (lastLog && this.compareSequence({ version, seqName }, lastLog) < 0) {
        throw new Error(
          `!! 之前已经更新到 ${lastLog.version}(${lastLog.seqName}), ` +
            `但 ${version}(${seqName}) 未执行过,不应该在历史版本中添加新的 upgrade`
        )
      }
      await this._doUpgrade(db, tableName, version, seqName, up, comment, sign)
      count++
    }

    // if (this.options.env == 'development') {
    let createTables = await this.sync.getCreateTablesByDb(db)
    let sign = this.sync.getTablesSign(createTables)
    await this._saveBackPoint(db, createTables, sign, lastUpgrade)
    // }
    return count
  }

  async _saveBackPoint(db, createTables, sign, lastUpgrade = {}) {
    //back_point 永远只有一条id(1)的记录
    await db.query(`REPLACE INTO ${this.tableName('back_point')}(id, version, seqName, sign, createTables) VALUES(1,?,?,?,?)`, [
      lastUpgrade.version || '',
      lastUpgrade.seqName || '',
      sign,
      JSON.stringify(createTables),
    ])
    return true
  }

  async _getBackPoint(db) {
    let rt = await db.query(`SELECT sign, createTables FROM ${this.tableName('back_point')} WHERE id = 1`)
    if (rt.length > 0)
      return {
        sign: rt[0].sign,
        createTables: JSON.parse(rt[0].createTables),
      }
  }

  //仅仅回退 autoSync 部分
  async _autoSyncBack(db, tempDb) {
    if (this.options.env != 'development') return false

    let backPoint = await this._getBackPoint(db)
    if (!backPoint) return // 这中情况是 upgrade 上次异常退出

    let curTables = await this.sync.getCreateTablesByDb(db)
    let curSign = this.sync.getTablesSign(curTables)
    if (backPoint.sign == curSign) {
      this.info('从上次 upgrade 后没有自动同步, 无需回退')
      return true
    }

    await this._doSync(db, tempDb, curTables, backPoint.createTables, 'autoSyncBack')
    await db.query(`DELETE FROM ${this.tableName('back_point')} WHERE id = 1`)
    return true
  }

  async _autoSync(db, tempDb) {
    if (this.options.env != 'development') return false

    let { sign, fullSql: tgtTables } = await this._updateCache(tempDb)
    let curTables = await this.sync.getCreateTablesByDb(db)
    let curSign = this.sync.getTablesSign(curTables)
    if (sign == curSign) {
      this.info('数据库已经是最新, 无需同步')
      return true
    }

    await this._doSync(db, tempDb, curTables, tgtTables, 'autoSync')

    //计算完整的迁移算法
    let backPoint = await this._getBackPoint(db)
    await this._getMigrationData(tempDb, backPoint.createTables, tgtTables, 'autoUpgrade')
    return true
  }

  async _doSync(db, tempDb, curTables, tgtTables, name) {
    this.sync.checkForeignKey(tgtTables)

    let data = await this._getMigrationData(tempDb, curTables, tgtTables, name)
    if (data.up.length == 0) {
      this.info('数据库已经是最新, 无需同步')
      return
    }
    if (this.options.autoSync == 'auto' || data.confirm) {
      let risk = this._getRisk(data)
      if (risk > this.options.maxRisk && !data.confirm) {
        throw new Error(
          `当前${name}操纵风险值过高(${risk.toFixed(2)})， 请前往 ${this.autoSyncFilePath(name)} 确认, 并将 confirm  改为 true`
        )
      }
      this.info(`开始执行 ${name} ...`)
      let sign = await this.sync.doMigration(db, data.up)
      let newCurTables = await this.sync.getCreateTablesByDb(db)
      let diffData = await this.sync.diffByCreateTables(newCurTables, tgtTables)
      if (sign != data.sign.end) throw new Error(`执行 ${name} 后未能达到目标状态 ！！\n` + JSON.stringify(diffData, null, 2))
      this.info(`执行 ${name} 完成, 当前数据库签名: ${sign}`)
    } else {
      assert(this.options.autoSync == 'manual')
      this.info(`当前 autoSync 为 'manual'， 需要手动将 ${this.autoSyncFilePath(name)} 文件中 confirm  改为 true`)
    }
  }

  _getRisk(data) {
    if (data.confirm) return 0
    let risk = 0
    for (let sql of data.up) {
      if (sql.match(/\bDROP\s+TABLE\b/i)) {
        risk += 1
      } else if (sql.match(/\bDROP\s+COLUMN\b/i)) {
        risk += 0.25
      } else if (sql.match(/\bCHANGE\s+COLUMN\b/i)) {
        risk += 0.1
      } else if (sql.match(/\bMODIFY\s+COLUMN\b/i)) {
        risk += 0.1
      }
    }
    return risk
  }

  //先加载文件， 如果没有则通过迁移算法计算
  async _getMigrationData(tempDb, curTables, tgtTables, name) {
    let beginSign = this.sync.getTablesSign(curTables)
    let endSign = this.sync.getTablesSign(tgtTables)

    let filePath = this.autoSyncFilePath(name)
    let data = this._loadAutoSyncFile(name)
    if (data && data.sign.begin == beginSign && data.sign.end == endSign) {
      if (beginSign == endSign && data.up.length == 0) return data //空切相等无需验证
      this.info(`已存在 ${filePath} 文件, 无需重新计算。 进行验证...`)
      let succeed = await this.sync.verifyMigration(tempDb, curTables, data.up, endSign)
      if (!succeed) {
        let diffData = this.sync.diffByCreateTables(curTables, tgtTables)
        throw new Error(`验证失败! 需手动修改或删除重新计算 \n` + JSON.stringify(diffData))
      }
      return data
    }
    //需要重新计算
    this.info(`开始计算 ${name} 迁移算法...`)
    let results = await this.sync.createMigrationByTables(tempDb, curTables, tgtTables)
    let newData = this._writeAutoSyncFile(results, name)
    if (!results.succeed) {
      throw new Error(`${name} 迁移算法计算失败! 结果已经记录到 ${filePath}, 你可以手动修复后再试`)
    } else {
      this.info(`${name} 迁移算法计算成功, 已经写入到 ${filePath}`)
    }
    return newData
  }

  async format() {
    return await Db.transaction(this.options.tempDb, tempDb => this._format(tempDb))
  }

  async _format(tempDb) {
    if (this.options.env != 'development') return false

    let dir = this.sqlDir()
    let { format, fullSql } = await this._updateCache(tempDb)
    let group = this.sync.getTableGroup(dir, this.options.prefix)
    for (const name in group) {
      if (name != '.init_old') {
        let content = ''
        for (const { tableName } of group[name]) {
          content += format[tableName]
        }
        fs.writeFileSync(path.join(dir, name + '.sql'), content, 'utf8')
      }
    }

    this.info(`sql文件格式化完成`)
    return true
  }

  _dumpOldTables(oldTables, sign) {
    if (this.options.env != 'development') return false
    if (Object.keys(oldTables).length == 0) return false

    let current = this.sync.getCreateTablesByDir(this.sqlDir())
    if (Object.keys(current).length > 0) return //已经存在定义的 tables 不自动导出

    let content = '# 此文件是因为第一次使用 auto_db_migrate 时 sql 目录为空, 但数据库不为空. 自动导出现有表结构, 作为初始状态.\n'
    content += '# 此文件不进行自动格式化, 你可以重命名, 或用其他文件重新组织该文件内容\n'
    content += '# sign: ' + sign + '\n\n'
    for (const tableName in oldTables) {
      content += oldTables[tableName] + '\n\n'
    }
    fs.writeFileSync(path.join(this.sqlDir(), '.init_old.sql'), content, 'utf8')
    return true
  }

  async _checkNotNull(db) {
    if (this.options.env != 'development') return

    let createTables = await this.sync.getCreateTablesByDb(db)
    let noNotNull = []
    for (const tableName in createTables) {
      let info = sqlParser.parseCreateSql(createTables[tableName], ['columns'])
      for (const colName in info.columns) {
        let col = info.columns[colName]
        if (
          col.notNull ||
          col.dataType.endsWith('blob') ||
          col.dataType.endsWith('text') ||
          ['geometry', 'json'].includes(col.dataType)
        )
          continue
        if (!col.comment || !(col.comment.startsWith('CBN') || col.comment.toLowerCase().startsWith('can be null'))) {
          noNotNull.push({ tableName, colName, sql: col.sql })
        }
      }
    }
    if (noNotNull.length > 0) {
      this.warn(
        `存在 ${noNotNull.length} 个字段未指定 NOT NULL，可添加以 'Can be null' 开头 COMMENT 来忽略这个警告\n` +
          noNotNull.map(c => `${c.tableName}.${c.colName}  : ${c.sql}`).join('\n')
      )
    }
  }

  async _checkPrimaryKey(db) {
    if (this.options.env != 'development') return

    let createTables = await this.sync.getCreateTablesByDb(db)
    let noPrimaryKey = []
    for (const tableName in createTables) {
      let info = sqlParser.parseCreateSql(createTables[tableName], ['keys'])
      if (!info.keys['primaryKey']) noPrimaryKey.push(tableName)
    }
    if (noPrimaryKey.length > 0) {
      this.warn(`存在 ${noPrimaryKey.length} 个表没有指定主键， 通常应该为每一个表指定主键\n` + noPrimaryKey.join(', '))
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
  _loadUpgradeData(lastVersion) {
    let dir = this.upgradeDir()
    let upgradeData = []
    let files = fs.readdirSync(dir)
    for (const file of files) {
      if (!file.endsWith('.js')) continue
      let version = file.slice(0, -3)
      if (lastVersion && compareVersions(version, lastVersion) < 0) continue

      let filePath = path.join(dir, file)
      let stat = fs.statSync(filePath)
      if (!stat.isFile()) continue
      let rawUpgrades = require(filePath)
      for (let seq = 0; seq < rawUpgrades.length; seq++) {
        let item = rawUpgrades[seq]
        if (typeof item == 'object' && !Array.isArray(item)) {
          upgradeData.push(...this._getUpgradeData(version, seq, item.up, item.comment, item.sign))
        } else {
          upgradeData.push(...this._getUpgradeData(version, seq, item))
        }
      }
    }
    upgradeData.sort(this.compareSequence.bind(this))
    return upgradeData
  }

  _getUpgradeData(version, seq, up, comment = '', sign = {}) {
    let upgrades = []
    if (typeof up == 'function') {
      upgrades.push({ version, seqName: `${seq}`, up: up, comment, sign })
      return upgrades
    } else if (typeof up == 'string') {
      up = util
        .splitOutQuote(up, ';')
        .map(s => s.trim())
        .filter(s => s != '')
    }
    if (!Array.isArray(up)) throw new Error('不支持的 upgrade 类型:' + up)
    up.forEach((sql, i) => {
      let seqName = i == 0 ? `${seq}` : `${seq}-${i}`
      let s = {
        begin: i == 0 ? sign.begin : '',
        end: i == up.length - 1 ? sign.end : '',
      }
      upgrades.push({ version, seqName, up: sql, comment, sign: s })
    })
    return upgrades
  }

  async _doUpgrade(db, tableName, version, seqName, up, comment, sign = {}) {
    await db.query(`REPLACE INTO ${tableName}(version, seqName, detail, comment) VALUES(?,?,?,?)`, [
      version,
      seqName,
      up.toString(),
      comment,
      sign,
    ])
    try {
      if (sign.begin) {
        let curTables = await this.sync.getCreateTablesByDb(db)
        let curSign = await this.sync.getTablesSign(curTables)
        if (sign.begin != curSign) {
          let backPoint = await this._getBackPoint(db)
          let diffData = this.sync.diffByCreateTables(curTables, backPoint.createTables)
          throw new Error(
            `执行前签名不一致， 期望签名：'${sign.begin}'   实际签名：'${curSign}'  BackPoint签名：'${backPoint.sign}'\n当前与BackPoint结构差异：\n` +
              jsStringify.stringify(diffData, null, 2)
          )
        }
      }
      if (typeof up == 'function') {
        await db.transaction(db => up(db))
      } else {
        await db.offForeignKey(db => db.query(up))
      }
      if (sign.end) {
        let curSign = await this.sync.getTablesSignByDb(db)
        if (sign.end != curSign) throw new Error(`执行后签名不一致， 期望签名：'${sign.end}'   实际签名：'${curSign}'`)
      }
      await db.query(`UPDATE ${tableName} SET status = 1, error = "", sign = ? WHERE version =? AND seqName = ?`, [
        sign.end || '',
        version,
        seqName,
      ])
    } catch (e) {
      await db.query(`UPDATE ${tableName} SET error = ? WHERE version =? AND seqName = ?`, [e.toString(), version, seqName])
      throw new Error(`版本升级失败！！ ${version}(${seqName})  msg:${e.toString()} \nupgrade: ${up.toString()}`)
    }
  }

  async _clearUpgradeTable(db) {
    await db.query(`DROP TABLE IF EXISTS ${this.tableName()}`)
    await db.query(`DROP TABLE IF EXISTS ${this.tableName('lock')}`)
    await db.query(`DROP TABLE IF EXISTS ${this.tableName('back_point')}`)
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
        detail text,
        error text,
        sign varchar(255) NOT NULL DEFAULT '',
        PRIMARY KEY (id),
        UNIQUE KEY (version, seqName)
      ) ENGINE=InnoDB COMMENT='Create by auto-db-migrate'`
    )
    await db.query(
      `CREATE TABLE IF NOT EXISTS ${this.tableName('lock')} (
        id int unsigned NOT NULL,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB COMMENT='Create by auto-db-migrate'`
    )

    if (this.options.env == 'development') {
      await db.query(
        `CREATE TABLE IF NOT EXISTS ${this.tableName('back_point')} (
          id int unsigned NOT NULL,
          version varchar(255) NOT NULL,
          seqName char(6) NOT NULL,
          sign varchar(255) NOT NULL,
          createTables mediumtext,
          time datetime NOT NULL DEFAULT NOW(),
          PRIMARY KEY (id)
        ) ENGINE=InnoDB COMMENT='Create by auto-db-migrate'`
      )
    }
  }

  requireNoCache(filePath) {
    try {
      delete require.cache[require.resolve(filePath)]
      return require(filePath)
    } catch (e) {}
  }

  _loadAutoSyncFile(name) {
    let data = this.requireNoCache(this.autoSyncFilePath(name))
    if (data) return Array.isArray(data) ? data[0] : data
  }

  _writeAutoSyncFile(results, name) {
    let filePath = this.autoSyncFilePath(name)
    let data = Object.assign(
      {
        confirm: false,
        comment: '',
        date: new Date().toLocaleString(),
        up: results.migration.map(s => (s.endsWith(';') ? s : s + ';')),
      },
      results
    )

    delete data.migration
    let outData = name == 'autoUpgrade' ? [data] : data
    let content = jsStringify.stringify(outData, null, 2)
    content = util.changeByQuote(content, { char: "'", type: 'in' }, item => {
      let str = item.str
      let index = content.lastIndexOf('\n', item.start)
      let index2 = content.lastIndexOf(' ', item.start)
      if (index == -1) index = 0
      if (index2 == -1) index2 = item.start
      let indent = new Array(index2 - index).fill(' ').join('')
      str = str.replace(/\\n/g, `\\n' +\n${indent}'`)
      return str == item.str ? str : str + '\n'
    })

    content = util.changeByQuote(content, { char: "'", type: 'out' }, item => {
      return item.str.replace(/\n,\n/, ',\n\n')
    })

    let header = ''
    if (name == 'autoSync') {
      if (fs.existsSync(filePath)) {
        let files = this._getAutoSyncFiles().sort((a, b) => b.num - a.num)
        let num = files.length > 0 ? files[0].num + 1 : 0
        fs.renameSync(filePath, this.autoSyncFilePath(`${name}_${num}`))
      }
      header += '//此文件为 autoSync 自动生成文件, 如果需要重新计算, 请删除此文件.\n'
      header += "//如果 autoSync 为 'manual' , 需要将 confirm : false  改为 true 后重启执行\n"
    } else if (name == 'autoSyncBack') {
      this._clearAutoSyncFile()
      header += '//此文件为 autoSyncBack 自动生成文件, 如果需要重新计算, 请删除此文件.\n'
      header += "//如果 autoSync 为 'manual' , 需要将 confirm : false  改为 true 后重启执行\n"
    } else {
      assert(name == 'autoUpgrade')
      header += '//此文件是本地自动同步的完整版本。它并不是 autoSync_XX 系列文件的简单合并，\n'
      header += '//而是会去掉一些失效的步骤，比如:添加了一个table ，然后又删除了这个table.\n\n'
      header += '//你可以直接拷贝该文件到 upgrade 目录, 重命名为一个新版本\n'
    }
    fs.writeFileSync(filePath, header + 'module.exports =' + content, 'utf8')
    return data
  }

  _getAutoSyncFiles() {
    let autoSyncFiles = []
    let dir = this.outDir()
    let files = fs.readdirSync(dir)
    for (const file of files) {
      let results = file.match(/^autoSync_([0-9])+\.js$/)
      if (results) {
        autoSyncFiles.push({
          path: path.join(dir, file),
          name: file.slice(0, -3),
          num: parseInt(results[1]),
        })
      }
    }
    return autoSyncFiles
  }

  _clearAutoSyncFile() {
    let files = this._getAutoSyncFiles()
    for (const info of files) {
      fs.unlinkSync(info.path)
    }
    let filePath = this.autoSyncFilePath('autoSync')
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  }

  _loadCache() {
    try {
      let content = fs.readFileSync(this.cacheFilePath(), 'utf8')
      if (content) return JSON.parse(content)
    } catch (e) {}
  }

  async _updateCache(tempDb) {
    let cache = this._loadCache() || {}
    let { formatRules, formatByDb, prefix } = this.options
    let strRules = sqlFormat.rulesToString(formatRules)
    let isSameRules = strRules == cache.strRules && formatByDb == cache.formatByDb

    let tables = this.sync.getCreateTablesByDir(this.sqlDir(), prefix)
    let cacheTables = cache.tables || {}
    let cacheFormat = cache.format || {}
    let cacheFullSql = cache.fullSql || {}
    let format = {}
    let fullSql = {}

    let changeTables = {}
    for (const tableName in tables) {
      if (cacheTables[tableName] && cacheTables[tableName] == tables[tableName]) {
        fullSql[tableName] = cacheFullSql[tableName]
      } else {
        changeTables[tableName] = tables[tableName]
      }
    }

    if (Object.keys(changeTables).length > 0) {
      await this.sync.initTempDbByTables(tempDb, changeTables)
      let createTables = await this.sync.getCreateTablesByDb(tempDb)
      Object.assign(fullSql, createTables)
    }
    let sign = this.sync.getTablesSign(fullSql)
    let rules = sqlFormat.createRules(formatRules, true)
    let cacheFormatSql = formatByDb ? cacheFullSql : cacheTables
    let formatSql = formatByDb ? fullSql : tables
    let changeFormat = {}
    for (const tableName in tables) {
      if (isSameRules && cacheFormatSql[tableName] == formatSql[tableName]) {
        format[tableName] = cacheFormat[tableName]
      } else {
        changeFormat[tableName] = sqlFormat.formatOne(formatSql[tableName], rules)
      }
    }
    // 检测format 后的结果
    await this.sync.initTempDbByTables(tempDb, changeFormat)
    let newCreateTables = await this.sync.getCreateTablesByDb(tempDb)
    for (const tableName in newCreateTables) {
      if (fullSql[tableName] != newCreateTables[tableName]) {
        throw new Error(
          `${tableName} Format结果与原定义不一致,\nformat后:\n${changeFormat[tableName].trim()}\nformat前\n${tables[tableName]}`
        )
      }
    }

    Object.assign(format, changeFormat)
    let data = { sign, strRules, formatByDb, tables, fullSql, format }
    fs.writeFileSync(this.cacheFilePath(), JSON.stringify(data, null, 2), 'utf8')
    return data
  }
}
