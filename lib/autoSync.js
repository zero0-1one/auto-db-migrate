'use strict'
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const sqlParser = require('./sqlParser')
const sqlFormat = require('./sqlFormat')
const util = require('./util')

const similarity = require('string-similarity').compareTwoStrings

let ID = name => '`' + name + '`'
// 非分组内的类型 认为是不同的列(非重命名)
let GROUP_TO_DATATYPE = {
  'int': ['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'float', 'double', 'decimal'],
  'str': ['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext'],
  'binary': ['binary', 'varbinary', 'tinyblob', 'blob', 'mediumblob', 'longblob'],
  'date': ['date', 'time', 'year', 'datetime', 'timestamp'],
  'enum': ['enum'],
  'set': ['set'],
  'bit': ['bit'],
  'boolean': ['boolean'],
  'json': ['json']
}

let DATATYPE_TO_GROUP = {}
for (const group in GROUP_TO_DATATYPE) {
  for (const dataType of GROUP_TO_DATATYPE[group]) {
    DATATYPE_TO_GROUP[dataType] = group
  }
}

module.exports = class autoSync {
  constructor(options = {}) {
    this.simiThreshold = options.simiThreshold || 0.7
    this.maxTry = options.maxTry || 10
    this.tableFilter = options.tableFilter || []
  }

  setSimiThreshold(value) {
    this.simiThreshold = value
  }

  setMaxTry(num = 10) {
    this.maxTry = num
  }

  setTableFilter(tables = []) {
    this.tableFilter = tables
  }

  checkTableFilter(tableName) {
    for (const name of this.tableFilter) {
      if (typeof name == 'string') {
        if (tableName == name) return false
      } else {
        if (tableName.match(name)) return false
      }
    }
    return true
  }

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
        content = util.removeComment(content)
        group[groupName] = []
        let createTables = util.splitOutQuote(content, ';')
        for (let sql of createTables) {
          sql = sql.trim()
          if (!sql) continue
          let tableName = sqlParser.parseTableNames(sql)
          if (tableName) group[groupName].push({ sql: sql + ';', tableName })
        }
      }
    }
    return group
  }

  getCreateTablesByDir(dir, prefix = '') {
    let group = this.getTableGroup(dir, prefix)
    let createTables = {}
    for (const name in group) {
      for (const { sql, tableName } of group[name]) {
        createTables[tableName] = sql
      }
    }
    return createTables
  }

  async getTableSchemas(db, tables) {
    let isArray = Array.isArray(tables)
    if (!isArray) tables = [tables]
    let schemas = {}
    for (const tableName of tables) {
      //todo:
    }
    return isArray ? schemas : schemas[tables[0]]
  }

  async dataBaseDiff(curDb, tgtDb) {
    let cur = await this.getCreateTablesByDb(curDb)
    let tgt = await this.getCreateTablesByDb(tgtDb)
    return this.diffByCreateTables(cur, tgt)
  }

  // cur, tgt是通过 getCreateTablesByDb 获得的数据
  diffByCreateTables(curTables, tgtTables) {
    let addTables = {}
    let delTables = {}
    let changeTables = []

    let _curTables = {}
    let _tgtTables = {}
    for (const tableName in curTables) {
      _curTables[tableName] = sqlParser.orderKey(curTables[tableName])
    }
    for (const tableName in tgtTables) {
      _tgtTables[tableName] = sqlParser.orderKey(tgtTables[tableName])
    }

    for (const tableName in curTables) {
      if (!tgtTables.hasOwnProperty(tableName)) {
        delTables[tableName] = curTables[tableName]
      } else if (_curTables[tableName] != _tgtTables[tableName]) {
        // table 结构 与 key 顺无关
        changeTables.push({
          cur: { name: tableName, sql: curTables[tableName] },
          tgt: { name: tableName, sql: tgtTables[tableName] },
        })
      }
    }
    for (const tableName in tgtTables) {
      if (!curTables.hasOwnProperty(tableName)) addTables[tableName] = tgtTables[tableName]
    }

    this.adjustRenameTables(delTables, addTables, changeTables)
    let diffNum = Object.keys(addTables).length + Object.keys(delTables).length + changeTables.length
    return { addTables, delTables, changeTables, diffNum }
  }

  //两个参数都会被修改
  removeSameTables(curTables, tgtTables) {
    let sameTable = []
    for (const tableName in curTables) {
      if (curTables[tableName] == tgtTables[tableName]) {
        delete curTables[tableName]
        delete tgtTables[tableName]
      }
    }
    return sameTable
  }

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
  }

  //三个参数都惠改变
  adjustRenameTables(delTables, addTables, changeTables) {
    for (const tableName in delTables) {
      let renameTo = this.getMaybeRenameTable(delTables[tableName], addTables)
      if (renameTo) {
        changeTables.push({
          cur: { name: tableName, sql: delTables[tableName] },
          tgt: { name: renameTo, sql: addTables[renameTo] },
        })
        delete delTables[tableName]
        delete addTables[renameTo]
      }
    }
  }

  getMaybeRenameColumn(column, others) {
    let { dataType, name, def, pre, next } = column
    let group = DATATYPE_TO_GROUP[dataType]
    if (group === undefined) return null

    let simiColumn = null
    let maxSimi = this.simiThreshold
    for (const colName in others) {
      let other = others[colName]
      if (group != DATATYPE_TO_GROUP[other.dataType]) continue

      let simiArray = []
      simiArray.push({ weight: 1, value: similarity(def, other.def) })
      simiArray.push({ weight: 0.4, value: similarity(name, colName) })
      if (pre && other.pre) {
        simiArray.push({ weight: 0.5, value: similarity(pre.def, other.pre.def) })
      } else {
        simiArray.push({ weight: 0.4, value: pre === other.pre ? 1 : 0 })
      }
      if (next && other.next) {
        simiArray.push({ weight: 0.5, value: similarity(next.def, other.next.def) })
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
  }

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
  }

  //分多个阶段构建迁移命令, 计算过程中 db 不会被改变, tempDb 会被清空重建多次
  //tempDb 的初始状态就是需要的升级到的目标状态, 计算结束 tempDb 会恢复至初始状态
  async createMigrationByDb(db, tempDb) {
    let curTables = await this.getCreateTablesByDb(db)
    let tgtTables = await this.getCreateTablesByDb(tempDb)
    return this.createMigrationByTables(tempDb, curTables, tgtTables)
  }

  async createMigrationByTables(tempDb, curTables, tgtTables) {
    await tempDb.checkTempDb()
    let sign = {
      begin: this.getTablesSign(curTables),
      end: this.getTablesSign(tgtTables),
    }

    let migration = []

    await this.initTempDbByTables(tempDb, curTables)
    await this._sync(tempDb, tgtTables, 'TableBefore', migration)
    await this._sync(tempDb, tgtTables, 'Option', migration)
    // Column 与 Key 相互依赖,为简化算法,采用试错算法
    for (let i = 0; i < this.maxTry; i++) {
      let colSucceed = await this._sync(tempDb, tgtTables, 'Column', migration, true)
      let keySucceed = await this._sync(tempDb, tgtTables, 'Key', migration, true)
      if (colSucceed && keySucceed) break
    }
    await this._sync(tempDb, tgtTables, 'ForeignKey', migration)
    await this._sync(tempDb, tgtTables, 'TableAfter', migration)

    let results = { migration, sign }
    let newTgtTables = await this.getCreateTablesByDb(tempDb)
    let diffData = this.diffByCreateTables(newTgtTables, tgtTables)
    results.succeed = diffData.diffNum == 0
    if (!results.succeed) {
      results.diffData = diffData
    }
    return results
  }

  //返回数组
  getAllForeignKeys(tables) {
    let allForeignKeys = []
    for (const tableName in tables) {
      let { foreignKeys } = sqlParser.parseCreateSql(tables[tableName], ['foreignKeys'])
      for (const keyName in foreignKeys) {
        foreignKeys[keyName].selfTableName = tableName
        allForeignKeys.push(foreignKeys[keyName])
      }
    }
    return allForeignKeys
  }

  //通过字段 查找与其相关的 外键   (有可能自身是自身的外键，)
  getRefForeignKeysByCol(foreignKeys, tableName, colName) {
    let refForeignKeys = []
    for (const fkInfo of foreignKeys) {
      if (
        (fkInfo.selfTableName == tableName && fkInfo.columns.includes(colName)) ||
        (fkInfo.tableName == tableName && fkInfo.refColumns.includes(colName))
      ) {
        refForeignKeys.push(fkInfo)
      }
    }
    return refForeignKeys
  }

  //通过key 查找与其相关的 外键  (有可能自身是自身的外键，)
  getRefForeignKeysByKey(foreignKeys, tableName, keyColumns) {
    let refForeignKeys = []
    for (const fkInfo of foreignKeys) {
      if (fkInfo.tableName == tableName && util.deepEqual(fkInfo.refColumns, keyColumns)) {
        refForeignKeys.push(fkInfo)
        continue
      }
      if (fkInfo.selfTableName == tableName) {
        for (const col of fkInfo.columns) {
          if (keyColumns.includes(col)) {
            refForeignKeys.push(fkInfo)
            break
          }
        }
      }
    }
    return refForeignKeys
  }

  async delRefForeignKeys(db, item) {
    let tables = await this.getCreateTablesByDb(db)
    let foreignKeys = this.getAllForeignKeys(tables)
    let { type, tableName, info } = item
    let refForeignKeys = null
    if (type == 'delColumn') {
      refForeignKeys = this.getRefForeignKeysByCol(foreignKeys, tableName, info.name)
    } else if (type == 'changeColumn') {
      refForeignKeys = this.getRefForeignKeysByCol(foreignKeys, tableName, info.oldName || info.name)
    } else if ('delKey') {
      refForeignKeys = this.getRefForeignKeysByKey(foreignKeys, tableName, info.columns)
    } else {
      throw new Error('未处理的类型 ' + type)
    }
    let migration = []
    for (const fkInfo of refForeignKeys) {
      this.getAlterSql_delKey(fkInfo.selfTableName, fkInfo, migration)
    }

    for (const sql of migration) {
      await db.query(sql)
    }
    return migration
  }

  async _sync(tempDb, tgtTables, type, outMigration, ignoreError = false) {
    let curTables = await this.getCreateTablesByDb(tempDb)
    let migration = []
    this.callGetMigration(type, { curTables, tgtTables }, migration)
    let { succeed, failed, msg } = await this._doMigration(tempDb, migration, ignoreError)
    outMigration.push(...succeed)
    if (!ignoreError && failed.length > 0) throw new Error(msg[0])
    return failed.length == 0
  }

  callGetMigration(type, tables, outMigration) {
    switch (type) {
      case 'TableBefore':
        return this.getTableBeforeMigration(tables, outMigration)
      case 'TableAfter':
        return this.getTableAfterMigration(tables, outMigration)
      case 'Option':
        return this.getOptionMigration(tables, outMigration)
      case 'Column':
        return this.getColumnMigration(tables, outMigration)
      case 'Key':
        return this.getKeyMigration(tables, outMigration)
      case 'ForeignKey':
        return this.getForeignKeyMigration(tables, outMigration)
      default:
        throw new Error('错误的类型: ' + type)
    }
  }

  getTableBeforeMigration({ curTables, tgtTables }, outMigration) {
    let { delTables, changeTables } = this.diffByCreateTables(curTables, tgtTables)
    this.getMigrationSql_delTables(delTables, outMigration)
    this.getMigrationSql_renameTables(changeTables, outMigration)
  }

  getTableAfterMigration({ curTables, tgtTables }, outMigration) {
    let { addTables } = this.diffByCreateTables(curTables, tgtTables)
    this.getMigrationSql_addTables(addTables, outMigration)
  }

  getOptionMigration({ curTables, tgtTables }, outMigration) {
    let { changeTables } = this.diffByCreateTables(curTables, tgtTables)
    for (const { cur, tgt } of changeTables) {
      let curInfo = sqlParser.parseCreateSql(cur.sql, ['options']).options
      let tgtInfo = sqlParser.parseCreateSql(tgt.sql, ['options']).options
      if (curInfo.sql != tgtInfo.sql) {
        let sql = `ALTER TABLE ${ID(cur.name)} `
        for (const key in tgtInfo) {
          if (key == 'sql') continue
          if (tgtInfo[key] != curInfo[key]) sql += `${key} = ${tgtInfo[key]} `
        }
        for (const key in curInfo) {
          if (key == 'sql') continue
          if (!tgtInfo[key]) sql += `${key} ='' `
        }
        outMigration.push(sql)
      }
    }
  }

  getColumnMigration({ curTables, tgtTables }, outMigration) {
    let { changeTables } = this.diffByCreateTables(curTables, tgtTables)
    for (const { cur, tgt } of changeTables) {
      let curInfo = sqlParser.parseCreateSql(cur.sql, ['columns'])
      let tgtInfo = sqlParser.parseCreateSql(tgt.sql, ['columns'])
      this.getMigrationSql_columns(tgt.name, curInfo, tgtInfo.columns, outMigration)
    }
  }

  getKeyMigration({ curTables, tgtTables }, outMigration) {
    let { changeTables } = this.diffByCreateTables(curTables, tgtTables)
    for (const { cur, tgt } of changeTables) {
      let curInfo = sqlParser.parseCreateSql(cur.sql, ['keys'])
      let tgtInfo = sqlParser.parseCreateSql(tgt.sql, ['keys'])
      this.getMigrationSql_keys(tgt.name, curInfo.keys, tgtInfo.keys, outMigration)
    }
  }

  getForeignKeyMigration({ curTables, tgtTables }, outMigration) {
    let { changeTables } = this.diffByCreateTables(curTables, tgtTables)
    for (const { cur, tgt } of changeTables) {
      let curInfo = sqlParser.parseCreateSql(cur.sql, ['foreignKeys'])
      let tgtInfo = sqlParser.parseCreateSql(tgt.sql, ['foreignKeys'])
      this.getMigrationSql_foreignKeys(tgt.name, curInfo.foreignKeys, tgtInfo.foreignKeys, outMigration)
    }
  }

  getMigrationSql_delTables(delTables, outMigration) {
    for (const tableName in delTables) {
      outMigration.push(`DROP TABLE ${ID(tableName)}`)
    }
  }

  getMigrationSql_addTables(addTables, outMigration) {
    for (const tableName in addTables) {
      outMigration.push(addTables[tableName])
    }
  }

  getMigrationSql_renameTables(changeTables, outMigration) {
    for (const { cur, tgt } of changeTables) {
      if (cur.name != tgt.name) {
        outMigration.push(`ALTER TABLE ${ID(cur.name)} RENAME TO ${ID(tgt.name)}`)
      }
    }
  }

  getMigrationSql_columns(tableName, curInfo, tgtColumns, outMigration) {
    let { columns: curColumns } = curInfo
    let addColumns = {}
    let delColumns = {}
    for (const colName in curColumns) {
      if (!tgtColumns.hasOwnProperty(colName)) {
        delColumns[colName] = curColumns[colName]
      } else if (DATATYPE_TO_GROUP[curColumns[colName].dataType] != DATATYPE_TO_GROUP[tgtColumns[colName].dataType]) {
        delColumns[colName] = curColumns[colName]
        addColumns[colName] = tgtColumns[colName]
      }
      //无需找出 changeColumns 后续算法中会处理
    }
    for (const colName in tgtColumns) {
      if (!curColumns.hasOwnProperty(colName)) {
        addColumns[colName] = tgtColumns[colName]
      }
    }

    let changeFrom = {}
    this.adjustRenameColumn(delColumns, addColumns, changeFrom)

    let curOrder = Object.keys(curColumns).sort((a, b) => curColumns[a].pos - curColumns[b].pos)
    for (const colName in delColumns) {
      this.getAlterSql_delColumn(tableName, delColumns[colName], outMigration)
      let index = curOrder.indexOf(colName)
      curOrder.splice(index, 1)
    }

    let tgtOrder = Object.keys(tgtColumns).sort((a, b) => tgtColumns[a].pos - tgtColumns[b].pos)
    for (const colName of tgtOrder) {
      let info = tgtColumns[colName]
      let oldName = changeFrom[colName]
      if (oldName) {
        info.oldName = oldName
        this.getAlterSql_changeColumn(tableName, info, info.pre, outMigration)
        let index = curOrder.indexOf(oldName)
        if (index == info.pos) {
          curOrder[index] = colName
        } else {
          curOrder.splice(index, 1)
          curOrder.splice(info.pos, 0, colName)
        }
      } else if (addColumns[colName]) {
        this.getAlterSql_addColumn(tableName, info, info.pre, outMigration)
        curOrder.splice(info.pos, 0, colName)
      } else {
        let index = curOrder.indexOf(colName)
        if (index != info.pos) {
          this.getAlterSql_changeColumn(tableName, info, info.pre, outMigration)
          curOrder.splice(index, 1)
          curOrder.splice(info.pos, 0, colName)
        } else if (info.sql != curColumns[colName].sql) {
          this.getAlterSql_changeColumn(tableName, info, info.pre, outMigration)
        }
      }
    }

    assert.deepStrictEqual(curOrder, tgtOrder)
  }

  getMigrationSql_foreignKeys(tableName, curForeignKeys, tgtForeignKeys, outMigration) {
    for (const keyName in curForeignKeys) {
      let cur = curForeignKeys[keyName]
      if (!tgtForeignKeys.hasOwnProperty(keyName)) {
        this.getAlterSql_delKey(tableName, cur, outMigration)
      } else if (cur.sql != tgtForeignKeys[keyName].sql) {
        this.getAlterSql_delKey(tableName, cur, outMigration)
        this.getAlterSql_addKey(tableName, tgtForeignKeys[keyName], outMigration)
      }
    }
    for (const keyName in tgtForeignKeys) {
      if (!curForeignKeys.hasOwnProperty(keyName)) {
        this.getAlterSql_addKey(tableName, tgtForeignKeys[keyName], outMigration)
      }
    }
  }

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
      this.getAlterSql_delKey(tableName, delKeys[keyName], outMigration)
    }
    for (const { cur, tgt } of changeKeys) {
      this.getAlterSql_delKey(tableName, cur, outMigration)
    }

    for (const oldKeyName in renameKeys) {
      this.getAlterSql_renameKey(tableName, oldKeyName, renameKeys[oldKeyName], outMigration)
    }

    for (const { cur, tgt } of changeKeys) {
      this.getAlterSql_addKey(tableName, tgt, outMigration)
    }
    for (const keyName in addKeys) {
      this.getAlterSql_addKey(tableName, addKeys[keyName], outMigration)
    }
  }

  getAlterSql_delKey(tableName, info, outMigration) {
    let sql = ''
    if (info.type == 'primaryKey') {
      sql = `ALTER TABLE ${ID(tableName)} DROP PRIMARY KEY`
    } else if (info.type == 'uniqueKey' || info.type == 'key' || info.type == 'fulltextKey') {
      sql = `ALTER TABLE ${ID(tableName)} DROP KEY ${ID(info.name)}`
    } else if (info.type == 'foreignKey') {
      sql = `ALTER TABLE ${ID(tableName)} DROP FOREIGN KEY ${ID(info.name)}`
    } else {
      throw new Error('目前不支持的 key 类型: ' + info.type)
    }
    if (info.type == 'foreignKey') {
      outMigration.push(sql)
    } else {
      outMigration.push({ type: 'delKey', sql, tableName, info })
    }
  }

  getAlterSql_addKey(tableName, info, outMigration) {
    outMigration.push(`ALTER TABLE ${ID(tableName)} ADD ${info.sql}`)
  }

  getAlterSql_renameKey(tableName, oldName, newName, outMigration) {
    outMigration.push(`ALTER TABLE ${ID(tableName)} RENAME KEY ${ID(oldName)} TO ${ID(newName)}`)
  }

  getAlterSql_delColumn(tableName, info, outMigration) {
    let sql = `ALTER TABLE ${ID(tableName)} DROP COLUMN ${ID(info.name)}`
    outMigration.push({ sql, type: 'delColumn', tableName, info })
  }

  getAlterSql_addColumn(tableName, info, afterCol, outMigration) {
    let sql = ''
    if (afterCol) {
      sql = `ALTER TABLE ${ID(tableName)} ADD COLUMN ${info.sql} AFTER ${ID(afterCol.name)}`
    } else {
      sql = `ALTER TABLE ${ID(tableName)} ADD COLUMN ${info.sql} FIRST`
    }
    if (info.autoIncrement) sql += `, ADD PRIMARY KEY (${info.name})`
    outMigration.push(sql)
  }

  getAlterSql_changeColumn(tableName, info, afterCol, outMigration) {
    let sql = ''
    if (info.oldName && info.oldName != info.name) {
      sql = `ALTER TABLE ${ID(tableName)} CHANGE COLUMN ${ID(info.oldName)} ${info.sql}`
    } else {
      sql = `ALTER TABLE ${ID(tableName)} MODIFY COLUMN ${info.sql}`
    }
    sql = sql + (afterCol ? ` AFTER ${ID(afterCol.name)}` : ' FIRST')
    outMigration.push({ sql, type: 'changeColumn', tableName, info })
  }

  async clearTempDataBase(tempDb) {
    await tempDb.checkTempDb()
    let tableNames = await this.getDbTables(tempDb, false)
    await tempDb.offForeignKey(async () => {
      await tempDb.queryM(tableNames.map(tableName => `DROP TABLE ${ID(tableName)}`))
    })
  }

  //通过文件夹内 sql 文件创建数据库
  async initTempDbByDir(tempDb, dir, prefix = '') {
    await tempDb.checkTempDb()
    await this.clearTempDataBase(tempDb)
    let group = this.getTableGroup(dir, prefix)
    await tempDb.offForeignKey(async () => {
      for (const name in group) {
        for (let { sql } of group[name]) {
          await tempDb.query(sql)
        }
      }
    })
    return group
  }

  async initTempDbByTables(tempDb, createTables) {
    await tempDb.checkTempDb()
    await this.clearTempDataBase(tempDb)
    await tempDb.offForeignKey(async () => {
      let tables = []
      for (let tableName in createTables) {
        tables.push(createTables[tableName])
      }
      await tempDb.queryM(tables)
    })
  }

  //通过 clone 数据库结构到另一个数据库
  async cloneStructToTempDb(db, tempDb) {
    let createTables = await this.getCreateTablesByDb(db)
    await this.initTempDbByTables(tempDb, createTables)
  }

  async getDbTables(db, filter = true) {
    let colName = 'Tables_in_' + db.database
    let rt = await db.query('SHOW TABLES')
    let tableNames = rt.map(row => row[colName])
    if (filter) tableNames = tableNames.filter(name => this.checkTableFilter(name))
    return tableNames
  }

  async getCreateTablesByDb(db, tables) {
    if (!tables) tables = await this.getDbTables(db)
    let createTables = {}
    let args = tables.map(tableName => `SHOW CREATE TABLE ${ID(tableName)}`)
    let results = await db.queryM(args)
    for (const [data] of results) {
      let sql = data['Create Table'] + ';'
      sql = util.removeComment(sql)
      sql = sqlFormat.formatOne(sql, sqlFormat.rules['noAutoIncrement'])
      createTables[data['Table']] = sql
    }
    return createTables
  }

  async getTablesSignByDb(db) {
    let createTables = await this.getCreateTablesByDb(db)
    return this.getTablesSign(createTables)
  }

  //通过 createTables 获取签名
  getTablesSign(createTables) {
    let tableNames = Object.keys(createTables)
    tableNames.sort()
    let str = ''
    for (const tableName of tableNames) {
      str += sqlParser.orderKey(createTables[tableName])
    }
    return util.sha1(str)
  }

  async _doMigration(db, migration, force = false) {
    let succeed = []
    let failed = []
    let msg = []
    if (migration.length > 0) {
      await db.offForeignKey(async () => {
        for (const item of migration) {
          let sql = typeof item == 'string' ? item : item.sql
          try {
            await db.query(sql).catch(async error => {
              if (typeof item == 'string') throw error
              let delForeignKeys = await this.delRefForeignKeys(db, item)
              succeed.push(...delForeignKeys)
              return await db.query(sql) //删除管理外键后重试
            })
            succeed.push(sql)
          } catch (e) {
            failed.push(sql)
            msg.push(e.message)
            if (!force) break
          }
        }
      })
    }
    let sign = await this.getTablesSignByDb(db)
    let unexecuted = migration.slice(succeed.length + 1)
    return { succeed, failed, unexecuted, msg, sign }
  }

  async doMigration(db, migration) {
    if (migration.length > 0) {
      await db.offForeignKey(async () => {
        for (const sql of migration) {
          let rt = await db.query(sql)
        }
      })
    }
    return await this.getTablesSignByDb(db)
  }

  async verifyMigration(tempDb, curTables, migration, sign) {
    await this.initTempDbByTables(tempDb, curTables)
    let newSign = await this.doMigration(tempDb, migration)
    return newSign == sign
  }

  //检测外键是否存在,  迁移过程中使用 SET FOREIGN_KEY_CHECKS = 0,
  //外键不存在也不会报错, 所以需要自行检测下外键约束是否完整.
  checkForeignKey(createTables) {
    let tableInfos = {}
    for (const tableName in createTables) {
      tableInfos[tableName] = sqlParser.parseCreateSql(createTables[tableName], ['keys', 'foreignKeys'])
    }
    for (const tableName in tableInfos) {
      let foreignKeys = tableInfos[tableName].foreignKeys
      for (const keyName in foreignKeys) {
        let keyInfo = foreignKeys[keyName]
        if (!this._checkTableKey(tableInfos[keyInfo.tableName], keyInfo.refColumns)) {
          throw new Error(`Failed to add the foreign key constraint.  [${ID(tableName)} : ${keyInfo.sql}]`)
        }
      }
    }
  }

  //查找外键引用的 可以 是否在对应的表内
  _checkTableKey(info, refColumns) {
    if (!info) return false
    for (const keyName in info.keys) {
      let { type, columns } = info.keys[keyName]
      if (type == 'primaryKey' || type == 'uniqueKey') {
        if (columns.length != refColumns.length) continue
        let isSame = true
        for (let i = 0; i < columns.length; i++) {
          if (columns[i] != refColumns[i]) {
            isSame = false
            break
          }
        }
        if (isSame) return true
      }
    }
    return false
  }
}
