'use strict'
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const createSqlParser = require('./createSqlParser')
const util = require('./util')
const crypto = require('crypto')
const similarity = require('string-similarity').compareTwoStrings

let ID = name => '`' + name + '`'
let COLS = cols => cols.map(c => ID(c)).join(',')
// 非分组内的类型 认为是不同的列(非重命名)
let GROUP_TO_DATATYPE = {
  'int': ['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'float', 'double', 'decimal'],
  'str': ['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext'],
  'blob': ['tinyblob', 'blob', 'mediumblob', 'longblob'],
  'date': ['date', 'time', 'year', 'datetime', 'timestamp']
}

let DATATYPE_TO_GROUP = {}
for (const group in GROUP_TO_DATATYPE) {
  for (const dataType of GROUP_TO_DATATYPE[group]) {
    DATATYPE_TO_GROUP[dataType] = group
  }
}

module.exports = {
  simiThreshold: 0.7,

  setSimiThreshold(value) {
    this.simiThreshold = value
  },

  getTableGroup(dir, prefix = '') {
    let group = {}
    let files = fs.readdirSync(dir)
    for (const file of files) {
      if (!(file.endsWith('.sql') && file.startsWith(prefix))) continue
      let filePath = path.join(dir, file)
      let stat = fs.statSync(filePath)
      if (stat.isFile()) {
        let content = fs.readFileSync(filePath, 'utf8')
        let groupName = file.slice(prefix.length, -4)
        group[groupName] = createSqlParser.parseTableNames(content)
      }
    }
    return group
  },


  async getTableSchemas(db, tables) {
    let isArray = Array.isArray(tables)
    if (!isArray) tables = [tables]
    let schemas = {}
    for (const tableName of tables) {
      //todo:
    }
    return isArray ? schemas : schemas[tables[0]]
  },

  async dataBaseDiff(curDb, tgtDb) {
    let cur = await this.getCreateTables(curDb)
    let tgt = await this.getCreateTables(tgtDb)
    return this.diffByCreateTables(cur, tgt)
  },

  // cur, tgt是通过 getCreateTables 获得的数据
  diffByCreateTables(curTables, tgtTables) {
    let addTables = {}
    let delTables = {}
    let sameTables = {}
    let changeTables = []
    for (const tableName in curTables) {
      if (!tgtTables.hasOwnProperty(tableName)) {
        delTables[tableName] = curTables[tableName]
      } else if (curTables != tgtTables[tableName]) {
        changeTables.push({
          cur: { name: tableName, sql: curTables[tableName] },
          tgt: { name: tableName, sql: tgtTables[tableName] },
        })
      } else {
        sameTables[tableName] = curTables[tableName]
      }
    }
    for (const tableName in tgtTables) {
      if (!curTables.hasOwnProperty(tableName)) addTables[tableName] = tgtTables[tableName]
    }

    this.adjustRenameTables(delTables, addTables, changeTables)
    return { addTables, delTables, changeTables, sameTables }
  },

  getMaybeRenameTable(sql, others) {
    let simiTable = null
    let maxSimi = this.simiThreshold
    for (const tableName in others) {
      let simi = similarity(sql, others[tableName])
      if (simi > maxSimi) {
        simiTable = tableName
        maxSimi = simi
      }
    }
    return simiTable
  },

  //三个参数都惠改变
  adjustRenameTables(delTables, addTables, changeTables) {
    for (const tableName in delTables) {
      let renameTo = this.getMaybeRenameTable(delTables[tableName], addTables)
      if (renameTo) {
        changeTables.push({
          cur: { name: tableName, sql: delTables[tableName] },
          tgt: { name: renameTo, sql: addTables[renameTo] }
        })
        delete delTables[tableName]
        delete addTables[renameTo]
      }
    }
  },

  getMaybeRenameColumn(column, others) {
    let { dataType, defi, pre, next } = column
    let group = DATATYPE_TO_GROUP[dataType]
    if (group === undefined) return null

    let simiColumn = null
    let maxSimi = this.simiThreshold
    for (const colName in others) {
      let other = others[colName]
      if (group != DATATYPE_TO_GROUP[other.dataType]) continue

      let simiArray = []
      simiArray.push({ weight: 1, value: similarity(defi, other.defi) })
      if (pre && other.pre) {
        simiArray.push({ weight: 0.5, value: similarity(pre.defi, other.pre.defi) })
      } else {
        simiArray.push({ weight: 0.4, value: pre === other.pre ? 1 : 0 })
      }
      if (next && other.next) {
        simiArray.push({ weight: 0.5, value: similarity(next.defi, other.next.defi) })
      } else {
        simiArray.push({ weight: 0.4, value: next === next ? 1 : 0 })
      }

      let [sumWeight, sum] = simiArray.reduce((s, v) => [s[0] + v.weight, s[1] + v.weight * v.value], [0, 0])
      let simi = sum / sumWeight
      if (simi > maxSimi) {
        simiColumn = colName
        maxSimi = simi
      }
    }
    return simiColumn
  },

  //三个参数都惠改变
  adjustRenameColumn(delColumns, addColumns, changeFrom) {
    for (const colName in delColumns) {
      let renameTo = this.getMaybeRenameColumn(delColumns[colName], addColumns)
      if (renameTo) {
        changeFrom[renameTo] = colName
        delete delColumns[colName]
        delete addColumns[renameTo]
      }
    }
  },

  //分多个阶段构建迁移命令, 计算过程中 db 不会被改变, tempDb 会被清空重建多次
  //tempDb 的初始状态就是需要的升级到的目标状态, 计算结束 tempDb 会恢复至初始状态
  async createMigration(db, tempDb) {
    await tempDb.checkTempDb()
    let curTables = await this.getCreateTables(db)
    let tgtTables = await this.getCreateTables(tempDb)
    //down 是 up 逆操纵, 交换 cur <=> tgt 后使用 up 相同的方法计算
    //先计算 down 后计算 temp 只是为了使函数调用结束时 tempDb 恢复调用前的状态
    let down = await this.createMigrationFromTables(tempDb, tgtTables, curTables)
    let up = await this.createMigrationFromTables(tempDb, curTables, tgtTables)
    return { up, down }
  },


  async createMigrationFromTables(tempDb, curTables, tgtTables) {
    let tgtSign = this.getTablesSign(tgtTables)
    await this.initTempDbByTables(tempDb, curTables)
    let diffData1 = this.diffByCreateTables(curTables, tgtTables)
    let newTgtTables = Object.assign({}, tgtTables) //拷贝一份 _sync 会去掉相同的 table

    //分批次计算迁移语句, 因为每执行完一个后通过 createTable 计算的 diffData 其他也可能发送变化
    //比如: 外键名不一致, rename table 后,可能就变成一致了
    let [tableMigration, diffData2] = await this._sync(tempDb, diffData1, newTgtTables, 'Table')
    let [optionMigration, diffData3] = await this._sync(tempDb, diffData2, newTgtTables, 'Option')
    let [columnMigration, diffData4] = await this._sync(tempDb, diffData3, newTgtTables, 'Column')
    let [keyMigration] = await this._sync(tempDb, diffData4, newTgtTables, 'Key')

    let curSign = await this.getTablesSignByDb(tempDb)
    assert(tgtSign == curSign, '迁移算法,未能使数据库结构最终状态一致')
    return [...tableMigration, ...optionMigration, ...columnMigration, ...keyMigration]
  },

  async _sync(tempDb, diffData, tgtTables, type) {
    //去掉相同的 table
    for (const tableName in diffData.sameTables) {
      delete tgtTables[tableName]
    }

    let migration = this[`get${type}Migration`](diffData)
    if (migration.length > 0) {
      await this.doMigration(tempDb, migration, 'up')
      let curTables = await this.getCreateTables(tempDb, Object.keys(tgtTables))
      diffData = this.diffByCreateTables(curTables, tgtTables)
      assert(this[`get${type}Migration`](diffData).length == 0, `get${type}Migration 算法有漏洞`)
    }
    return [migration, diffData]
  },

  getTableMigration(diffData) {
    let { addTables, delTables, changeTables } = diffData
    let migration = []
    //先计算 up
    this.getMigrationSql_addTables(addTables, migration)
    this.getMigrationSql_delTables(delTables, migration)
    this.getMigrationSql_renameTables(changeTables, migration)
    return migration
  },

  getOptionMigration(diffData) {
    let migration = []
    for (const { cur, tgt } of diffData.changeTables) {
      assert(cur.name == tgt.name)
      let curInfo = createSqlParser.parseCreateSql(cur.sql, ['options'])
      let tgtInfo = createSqlParser.parseCreateSql(tgt.sql, ['options'])
      if (curInfo.sql != tgtInfo.sql) {
        migration.push(`ALTER TABLE ${ID(cur.name)}  tgtInfo.sql`)
      }
    }
    return migration
  },

  getColumnMigration(diffData) {
    let migration = []
    for (const { cur, tgt } of diffData.changeTables) {
      assert(cur.name == tgt.name)
      let curInfo = createSqlParser.parseCreateSql(cur.sql, ['columns'])
      let tgtInfo = createSqlParser.parseCreateSql(tgt.sql, ['columns'])
      this.getMigrationSql_columns(tgt.name, curInfo.columns, tgtInfo.columns, migration)
    }
    return migration
  },

  getKeyMigration(diffData) {
    let migration = []
    for (const { cur, tgt } of diffData.changeTables) {
      assert(cur.name == tgt.name)
      let curInfo = createSqlParser.parseCreateSql(cur.sql, ['keys'])
      let tgtInfo = createSqlParser.parseCreateSql(tgt.sql, ['keys'])
      this.getMigrationSql_keys(tgt.name, curInfo.keys, tgtInfo.keys, migration)
    }
    return migration
  },


  getMigrationSql_delTables(delTables, outMigration) {
    for (const tableName in delTables) {
      outMigration.push(`DROP TABLE ${ID(tableName)}`)
    }
  },

  getMigrationSql_addTables(addTables, outMigration) {
    for (const tableName in addTables) {
      outMigration.push(addTables[tableName])
    }
  },

  getMigrationSql_renameTables(changeTables, outMigration) {
    for (const { cur, tgt } of changeTables) {
      if (cur.name != tgt.name) {
        outMigration.push(`ALTER TABLE ${ID(cur.name)} RENAME TO ${ID(tgt.name)}`)
      }
    }
  },


  getMigrationSql_columns(tableName, curColumns, tgtColumns, outMigration) {
    let addColumns = {}
    let delColumns = {}
    for (const colName in curColumns) {
      if (!tgtColumns.hasOwnProperty(colName)) delColumns[colName] = curColumns[colName]
    }
    for (const colName in tgtColumns) {
      if (!curColumns.hasOwnProperty(colName)) addColumns[colName] = tgtColumns[colName]
    }

    let changeFrom = {}
    this.adjustRenameColumn(delColumns, addColumns, changeFrom)

    let curOrder = Object.keys(curColumns).sort((a, b) => curColumns[a].pos - curColumns[b].pos)
    for (const colName in delColumns) {
      let node = delColumns[colName]
      outMigration.push(this.getAlterSql_delColumn(tableName, node))
      let index = curOrder.indexOf(colName)
      curOrder.splice(index, 1)
    }

    let tgtOrder = Object.keys(tgtColumns).sort((a, b) => tgtColumns[a].pos - tgtColumns[b].pos)
    for (const colName of tgtOrder) {
      let info = tgtColumns[colName]
      let oldName = changeFrom[colName]
      if (oldName) {
        info.oldName = oldName
        outMigration.push(this.getAlterSql_changeColumn(tableName, info, info.pre))
        let index = curOrder.indexOf(oldName)
        if (index == info.pos) {
          curOrder[index] = colName
        } else {
          curOrder.splice(index, 1)
          curOrder.splice(info.pos, 0, oldName)
        }
      } else if (addColumns[colName]) {
        outMigration.push(this.getAlterSql_addColumn(tableName, info, info.pre))
        curOrder.splice(info.pos, 0, colName)
      } else {
        let index = curOrder.indexOf(colName)
        if (index != info.pos) {
          outMigration.push(this.getAlterSql_changeColumn(tableName, info, info.pre))
          curOrder.splice(index, 1)
          curOrder.splice(info.pos, 0, oldName)
        }
      }
    }

    assert.deepStrictEqual(curOrder, tgtOrder)
  },


  getMigrationSql_keys(tableName, curKeys, tgtKeys, outMigration) {
    let addKeys = {}
    let delKeys = {}
    let changeKeys = []
    let renameKeys = {}
    for (const keyName in curKeys) {
      let cur = curKeys[keyName]
      if (!tgtKeys.hasOwnProperty(keyName)) {
        delKeys[keyName] = cur
      } else if (cur.sql != tgtKeys[keyName].sql) {
        changeKeys.push({ cur, tgt: tgtKeys[keyName] })
      }
    }
    for (const keyName in tgtKeys) {
      if (!curKeys.hasOwnProperty(keyName)) addKeys[keyName] = tgtKeys[keyName]
    }


    for (const oldKeyName in delKeys) {
      let oldInfo = delKeys[oldKeyName]
      for (const newKeyName in addKeys) {
        let newInfo = addKeys[newKeyName]
        if (oldInfo.sql.replace(oldKeyName, newKeyName) == newInfo.sql) {
          renameKeys[oldKeyName] = newKeyName
          delete delKeys[oldKeyName]
          delete addKeys[newKeyName]
        }
      }
    }


    for (const keyName in delKeys) {
      outMigration.push(this.getAlterSql_delKey(tableName, delKeys[keyName]))
    }

    for (const oldKeyName in renameKeys) {
      outMigration.push(this.getAlterSql_renameKey(tableName, oldKeyName, renameKeys[oldKeyName]))
    }

    for (const { cur, tgt } of changeKeys) {
      outMigration.push(this.getAlterSql_delKey(tableName, cur))
      outMigration.push(this.getAlterSql_addKey(tableName, tgt))
    }
    for (const keyName in addKeys) {
      outMigration.push(this.getAlterSql_addKey(tableName, addKeys[keyName]))
    }
  },

  getAlterSql_delKey(tableName, info) {
    if (info.type == 'primaryKey') {
      return `ALTER TABLE ${ID(tableName)} DROP PRIMARY KEY`
    } else if (info.type == 'uniqueKey' || info.type == 'key') {
      return `ALTER TABLE ${ID(tableName)} DROP KEY ${ID(info.name)}`
    } else if (info.type == 'foreignKey') {
      return `ALTER TABLE ${ID(tableName)} DROP FOREIGN KEY ${ID(info.name)}`
    } else {
      throw new Error('目前不支持的 key 类型: ' + info.type)
    }
  },

  getAlterSql_addKey(tableName, info) {
    return `ALTER TABLE ${ID(tableName)} ADD ${info.sql}`
  },

  getAlterSql_renameKey(tableName, oldName, newName) {
    return `ALTER TABLE ${ID(tableName)} RENAME KEY ${ID(oldName)} TO ${ID(newName)}`
  },


  getAlterSql_delColumn(tableName, info) {
    return `ALTER TABLE ${ID(tableName)} DROP COLUMN ${ID(info.name)}`
  },

  getAlterSql_addColumn(tableName, info, afterCol) {
    if (afterCol) {
      return `ALTER TABLE ${ID(tableName)} ADD COLUMN ${info.sql} AFTER ${ID(afterCol.name)}`
    } else {
      return `ALTER TABLE ${ID(tableName)} ADD COLUMN ${info.sql} FIRST`
    }
  },

  getAlterSql_changeColumn(tableName, info, afterCol) {
    let sql = ''
    if (info.oldName == info.name) {
      sql = `ALTER TABLE ${ID(tableName)} MODIFY COLUMN ${info.sql}`
    } else {
      sql = `ALTER TABLE ${ID(tableName)} CHANGE COLUMN ${ID(info.oldName)} ${info.sql}`
    }
    return sql + (afterCol ? ` AFTER ${ID(afterCol.name)}` : ' FIRST')
  },


  async clearTempDataBase(tempDb) {
    await tempDb.checkTempDb()
    let tables = await this.getCreateTables(tempDb)
    await tempDb.offForeignKey(async () => {
      for (const tableName in tables) {
        await tempDb.query(`DROP TABLE ${ID(tableName)}`)
      }
    })
  },

  //通过文件夹内 sql 文件创建数据库  
  async initTempDbByDir(tempDb, dir, prefix = '') {
    await tempDb.checkTempDb()
    await this.clearTempDataBase(tempDb)
    await tempDb.offForeignKey(async () => {
      let files = fs.readdirSync(dir)
      for (const file of files) {
        if (!(file.endsWith('.sql') && file.startsWith(prefix))) continue
        let filePath = path.join(dir, file)
        let content = fs.readFileSync(filePath, 'utf8')
        content = util.removeComment(content)
        let createTables = util.splitOutQuote(content, ';')
        for (let sql of createTables) {
          sql = sql.trim()
          if (sql) await tempDb.query(sql)
        }
      }
    })
  },

  async initTempDbByTables(tempDb, createTables) {
    await tempDb.checkTempDb()
    await this.clearTempDataBase(tempDb)
    await tempDb.offForeignKey(async () => {
      for (let tableName in createTables) {
        let sql = createTables[tableName].trim()
        if (sql) await tempDb.query(sql)
      }
    })
  },

  //通过 clone 数据库结构到另一个数据库 
  async cloneStructToTempDb(db, tempDb) {
    let createTables = await this.getCreateTables(db)
    await this.initTempDbByTables(tempDb, createTables)
  },

  async getDbTables(db) {
    let colName = 'Tables_in_' + db.database
    let rt = await db.query('SHOW TABLES')
    return rt.map(row => row[colName])
  },

  async getCreateTables(db, tables) {
    if (!tables) tables = await this.getDbTables(db)
    let createTables = {}
    let args = tables.map(tableName => `SHOW CREATE TABLE ${ID(tableName)}`)
    let results = await db.batchQuery(args)
    for (const [[data]] of results) {
      createTables[data['Table']] = data['Create Table'] + ';'
    }
    return createTables
  },

  async getTablesSignByDb(db, algorithm = 'sha1') {
    let createTables = await this.getCreateTables(db)
    return this.getTablesSign(createTables, algorithm)
  },

  //通过 createTables 获取签名
  getTablesSign(createTables, algorithm = 'sha1') {
    let tableNames = Object.keys(createTables)
    tableNames.sort()
    let str = ''
    for (const tableName of tableNames) {
      str += createTables[tableName]
    }
    let hash = crypto.createHash('sha1')
    hash.update(str)
    return algorithm + '|' + hash.digest('hex')
  },

  async doMigration(db, migration) {
    if (migration.length == 0) return
    await db.offForeignKey(async () => {
      for (const sql of migration) {
        await db.query(sql)
      }
    })
  },

  async sync(db, migration, type) {
    if (migration[type].length == 0) return
    await this.doMigration(db, migration[type])
  }
}