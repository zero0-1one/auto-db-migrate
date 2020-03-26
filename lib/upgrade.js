'use strict'

const tools = require('./tools')
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const requireAll = require('require-all')
const compareVersions = require('compare-versions')
const { diff } = require('deep-diff')

/**
 * 目前只支持 mysql 隔离等级 READ-COMMITTED 
 */
class Upgrade {
  constructor(theone) {
    this.theone = theone
  }

  mkdirs(dirPath) {
    if (fs.existsSync(dirPath)) {
      return
    }
    this.mkdirs(path.dirname(dirPath))
    fs.mkdirSync(dirPath)
  }

  //检查每个字段 必须未 NOT NULL  或者明确指定 DEFAULT NULL
  checkNotNull(createSql) {
    let rows = createSql.split('\n')
    let warnRows = []
    for (let i = 1; i < rows.length - 1; i++) {
      if (!(rows[i].includes('NOT NULL')
        || rows[i].includes('DEFAULT NULL')
        || rows[i].includes('KEY')
      )) {
        warnRows.push(rows[i])
      }
    }
    return warnRows
  }

  /**
   * group 定义表接口分类和顺序
   * 如：{
   *  'fileA':['a1', 'a2'],
   *  'fileB':['b1', 'a3'],
   * }
   * a1, a2 表结构就会写入 fileA.sql
   * 如果没定义的表 就会写入 struct.sql
   * 
   * 返回 dir 原有数据, 与新数据差异信息
   * */
  async dumpStructure(dbName, dir, group = {}, prefix = '') {
    let theone = this.theone
    theone.log.info(`[${dbName}]数据库结构导出中。。。`)
    this.mkdirs(dir)

    if (!group.struct) group.struct = []
    let groupTables = new Set()
    for (const fileName in group) {
      for (const tableName of group[fileName]) {
        groupTables.add(tableName)
      }
    }

    let structs = await this.getTableStructs(dbName)
    for (const tableName in structs) {
      if (!groupTables.has(tableName)) group.struct.push(tableName)
    }

    if (prefix && !prefix.endsWith('_')) prefix = prefix + '_'
    for (const fileName in group) {
      let contents = group[fileName].map(tableName => {
        if (!structs[tableName]) theone.log.warn(`[${dbName}]数据库不存在 table:${tableName}`)
        return structs[tableName] || ''
      }).join('\n\n\n')

      let filePath = path.join(dir, prefix + fileName + '.sql')
      if (contents) {
        contents = tools.sqlFormat(contents)
        fs.writeFileSync(filePath, contents)
      } else {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      }
    }
    theone.log.info(`[${dbName}]数据库结构导出完成。。。`)
  }

  //比较本地定义的表结构 与数据库表结构差异, 通过差异写 upgrade 使数据与本地一致  如果完全返回 undefined
  async getStructsDiff(dbName, dir, prefix = '') {
    let oldData = this.loadTablesFromDir(dir, prefix)
    let structs = await this.getTableStructs(dbName)
    let contents = ''
    for (const tableName in structs) {
      contents += structs[tableName] + '\n'
    }
    let newData = await this.loadTablesFromString(contents)
    return this.getDiffInfo(oldData, newData)
  }

  async getTableStructs(dbName) {
    let theone = this.theone
    let structs = {}
    let options = theone.config.databaseMap[dbName]
    let colName = 'Tables_in_' + options.database
    await theone.Db.transaction(async  db => {
      let tables = await db.query('SHOW TABLES')
      for (const row of tables) {
        let tableName = row[colName]
        let createSql = (await db.queryOne(
          'SHOW CREATE TABLE ' + tableName
        ))['Create Table']
        let warnRows = this.checkNotNull(createSql)
        for (const warnRow of warnRows) {
          theone.log.warn('没有指定 NOT NULL 的字段: ' + warnRow)
        }
        structs[tableName] = createSql + ';'
      }
    }, options)
    return structs
  }

