'use strict'

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const requireAll = require('require-all')
const compareVersions = require('compare-versions')

/**
 * 目前只支持 mysql 隔离等级 READ-COMMITTED 
 */
class Upgrade {
  constructor(theone) {
    this.theone = theone
  }

  mkdirs(dirpath) {
    if (fs.existsSync(dirpath)) {
      return
    }
    this.mkdirs(path.dirname(dirpath))
    fs.mkdirSync(dirpath)
  }

  filterCreateSql(sql) {
    sql = sql.replace(/[ ]*AUTO_INCREMENT=[0-9]+/, '')
    return sql
  }

  /**
   * group 定义表接口分类和顺序
   * 如：{
   *  'fileA':['a1', 'a2'],
   *  'fileB':['b1', 'a3'],
   * }
   * a1, a2 表结构就会写入 fileA.sql
   * 如果没定义的表 就会写入 struct.sql
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

    let options = theone.config.databaseMap[dbName]
    let colName = 'Tables_in_' + options.database
    await theone.Db.transaction(async  db => {
      let tables = await db.execute('SHOW TABLES')
      let structs = {}
      for (const row of tables) {
        let tableName = row[colName]
        let createSql = (await db.executeOne(
          'SHOW CREATE TABLE ' + tableName
        ))['Create Table']
        structs[tableName] = this.filterCreateSql(createSql)
        if (!groupTables.has(tableName)) group.struct.push(tableName)
      }

      for (const fileName in group) {
        let contents = group[fileName].map(tableName => {
          if (!structs[tableName]) theone.log.warn(`[${dbName}]数据库不存在 table:${tableName}`)
          return structs[tableName] || ''
        }).join(';\n\n\n')
        let filePath = path.join(dir, prefix + fileName + '.sql')
        if (contents) {
          fs.writeFileSync(filePath, contents + ';')
        } else {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
        }
      }
    }, options)
    theone.log.info(`[${dbName}]数据库结构导出完成。。。`)
  }

  async upgrade(dbName, dir, prefix = 'theone', beginVersion = '') {
    let theone = this.theone
    theone.log.info(`[${dbName}]版本升级中。。。`)
    let tableName = prefix + '_upgrade'
    let all = requireAll(dir)
    let upgrades = []
    for (const version in all) {
      if (beginVersion && compareVersions(version, beginVersion) < 0) continue
      upgrades.push([version, all[version]])
    }
    upgrades.sort((a, b) => compareVersions(a[0], b[0]))
    let options = theone.config.databaseMap[dbName]

    await theone.Db.transaction(async  db => {
      await db.execute(
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
    }, options)

    let count = 0
    await theone.Db.transaction(async  db => {
      //加锁 防止多进程部署时候同时执行
      await db.execute(
        `REPLACE INTO ${tableName}(u_sVersion, u_sName) VALUES(?,?)`, ['0', 'init']
      )
      let rt = await db.execute(
        `SELECT u_sVersion, u_sName, u_uStatus FROM ${tableName}`
      )
      let data = {}
      for (const row of rt) {
        let v = row.u_sVersion
        if (!data[v]) data[v] = {}
        data[v][row.u_sName.trim()] = row.u_uStatus
      }

      for (const [version, upgrade] of upgrades) {
        let set = new Set()
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
              if (data[version] && data[version][name] == 1) continue//已经执行
              await this.doUpgrade(tableName, version, options, name, funcs[i])
            }
          } else {
            assert(!set.has(name), `[${dbName}]版本升级重名:${name}`)
            set.add(name)
            if (data[version] && data[version][name] == 1) continue//已经执行
            await this.doUpgrade(tableName, version, options, name, funcs)
          }
          count++
        }
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
        await theone.Db.transaction(async  db => db.execute(func), options)
      } else {
        await theone.Db.transaction(async  db => func(db), options)
      }
    } catch (e) {
      await theone.Db.transaction(async (db) => {
        await db.execute(
          `UPDATE ${tableName} SET u_sError = ? WHERE u_sVersion =? AND u_sName = ?`,
          [e.toString(), version, name]
        )
      }, options)
      throw new Error(`版本升级失败！！  ${version}【${name}】  msg:` + e.toString())
    }
    await theone.Db.transaction(async (db) => {
      await db.execute(
        `UPDATE ${tableName} SET u_uStatus = 1, u_sError = "" WHERE u_sVersion =? AND u_sName = ?`,
        [version, name]
      )
    }, options)
  }
}

module.exports = function (theone) {
  return new Upgrade(theone)
}

