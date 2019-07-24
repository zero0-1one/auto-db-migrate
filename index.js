'use strict'

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const requireAll = require('require-all')
const compareVersions = require('compare-versions')


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
        structs[tableName] = (await db.executeOne(
          'SHOW CREATE TABLE ' + tableName
        ))['Create Table']
        if (!groupTables.has(tableName)) group.struct.push(tableName)
      }

      for (const fileName in group) {
        let contents = group[fileName].map(tableName => {
          if (!structs[tableName]) theone.log.console.warn(`[${dbName}]数据库不存在 table:${fileName}`)
          return structs[tableName] || ''
        }).join(';\n\n\n')
        if (contents) {
          fs.writeFileSync(path.join(dir, prefix + fileName + '.sql'), contents)
        } else {
          fs.unlinkSync(path.join(dir, prefix + fileName + '.sql'))
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

    //创建一个 立即commit的 db 连接， 专门用来记录更新日志
    let opts = Object.assign({}, options)
    delete opts['mustInTrans']
    let noTransDb = new theone.Db(opts)
    await noTransDb.execute(
      `CREATE TABLE IF NOT EXISTS ${tableName} (
        u_sVersion varchar(255) NOT NULL,
        u_sName varchar(255) NOT NULL,
        u_dtTime datetime NOT NULL DEFAULT NOW(),
        u_uStatus tinyint unsigned NOT NULL DEFAULT 0,  #--0未完成， 1：完成
        u_sError varchar(20000) NOT NULL DEFAULT '',
        PRIMARY KEY (u_sVersion, u_sName)
      ) ENGINE=InnoDB DEFAULT CHARSET = utf8;`
    )

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
        data[v][row.u_sName] = row.u_uStatus
      }

      for (const [version, upgrade] of upgrades) {
        let set = new Set()
        for (const [name, func, force] of upgrade) {
          assert(!set.has(name), `[${dbName}]版本升级重名:${name}`)
          set.add(name)
          if (data[version] && data[version][name] == 1) continue//已经执行
          if (data[version] && data[version][name] == 0 && !force) {
            throw new Error(`[${dbName}]版本升级失败！！ 上次未完成的动作：${version}【${name}】需处理`)
          }
          await noTransDb.execute(
            `REPLACE INTO ${tableName}(u_sVersion, u_sName) VALUES(?,?)`, [version, name]
          )
          try {
            if (typeof func == 'string') {
              await theone.Db.transaction(async  db => db.execute(func), options)
            } else {
              await theone.Db.transaction(async  db => func(db), options)
            }
          } catch (e) {
            await noTransDb.execute(
              `UPDATE ${tableName} SET u_sError = ? WHERE u_sVersion =? AND u_sName = ?`,
              [e.toString(), version, name]
            )
            throw e
          }
          await noTransDb.execute(
            `UPDATE ${tableName} SET u_uStatus = 1, u_sError = "" WHERE u_sVersion =? AND u_sName = ?`,
            [version, name]
          )
          count++
        }
      }
    }, options).finally(() => {
      noTransDb.release()
    })
    theone.log.info(`[${dbName}]版本升级完成！！`)
    return count
  }
}

module.exports = function (theone) {
  return new Upgrade(theone)
}