  async createTable(dbName, tableName) {
    let theone = this.theone
    let options = theone.config.databaseMap[dbName]
    await theone.Db.transaction(async  db => {
      await db.query(
        `CREATE TABLE IF NOT EXISTS ${tableName} (
          u_uId bigint(20) unsigned NOT NULL AUTO_INCREMENT,
          u_sVersion varchar(255) NOT NULL,
          u_sName varchar(255) NOT NULL,
          u_dtTime datetime NOT NULL DEFAULT NOW(),
          u_uStatus tinyint unsigned NOT NULL DEFAULT 0 COMMENT '0未完成， 1：完成',
          u_uDetail varchar(10000) NOT NULL DEFAULT '',
          u_sError varchar(10000) NOT NULL DEFAULT '',
          PRIMARY KEY (u_uId),
          UNIQUE KEY (u_sVersion, u_sName)
        ) ENGINE=InnoDB DEFAULT CHARSET = utf8;`
      )
      await db.query(
        `CREATE TABLE IF NOT EXISTS ${tableName + '_lock'} (
          ul_uId int unsigned NOT NULL,
          PRIMARY KEY (ul_uId)
        ) ENGINE=InnoDB`
      )
    }, options)
  }

  async getVersionInfo(db, tableName) {
    let rt = await db.query(
      `SELECT u_sVersion, u_sName, u_uStatus FROM ${tableName}`
    )
    let data = {}
    for (const row of rt) {
      let v = row.u_sVersion
      if (!data[v]) data[v] = {}
      data[v][row.u_sName.trim()] = row.u_uStatus
    }
    let versions = Object.keys(data).sort((a, b) => -compareVersions(a, b))
    return { data, maxVersion: versions[0] }
  }

  //返回排好序的 UpgradeData
  getUpgradeData(dir, dbName) {
    let all = requireAll(dir)
    let upgradeData = []
    for (const version in all) {
      let set = new Set()
      let upgrade = all[version]
      for (let [name, funcs] of upgrade) {
        name = name.trim()
        if (typeof funcs == 'string') {
          funcs = funcs.split(';').map(s => s.trim()).filter(s => s != '')
          if (funcs.length == 1) funcs = funcs[0]
        }
        if (Array.isArray(funcs)) {
          let old = name
          for (let i = 0; i < funcs.length; i++) {
            if (i > 0) name = `${old} [${i}]`   //为了允许末尾追加语句, 0号不加下标, (注: 只允许末尾追加) 
            assert(!set.has(name), `[${dbName}]版本升级重名:${name}`)
            set.add(name)
            upgradeData.push({ version, name, func: funcs[i] })
          }
        } else {
          assert(!set.has(name), `[${dbName}]版本升级重名:${name}`)
          set.add(name)
          upgradeData.push({ version, name, func: funcs })
        }
      }
    }
    upgradeData.sort((a, b) => compareVersions(a.version, b.version))
    return upgradeData
  }

  async upgrade(dbName, dir, prefix = 'theone') {
    let theone = this.theone
    theone.log.info(`[${dbName}]版本升级中。。。`)
    if (prefix && !prefix.endsWith('_')) prefix = prefix + '_'
    let tableName = prefix + 'upgrade'
    let upgradeData = this.getUpgradeData(dir, dbName)
    let count = 0
    let options = theone.config.databaseMap[dbName]
    await this.createTable(dbName, tableName)
    await theone.Db.transaction(async  db => {
      //加锁 防止多进程部署时候同时执行
      await db.query(
        `REPLACE INTO ${tableName + '_lock'}(ul_uId) VALUES(?)`, [1]
      )
      let { data, maxVersion } = await this.getVersionInfo(db, tableName)
      for (const { version, name, func } of upgradeData) {
        if (data[version] && data[version][name] == 1) continue//已经执行
        if (maxVersion && compareVersions(version, maxVersion) < 0) {
          throw new Error(`!! 之前已经更新到${maxVersion}, 但 ${version} 中 ${name} 未执行过, 不应该在历史版本中添加新的 upgrade`)
        }
        await this.doUpgrade(tableName, version, options, name, func)
        count++
      }
    }, options)
    theone.log.info(`[${dbName}]版本升级完成！！`)
    return count
  }

