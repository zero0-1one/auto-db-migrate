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
  'blob': ['tinyblob', 'blob', 'mediumblob', 'longblob'],
  'date': ['date', 'time', 'year', 'datetime', 'timestamp'],
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
    let { dataType, name, defi, pre, next } = column
    let group = DATATYPE_TO_GROUP[dataType]
    if (group === undefined) return null

    let simiColumn = null
    let maxSimi = this.simiThreshold
    for (const colName in others) {
      let other = others[colName]
      if (group != DATATYPE_TO_GROUP[other.dataType]) continue

      let simiArray = []
      simiArray.push({ weight: 1, value: similarity(defi, other.defi) })
      simiArray.push({ weight: 0.4, value: similarity(name, colName) })
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
    let _curTables = Object.assign({}, curTables)
    let _tgtTables = Object.assign({}, tgtTables)
    this.removeSameTables(_curTables, _tgtTables)
    await this.initTempDbByTables(tempDb, _curTables)
    let migration = []
    await this._sync(tempDb, _tgtTables, 'TableBefore', migration)
    await this._sync(tempDb, _tgtTables, 'Option', migration)
    // Column 与 Key 相互依赖,为简化算法,采用是在维度采用试错算法
    for (let i = 0; i < this.maxTry; i++) {
      let colSucceed = await this._sync(tempDb, _tgtTables, 'Column', migration, true)
      let keySucceed = await this._sync(tempDb, _tgtTables, 'Key', migration, true)
      if (colSucceed && keySucceed) break
    }
    await this._sync(tempDb, _tgtTables, 'TableAfter', migration)

    let results = { migration, sign }
    let newTgtTables = await this.getCreateTablesByDb(tempDb)
    let diffData = this.diffByCreateTables(newTgtTables, _tgtTables)
    results.succeed = diffData.diffNum == 0
    if (!results.succeed) {
      results.diffData = diffData
    }
    return results
  }

  async _sync(tempDb, tgtTables, type, outMigration, ignoreError = false) {
    let curTables = await this.getCreateTablesByDb(tempDb)
    let diffData = this.diffByCreateTables(curTables, tgtTables)
    let migration = []
    this.callGetMigration(type, diffData, migration)
    let { succeed, failed, msg } = await this._doMigration(tempDb, migration, ignoreError)
    outMigration.push(...succeed)
    if (!ignoreError && failed.length > 0) throw new Error(msg[0])
    return failed.length == 0
  }

  callGetMigration(type, diffData, outMigration) {
    switch (type) {
      case 'TableBefore':
        return this.getTableBeforeMigration(diffData, outMigration)
      case 'TableAfter':
        return this.getTableAfterMigration(diffData, outMigration)
      case 'Option':
        return this.getOptionMigration(diffData, outMigration)
      case 'Column':
        return this.getColumnMigration(diffData, outMigration)
      case 'Key':
        return this.getKeyMigration(diffData, outMigration)
      default:
        throw new Error('错误的类型: ' + type)
    }
  }

  getTableBeforeMigration(diffData, outMigration) {
    let { delTables, changeTables } = diffData
    this.getMigrationSql_delTables(delTables, outMigration)
    this.getMigrationSql_renameTables(changeTables, outMigration)
  }

  getTableAfterMigration(diffData, outMigration) {
    this.getMigrationSql_addTables(diffData.addTables, outMigration)
  }

  getOptionMigration(diffData, outMigration) {
    for (const { cur, tgt } of diffData.changeTables) {
      assert(cur.name == tgt.name)
      let curInfo = sqlParser.parseCreateSql(cur.sql, ['options'])
      let tgtInfo = sqlParser.parseCreateSql(tgt.sql, ['options'])
      if (curInfo.options.sql != tgtInfo.options.sql) {
        if (curInfo.options['COMMENT'] && !tgtInfo.options['COMMENT']) {
          //删除主注释
          outMigration.push(`ALTER TABLE ${ID(cur.name)} ${tgtInfo.options.sql} COMMENT=""`)
        } else {
          outMigration.push(`ALTER TABLE ${ID(cur.name)} ${tgtInfo.options.sql}`)
        }
      }
    }
  }

  getColumnMigration(diffData, outMigration) {
    for (const { cur, tgt } of diffData.changeTables) {
      assert(cur.name == tgt.name)
      let curInfo = sqlParser.parseCreateSql(cur.sql, ['columns', 'keys'])
      let tgtInfo = sqlParser.parseCreateSql(tgt.sql, ['columns'])
      this.getMigrationSql_columns(tgt.name, curInfo, tgtInfo.columns, outMigration)
    }
  }

  getKeyMigration(diffData, outMigration) {
    for (const { cur, tgt } of diffData.changeTables) {
      assert(cur.name == tgt.name)
      let curInfo = sqlParser.parseCreateSql(cur.sql, ['keys'])
      let tgtInfo = sqlParser.parseCreateSql(tgt.sql, ['keys'])
      this.getMigrationSql_keys(tgt.name, curInfo.keys, tgtInfo.keys, outMigration)
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
    let { columns: curColumns, keys: curKeys } = curInfo
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
      let info = delColumns[colName]
      //表内外键约束检测 (表外已经通过 'SET FOREIGN_KEY_CHECKS = 1' 忽略了)
      for (const keyName in curKeys) {
        let key = curKeys[keyName]
        if (key.type != 'foreignKey' || key.isDrop) continue
        if (key.columns.includes(key)) {
          this.getAlterSql_delKey(tableName, key, outMigration)
        }
      }
      this.getAlterSql_delColumn(tableName, info, outMigration)
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
      if (oldInfo.type == 'foreignKey') continue
      for (const newKeyName in addKeys) {
        let newInfo = addKeys[newKeyName]
        if (oldInfo.sql.replace(oldKeyName, newKeyName) == newInfo.sql) {
          renameKeys[oldKeyName] = newKeyName
          delete delKeys[oldKeyName]
          delete addKeys[newKeyName]
        }
      }
    }

    let beforeIndex = outMigration.length
    //先处理 foreignKey 删除, 再删除普通 key
    this._dropKey(tableName, delKeys, changeKeys, type => type == 'foreignKey', outMigration)
    this._dropKey(tableName, delKeys, changeKeys, type => type != 'foreignKey', outMigration)

    for (const oldKeyName in renameKeys) {
      this.getAlterSql_renameKey(tableName, oldKeyName, renameKeys[oldKeyName], outMigration)
    }

    for (const { cur, tgt } of changeKeys) {
      this.getAlterSql_addKey(tableName, tgt, outMigration)
    }
    for (const keyName in addKeys) {
      this.getAlterSql_addKey(tableName, addKeys[keyName], outMigration)
    }
    //外键约束检测, 删key后导致外键无可用key,导致失败, 需要先删除外键, 然后恢复
    for (const keyName in curKeys) {
      let { isDrop, type, columns } = curKeys[keyName]
      if (isDrop || type != 'foreignKey') continue
      if (!this._findCanUsedKey(curKeys, columns)) {
        let temp = []
        this.getAlterSql_delKey(tableName, curKeys[keyName], temp)
        outMigration.splice(beforeIndex, 0, temp[0])
        this.getAlterSql_addKey(tableName, curKeys[keyName], outMigration)
      }
    }
  }

  _dropKey(tableName, delKeys, changeKeys, check = () => true, outMigration) {
    for (const keyName in delKeys) {
      let info = delKeys[keyName]
      if (check(info.type)) this.getAlterSql_delKey(tableName, info, outMigration)
    }
    for (const { cur, tgt } of changeKeys) {
      if (check(cur.type)) this.getAlterSql_delKey(tableName, cur, outMigration)
    }
  }

  getAlterSql_delKey(tableName, info, outMigration) {
    if (info.isDrop) return
    info.isDrop = true
    if (info.type == 'primaryKey') {
      outMigration.push(`ALTER TABLE ${ID(tableName)} DROP PRIMARY KEY`)
    } else if (info.type == 'uniqueKey' || info.type == 'key') {
      outMigration.push(`ALTER TABLE ${ID(tableName)} DROP KEY ${ID(info.name)}`)
    } else if (info.type == 'foreignKey') {
      outMigration.push(`ALTER TABLE ${ID(tableName)} DROP FOREIGN KEY ${ID(info.name)}`)
    } else {
      throw new Error('目前不支持的 key 类型: ' + info.type)
    }
  }

  getAlterSql_addKey(tableName, info, outMigration) {
    if (info.isAdd) return
    info.idAdd = true
    outMigration.push(`ALTER TABLE ${ID(tableName)} ADD ${info.sql}`)
  }

  getAlterSql_renameKey(tableName, oldName, newName, outMigration) {
    outMigration.push(`ALTER TABLE ${ID(tableName)} RENAME KEY ${ID(oldName)} TO ${ID(newName)}`)
  }

  getAlterSql_delColumn(tableName, info, outMigration) {
    outMigration.push(`ALTER TABLE ${ID(tableName)} DROP COLUMN ${ID(info.name)}`)
  }

  getAlterSql_addColumn(tableName, info, afterCol, outMigration) {
    if (afterCol) {
      outMigration.push(`ALTER TABLE ${ID(tableName)} ADD COLUMN ${info.sql} AFTER ${ID(afterCol.name)}`)
    } else {
      outMigration.push(`ALTER TABLE ${ID(tableName)} ADD COLUMN ${info.sql} FIRST`)
    }
  }

  getAlterSql_changeColumn(tableName, info, afterCol, outMigration) {
    let sql = ''
    if (info.oldName && info.oldName != info.name) {
      sql = `ALTER TABLE ${ID(tableName)} CHANGE COLUMN ${ID(info.oldName)} ${info.sql}`
    } else {
      sql = `ALTER TABLE ${ID(tableName)} MODIFY COLUMN ${info.sql}`
    }
    sql = sql + (afterCol ? ` AFTER ${ID(afterCol.name)}` : ' FIRST')
    outMigration.push(sql)
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
        for (const sql of migration) {
          try {
            let rt = await db.query(sql)
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
    let { failed, msg, sign } = await this._doMigration(db, migration)
    if (failed.length > 0) throw new Error(msg[0])
    return sign
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
      tableInfos[tableName] = sqlParser.parseCreateSql(createTables[tableName], ['keys'])
    }
    for (const tableName in tableInfos) {
      let keys = tableInfos[tableName].keys
      for (const keyName in keys) {
        let keyInfo = keys[keyName]
        if (keyInfo.type != 'foreignKey') continue
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
      let { type, columns, isDrop } = info.keys[keyName]
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

  //检测表内是否有 外键可用 key
  _findCanUsedKey(keys, fkColumns) {
    for (const keyName in keys) {
      let { type, columns, isDrop } = keys[keyName]
      if (isDrop) continue
      if (type != 'foreignKey') {
        let canUsed = true
        for (let i = 0; i < fkColumns.length; i++) {
          if (columns[i] != fkColumns[i]) {
            canUsed = false
            break
          }
        }
        if (canUsed) return keyName
      }
    }
  }
}
