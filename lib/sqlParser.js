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
  parseCreateSql(createSql, parts = ['options', 'columns', 'keys']) {
    let partsSet = new Set(parts)
    createSql = this.formatCreateSql(createSql).trim()
    let rows = createSql.split('\n')
    if (!rows[0].startsWith('CREATE TABLE')
      || !rows[rows.length - 1].startsWith(') ENGINE=')) {
      throw new Error('格式错误 参考 SHOW CREATE TABLE 格式: ' + createSql)
    }
    let header = this.parseCreateSqlHeader(rows[0])
    let options = partsSet.has('options') ? this.parseCreateSqlOptions(rows[rows.length - 1]) : undefined
    let columns = partsSet.has('columns') ? {} : undefined
    let keys = partsSet.has('keys') ? {} : undefined

    if (!columns && !keys) return { ...header, options, columns, keys }

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
      } else {
        if (!partsSet.has('keys')) break
        let info = this.parseCreateSqlKey(row)
        assert(!keys[info.name])
        keys[info.name] = info
      }
    }
    return { tableName: header.tableName, sql: createSql, header, options, columns, keys }
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
    let results = sql.match(/^((\w+) )?KEY( `(\w+)`)? \((.+)\)/)
    if (results) {
      let info = {
        sql,
        type: results[2] ? results[2].toLowerCase() + 'Key' : 'key',
        columns: results[5].split(',').map(col => col.trim().slice(1, -1))
      }
      info.name = results[4] || info.type
      return info
    }
    results = sql.match(/^CONSTRAINT `(\w+)` FOREIGN KEY \((.+)\) REFERENCES `(\w+)` \((.+)\)/)
    if (results) {
      return {
        sql,
        type: 'foreignKey',
        name: results[1],
        columns: results[2].split(',').map(col => col.trim().slice(1, -1)),
        tableName: results[3],
        refColumns: results[4].split(',').map(col => col.trim().slice(1, -1))
      }
    }
    throw new Error(`暂未支持的key, 或非规范语法,请参考 SHOW CREATE TABLE.\n"${sql}"`)
  },

  parseCreateSqlColumn(sql, lastColumn) {
    if (sql.endsWith(',')) sql = sql.slice(0, -1)
    let results = sql.match(/^`(\w+)` (\w+)(\(.*\))?/)

    let info = {
      sql,
      defi: sql.slice(results[1].length + 3),
      name: results[1],
      dataType: results[2],
      pos: 0,
      pre: null,
      next: null
    }
    if (util.findByQuote(sql, /\bNOT NULL\b/i, { type: 'out' }).length > 0) {
      info.notNull = true
    }
    if (results[3]) info.dataTypeOpts = results[3]
    let comment = util.findByQuote(sql, /\bCOMMENT\s+/i, { type: 'out' })
    if (comment.length > 0) {
      let tail = sql.slice(comment[0].splitItem.end)
      let items = util.splitByQuote(tail)
      if (!items[0].char) throw new Error('语法错误，未找到 COMMENT内容:\n' + sql)
      info.comment = items[0].str.slice(1, -1)
    }

    // null: 代表 first
    if (lastColumn) {
      info.pos = lastColumn.pos + 1
      info.pre = lastColumn
      lastColumn.next = info
    }
    return info
  },

  getCreateRowType(row) {
    let results = util.findByQuote(row, /\bKEY\b/, { type: 'out' })
    if (results.length > 0) {
      return 'key'
    } else {
      return 'column'
    }
  },

  //获取 content 中所有表名
  parseTableNames(content) {
    let reg = /\bCREATE\s+TABLE\s*[\s`]{1}(\w+)[\s`]{1}/i
    let results = content.match(reg)
    if (results) return results[1]
  },

}