  async doUpgrade(tableName, version, options, name, func) {
    await theone.Db.transaction(async (db) => {
      await db.execute(
        `REPLACE INTO ${tableName}(u_sVersion, u_sName, u_uDetail) VALUES(?,?,?)`, [version, name, func.toString()]
      )
    }, options)

    try {
      if (typeof func == 'string') {
        await theone.Db.transaction(async  db => db.query(func), options)
      } else {
        await theone.Db.transaction(async  db => {
          db.execute = (async function (...args) {
            theone.log.warn(`不建议在 upgrade 中使用 execute 与 executeOne 方法, 已经为你切换为 query  :${name}`)
            return db.query(...args)
          })
          db.executeOne = async function (...args) {
            theone.log.warn(`不建议在 upgrade 中使用 execute 与 executeOne 方法, 已经为你切换为 queryOne  :${name}`)
            return db.queryOne(...args)
          }
          await func(db)
        }, options)
      }
    } catch (e) {
      await theone.Db.transaction(async (db) => {
        await db.query(
          `UPDATE ${tableName} SET u_sError = ? WHERE u_sVersion =? AND u_sName = ?`,
          [e.toString(), version, name]
        )
      }, options)
      throw new Error(`版本升级失败！！  ${version}【${name}】  msg:` + e.toString())
    }
    await theone.Db.transaction(async (db) => {
      await db.query(
        `UPDATE ${tableName} SET u_uStatus = 1, u_sError = "" WHERE u_sVersion =? AND u_sName = ?`,
        [version, name]
      )
    }, options)
  }


  loadTablesFromDir(dir, prefix) {
    let files = fs.readdirSync(dir)
    let data = {}
    for (const file of files) {
      if (!(file.endsWith('.sql') && file.startsWith(prefix))) continue
      let filePath = path.join(dir, file)
      let stat = fs.statSync(filePath)
      if (stat.isFile()) {
        let content = fs.readFileSync(filePath, 'utf8')
        content = tools.sqlFormat(content)
        for (let createSql of content.split(';\n')) {
          if (createSql == '') continue
          if (!createSql.endsWith(';')) createSql += ';'
          let { tableName, rows } = tools.parseCreateSql(createSql)
          if (data[tableName]) throw new Error(`重复的 table: ${tableName}  file:${file}`)
          data[tableName] = rows
        }
      }
    }
    return data
  }

  loadTablesFromString(content) {
    let data = {}
    content = tools.sqlFormat(content)
    let tables = content.split(';\n')
    for (let createSql of tables) {
      if (createSql == '') continue
      if (!createSql.endsWith(';')) createSql += ';'
      let { tableName, rows } = tools.parseCreateSql(createSql)
      if (data[tableName]) throw new Error(`重复的 table: ${tableName}  file:${file}`)
      data[tableName] = rows
    }
    return data
  }

  getDiffInfo(lhs, rhs) {
    let diffData = diff(lhs, rhs)
    if (!diffData) return
    let tableName = null
    let info = []
    for (const data of diffData) {
      if (tableName != data.path[0]) {
        tableName = data.path[0]
        info.push('', `[${tableName}]`)
      }
      if (data.lhs) {
        if (Array.isArray(data.lhs)) {
          info.push(...data.lhs.map(row => '  - ' + row))
        } else {
          info.push('  - ' + data.lhs)
        }
      }
      if (data.rhs) {
        if (Array.isArray(data.rhs)) {
          info.push(...data.rhs.map(row => '  + ' + row))
        } else {
          info.push('  + ' + data.rhs)
        }
      }
      info.push('')
    }
    return info
  }
}

module.exports = function (theone) {
  return new Upgrade(theone)
}
