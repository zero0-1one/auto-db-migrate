'use strict'
const util = require('./util')
const sqlFormat = require('./sqlFormat')
const assert = require('assert')

//使用标准的
module.exports = {
  _formatRules: sqlFormat.createRules(['normal']),

  setFormatRules(rules) {
    if (typeof rules == 'string') rules = [rules]
    this._formatRules = rules ? sqlFormat.createRules(rules) : []
  },

  formatCreateSql(sql) {
    return sqlFormat.format(sql, this._formatRules)
  },

  //createSql 格式标准参考 SHOW CREATE TABLE 格式, 若有差异可能无法得到正确的结构(比如 缺少 `` 包裹,或空格位置, 字符串内不换行而是使用 '\\n' 等)
  parseCreateSql(createSql, parts = ['options', 'columns', 'keys', 'foreignKeys']) {
    let partsSet = new Set(parts)
    createSql = this.formatCreateSql(createSql).trim()
    let rows = createSql.split('\n')
    if (!rows[0].startsWith('CREATE TABLE') || !rows[rows.length - 1].startsWith(') ENGINE=')) {
      throw new Error('格式错误 参考 SHOW CREATE TABLE 格式: ' + createSql)
    }
    let header = this.parseCreateSqlHeader(rows[0])
    let options = partsSet.has('options') ? this.parseCreateSqlOptions(rows[rows.length - 1]) : undefined
    let columns = partsSet.has('columns') ? {} : undefined
    let keys = partsSet.has('keys') ? {} : undefined
    let foreignKeys = partsSet.has('foreignKeys') ? {} : undefined

    if (!columns && !keys && !foreignKeys) return { ...header, options, columns, keys }

    let lastColumn = null
    for (let i = 1; i < rows.length - 1; i++) {
      let row = rows[i].trim()
      let type = this.getCreateRowType(row)
      if (type == 'column') {
        if (!partsSet.has('columns')) continue
        let info = this.parseCreateSqlColumn(row, lastColumn)
        assert(!columns[info.name])
        columns[info.name] = info
        lastColumn = info
      } else if (type == 'key') {
        if (!partsSet.has('keys')) continue
        let info = this.parseCreateSqlKey(row)
        assert(!keys[info.name])
        keys[info.name] = info
      } else {
        if (!partsSet.has('foreignKeys')) continue
        let info = this.parseCreateSqlForeignKey(row)
        assert(!foreignKeys[info.name])
        foreignKeys[info.name] = info
      }
    }
    return { tableName: header.tableName, sql: createSql, header, options, columns, keys, foreignKeys }
  },

  parseCreateSqlHeader(sql) {
    let results = sql.match(/^CREATE TABLE `(\w+)`/)
    return { sql: results[0], tableName: results[1] }
  },

  parseCreateSqlOptions(sql) {
    let end = sql.endsWith(';') ? sql.length - 1 : sql.length
    sql = sql.slice(1, end).trim()
    let items = util.splitOutQuote(sql, ' ')
    let info = { sql }
    let name = ''
    for (const item of items) {
      let subItems = util.splitOutQuote(item, '=')
      name += name ? ' ' + subItems[0] : subItems[0]
      if (subItems.length == 2) {
        info[name] = subItems[1]
        name = ''
      } else if (subItems.length > 2) {
        throw new Error(`暂未支持的options, 或非规范语法,请参考 SHOW CREATE TABLE.\n"${sql}"`)
      }
    }
    return info
  },

  parseCreateSqlKey(sql) {
    if (sql.endsWith(',')) sql = sql.slice(0, -1)
    let results = sql.match(/^((\w+) )?KEY( `(\w+)`)? \((.+)\)(.*)$/)

    if (!results) throw new Error(`暂未支持的key, 或非规范语法,请参考 SHOW CREATE TABLE.\n"${sql}"`)
    const type = results[2] ? results[2].toLowerCase() + 'Key' : 'key'
    let info = {
      sql,
      type: type,
      name: results[4] || type,
      columns: results[5],
    }
    if (results[6].trim().length > 0) {
      info.extended = results[6].trim()
    }
    let { columns, colOrder } = this.parseKeyColumns(info.columns)
    info.columns = columns
    if (colOrder) info.colOrder = colOrder
    return info
  },

  parseKeyColumns(keyColumns) {
    let columns = keyColumns.split(',')
    let colOrder = {}
    columns = columns.map(col => {
      col = col.trim()
      let index = col.lastIndexOf('`')
      let colName = col.slice(1, index)
      if (index != col.length - 1) {
        colOrder[colName] = col
          .slice(index + 1)
          .trim()
          .toUpperCase()
      }
      return colName
    })
    return { columns, colOrder: Object.keys(colOrder).length > 0 ? colOrder : undefined }
  },

  parseCreateSqlForeignKey(sql) {
    if (sql.endsWith(',')) sql = sql.slice(0, -1)
    let results = sql.match(/^CONSTRAINT `(\w+)` FOREIGN KEY \((.+)\) REFERENCES `(\w+)` \((.+)\)/)
    let info
    if (!results) throw new Error(`暂未支持的ForeignKey, 或非规范语法,请参考 SHOW CREATE TABLE.\n"${sql}"`)

    info = {
      sql,
      type: 'foreignKey',
      name: results[1],
      columns: results[2],
      tableName: results[3],
      refColumns: results[4].split(',').map(col => col.trim().slice(1, -1)),
    }
    let { columns, colOrder } = this.parseKeyColumns(info.columns)
    info.columns = columns
    if (colOrder) info.colOrder = colOrder
    return info
  },

  parseCreateSqlColumn(sql, lastColumn) {
    if (sql.endsWith(',')) sql = sql.slice(0, -1)
    let results = sql.match(/^`(\w+)` (\w+)(\(.*\))?/)
    let info = {
      sql,
      name: results[1],
      dataType: results[2],
      pos: 0,
      pre: null,
      next: null,
    }
    if (util.findByQuote(sql, /\bNOT NULL\b/ig, { type: 'out' }).length > 0) {
      info.notNull = true
    }
    if (util.findByQuote(sql, /\bAUTO_INCREMENT\b/ig, { type: 'out' }).length > 0) {
      info.autoIncrement = true
    }
    if (results[3]) info.dataTypeOpts = results[3]
    let comment = util.findByQuote(sql, /\bCOMMENT\s+/ig, { type: 'out' })
    let def = ''
    if (comment.length > 0) {
      let { start, end } = comment[0].splitItem
      let tail = sql.slice(end)
      let items = util.splitByQuote(tail)
      if (!items[0].char) throw new Error('语法错误，未找到 COMMENT内容:\n' + sql)
      info.comment = items[0].str.slice(1, -1)

      def = sql.slice(results[1].length + 3, start + comment[0].index)
    } else {
      def = sql.slice(results[1].length + 3)
    }
    info.def = def //不包含 comment

    // null: 代表 first
    if (lastColumn) {
      info.pos = lastColumn.pos + 1
      info.pre = lastColumn
      lastColumn.next = info
    }
    return info
  },

  getCreateRowType(row) {
    let rt = util.findByQuote(row, /\bKEY\b/g, { type: 'out' })
    if (rt.length > 0) {
      let rt2 = util.findByQuote(row, /\bFOREIGN KEY\b/g, { type: 'out' })
      return rt2.length > 0 ? 'foreignKey' : 'key'
    } else {
      return 'column'
    }
  },

  //获取 content 中所有表名
  parseTableNames(content) {
    let reg = /\bCREATE\s+TABLE\s+`?(\w+)`?\b/i
    let results = content.match(reg)
    if (results) return results[1]
  },

  // table 结构 与 create table key 顺无关, 进行排序比较
  orderKey(createSql) {
    createSql = this.formatCreateSql(createSql).trim()
    let rows = createSql.split('\n')
    if (!rows[0].startsWith('CREATE TABLE') || !rows[rows.length - 1].startsWith(') ENGINE=')) {
      throw new Error('格式错误 参考 SHOW CREATE TABLE 格式: ' + createSql)
    }

    let newRows = []
    newRows.push(rows[0])
    let keyRows = []
    for (let i = 1; i < rows.length - 1; i++) {
      let row = rows[i].trim()
      let type = this.getCreateRowType(row)
      if (type == 'column') {
        newRows.push(rows[i])
      } else {
        keyRows.push(rows[i])
      }
    }
    keyRows = keyRows.sort().map((row, i) => {
      if (i == keyRows.length - 1) {
        return row.replace(/,(\s*)$/, '$1')
      } else {
        return row.replace(/([^,])(\s*)$/, '$1,$2')
      }
    })
    newRows.push(...keyRows)
    newRows.push(rows[rows.length - 1])
    return newRows.join('\n')
  },
}
