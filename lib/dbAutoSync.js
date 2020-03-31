'use strict'
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const createSqlParser = require('./createSqlParser')
const util = require('./util')
const crypto = require('crypto')
const similarity = require('string-similarity');

let ID = name => '`' + name + '`'
let COLS = cols => cols.map(c => ID(c)).join(',')

module.exports = {
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

  async dataBaseDiff(currentDb, targetDb) {
    let current = await this.getCreateTables(currentDb)
    let target = await this.getCreateTables(targetDb)
    return this.diffByCreateTables(current, target)
  },

  // current, target是通过 getCreateTables 获得的数据
  diffByCreateTables(currentTables, targetTables) {
    let addTables = {}
    let delTables = {}
    let sameTables = {}
    let diffTables = []
    for (const tableName in currentTables) {
      if (!targetTables.hasOwnProperty(tableName)) {
        delTables[tableName] = currentTables[tableName]
      } else if (currentTables != targetTables[tableName]) {
        diffTables.push({
          current: { name: tableName, sql: currentTables[tableName] },
          target: { name: tableName, sql: targetTables[tableName] },
        })
      } else {
        sameTables[tableName] = currentTables[tableName]
      }
    }
    for (const tableName in targetTables) {
      if (!currentTables.hasOwnProperty(tableName)) addTables[tableName] = targetTables[tableName]
    }

    this.adjustRenameTables(delTables, addTables, diffTables)
    return { addTables, delTables, diffTables, sameTables }
  },

  getMaybeRenameTable(sql, others, threshold = 0.8) {
    let simiTable = null
    let maxSimi = threshold
    for (const tableName in others) {
      let simi = similarity.compareTwoStrings(sql, others[tableName])
      if (simi > maxSimi) {
        simiTable = tableName
      }
    }
    return simiTable
  },

  //三个参数都惠改变
  adjustRenameTables(delTables, addTables, diffTables) {
    let renameTables = []
    for (const tableName in delTables) {
      let simiTableName = this.getMaybeRenameTable(delTables[tableName], addTables)
      if (simiTableName) {
        renameTables.push({
          current: { name: [tableName], sql: delTables[tableName] },
          target: { name: simiTableName, sql: addTables[simiTableName] }
        })
        delete delTables[tableName]
        delete addTables[simiTableName]
      }
    }
    diffTables.push(...renameTables)
    return renameTables
  },

  getMaybeRenameColumn(column, others) {
    for (const other in others) {
      if (column.pre == other.pre || column.next == other.next) {
        simiTable = tableName
      }
    }
    return simiTable
  },
  //三个参数都惠改变
  adjustRenameColumn(delColumns, addColumns, diffColumns) {
    let renameColumns = []
    for (const colName in delColumns) {
      let simiTableName = this.getMaybeRenameColumn(delColumns[colName], addColumns)
      if (simiTableName) {
        renameColumns.push({
          current: { name: [colName], sql: delColumns[colName] },
          target: { name: simiTableName, sql: addColumns[simiTableName] }
        })
        delete delColumns[colName]
        delete addColumns[simiTableName]
      }
    }
    diffColumns.push(...renameColumns)
    return renameColumns
  },

  //分多个阶段构建迁移命令, 计算过程中 db 不会被改变, tempDb 会被清空重建多次
  //tempDb 的初始状态就是需要的升级到的目标状态, 计算结束 tempDb 会恢复至初始状态
  async createMigration(db, tempDb) {
    await tempDb.checkTempDb()
    let currentTables = await this.getCreateTables(db)
    let targetTables = await this.getCreateTables(tempDb)
    //down 是 up 逆操纵, 交换 current <=> target 后使用 up 相同的方法计算
    //先计算 down 后计算 temp 只是为了使函数调用结束时 tempDb 恢复调用前的状态
    let down = await this.createMigrationFromTables(tempDb, targetTables, currentTables)
    let up = await this.createMigrationFromTables(tempDb, currentTables, targetTables)
    return { up, down }
  },


  async createMigrationFromTables(tempDb, currentTables, targetTables) {
    let targetSign = this.getTablesSign(targetTables)
    await this.initTempDbByTables(tempDb, currentTables)
    let diffData1 = this.diffByCreateTables(currentTables, targetTables)
    let newTargetTables = Object.assign({}, targetTables) //拷贝一份 _sync 会去掉相同的 table

    //分批次计算迁移语句, 因为每执行完一个后通过 createTable 计算的 diffData 其他也可能发送变化
    //比如: 外键名不一致, rename table 后,可能就变成一致了
    let [tableMigration, diffData2] = await this._sync(tempDb, diffData1, newTargetTables, 'Table')
    let [optionMigration, diffData3] = await this._sync(tempDb, diffData2, newTargetTables, 'Option')
    let [columnMigration, diffData4] = await this._sync(tempDb, diffData3, newTargetTables, 'Column')
    let [keyMigration] = await this._sync(tempDb, diffData4, newTargetTables, 'Key')

    let currentSign = await this.getTablesSignByDb(tempDb)
    assert(targetSign == currentSign, '迁移算法,未能使数据库结构最终状态一致')
    return [...tableMigration, ...optionMigration, ...columnMigration, ...keyMigration]
  },

  async _sync(tempDb, diffData, targetTables, type) {
    //去掉相同的 table
    for (const tableName in diffData.sameTables) {
      delete targetTables[tableName]
    }

    let migration = this[`get${type}Migration`](diffData)
    if (migration.length > 0) {
      await this.doMigration(tempDb, migration, 'up')
      let currentTables = await this.getCreateTables(tempDb, Object.keys(targetTables))
      diffData = this.diffByCreateTables(currentTables, targetTables)
      assert(this[`get${type}Migration`](diffData).length == 0, `get${type}Migration 算法有漏洞`)
    }
    return [migration, diffData]
  },

  getTableMigration(diffData) {
    let { addTables, delTables, diffTables } = diffData
    let migration = []
    //先计算 up
    this.getMigrationSql_addTables(addTables, migration)
    this.getMigrationSql_delTables(delTables, migration)
    this.getMigrationSql_renameTables(diffTables, migration)
    return migration
  },

  getOptionMigration(diffData) {
    //todo:
    return []
  },

  getColumnMigration(diffData) {
    let migration = []
    for (const { current, target } of diffData.diffTables) {
      assert(current.name == target.name)
      let currentInfo = createSqlParser.parseCreateSql(current.sql)
      let targetInfo = createSqlParser.parseCreateSql(target.sql)
      this.getMigrationSql_columns(target.name, currentInfo.columns, targetInfo.columns, migration)
    }
    return migration
  },

  getKeyMigration(diffData) {
    let migration = []
    for (const { current, target } of diffData.diffTables) {
      assert(current.name == target.name)
      let currentInfo = createSqlParser.parseCreateSql(current.sql)
      let targetInfo = createSqlParser.parseCreateSql(target.sql)
      this.getMigrationSql_keys(target.name, currentInfo.keys, targetInfo.keys, migration)
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

  getMigrationSql_renameTables(diffTables, outMigration) {
    for (const { current, target } of diffTables) {
      if (current.name != target.name) {
        outMigration.push(`ALTER TABLE ${ID(current.name)} RENAME TO ${ID(target.name)}`)
      }
    }
  },

  getMigrationSql_columns(tableName, currentColumns, targetColumns, outMigration) {
    let addColumns = {}
    let delColumns = {}
    let diffColumns = []
    for (const colName in currentColumns) {
      let current = currentColumns[colName]
      let target = targetColumns[colName]
      if (!target) {
        delColumns[colName] = current
      } else if (current.sql != target.sql || current.after != target.after) {
        diffColumns.push({ current, target })
      }
    }
    for (const colName in targetColumns) {
      if (!currentColumns.hasOwnProperty(colName)) addColumns[colName] = targetColumns[colName]
    }

    let targetOrder = Object.keys(targetColumns).map(colName => targetColumns[colName])
    targetOrder.sort((a, b) => a.pos - b.pos)
    for (const info of targetOrder) {

    }


    // for (const colName in delColumns) {
    //   outMigration.push(this.getAlterSql_delColumn(tableName, delKeys[colName]))
    // }
    // for (const { current, target } of diffColumns) {
    //   outMigration.push(this.getAlterSql_changeColumn(tableName, current, target, afterCol))
    // }
    // for (const colName in addColumns) {
    //   outMigration.push(this.getAlterSql_addColumn(tableName, addKeys[colName]))
    // }
  },

  getMigrationSql_keys(tableName, currentKeys, targetKeys, outMigration) {
    let addKeys = {}
    let delKeys = {}
    let diffKeys = []
    for (const keyName in currentKeys) {
      let current = currentKeys[keyName]
      if (!targetKeys.hasOwnProperty(keyName)) {
        delKeys[keyName] = current
      } else if (current.sql != targetKeys[keyName].sql) {
        diffKeys.push({ current, target: targetKeys[keyName] })
      }
    }
    for (const keyName in targetKeys) {
      if (!currentKeys.hasOwnProperty(keyName)) addKeys[keyName] = targetKeys[keyName]
    }

    for (const keyName in delKeys) {
      outMigration.push(this.getAlterSql_delKey(tableName, delKeys[keyName]))
    }
    for (const { current, target } of diffKeys) {
      outMigration.push(this.getAlterSql_delKey(tableName, current))
      outMigration.push(this.getAlterSql_addKey(tableName, target))
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


  getAlterSql_delColumn(tableName, info) {
    return `ALTER TABLE ${ID(tableName)} DROP COLUMN ${ID(info.name)}`
  },

  getAlterSql_addColumn(tableName, info, afterCol) {
    if (afterCol) {
      return `ALTER TABLE ${ID(tableName)} ADD COLUMN ${info.sql} AFTER ${ID(afterCol)}`
    } else {
      return `ALTER TABLE ${ID(tableName)} ADD COLUMN ${info.sql} FIRST`
    }
  },

  getAlterSql_changeColumn(tableName, info) {
    // return `ALTER TABLE ${ID(tableName)} MODIFY COLUMN ${info.sql}`
  },


  async clearTempDataBase(tempDb) {
    await tempDb.checkTempDb()
    let tables = await this.getCreateTables(tempDb)
    await tempDb.offForeignKey(tempDb, async () => {
      for (const tableName in tables) {
        await tempDb.query(`DROP TABLE ${ID(tableName)}`)
      }
    })
  },

  //通过文件夹内 sql 文件创建数据库  
  async initTempDbByDir(tempDb, dir, prefix = '') {
    await tempDb.checkTempDb()
    await this.clearTempDataBase(tempDb)
    await tempDb.offForeignKey(tempDb, async () => {
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
    await tempDb.offForeignKey(tempDb, async () => {
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

  async doMigration(db, migration, ) {
    if (migration.length == 0) return
    await db.offForeignKey(db, async () => {
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