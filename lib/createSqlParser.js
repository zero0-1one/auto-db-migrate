'use strict'
const util = require('./util')
const sqlFormat = require('./sqlFormat')
const assert = require('assert')

//使用标准的 
module.exports = {
  formatCreateSql(sql) {
    return sqlFormat.format(sql, sqlFormat.createRules([
      'compact',
      'uppercase',
      'useCurrent',
      'useKey',
      'referencesOrder',
    ]))
  },

  //createSql 格式标准参考 SHOW CREATE TABLE 格式, 若有差异可能无法得到正确的结构(比如 缺少 `` 包裹, 字符串内不换行而是使用 '\n' 等)
  parseCreateSql(createSql) {
    createSql = this.formatCreateSql(createSql)
    let strings = util.findEnclosedString(createSql, '()')
    if (strings.length != 1) throw new Error('create sql 语法错误,未找到闭合的 body')

    let header = this.parseCreateSqlHeader(createSql.slice(0, strings[0].start - 1))
    let options = this.parseCreateSqlOptions(createSql.slice(strings[0].end + 1))
    let columns = {}
    let keys = {}
    let items = util.splitOutQuote(strings[0].str, ',')
    for (const row of items) {
      let type = this.getCreateRowType(row)
      if (type == 'column') {
        let info = this.parseCreateSqlColumn(row, Object.keys(columns).length)
        assert(!columns[info.name])
        columns[info.name] = info
      } else {
        let info = this.parseCreateSqlKey(row)
        assert(!keys[info.name])
        keys[info.name] = info
      }
    }
    return { ...header, options, columns, keys }
  },

  parseCreateSqlHeader(sql) {
    let results = sql.match(/^CREATE TABLE`(\w+)`$/)
    return { sql, tableName: results[1] }
  },

  parseCreateSqlOptions(sql) {
    //todo:
    return { sql }
  },

  parseCreateSqlKey(sql) {
    let results = sql.match(/^((\w+) )?KEY(`(\w+)`)?\(`(\w+)`\)$/)
    if (results) {
      let info = {
        sql,
        type: results[2] ? results[2].toLowerCase() + 'Key' : 'key',
        columns: results[5].split(',')
      }
      info.name = results[4] || info.type
      return info
    }
    results = sql.match(/^CONSTRAINT`(\w+)`FOREIGN KEY\(`(\w+)`\)REFERENCES`(\w+)`\(`(\w+)`\)/)
    if (results) {
      return {
        sql,
        type: 'foreignKey',
        name: results[1],
        columns: results[2].split(','),
        tableName: results[3],
        refColumns: results[4].split(',')
      }
    }
    throw new Error(`解析key错误非规范语法,请参考 SHOW CREATE TABLE.\n"${sql}"`)
  },

  parseCreateSqlColumn(sql, pos) {
    let results = sql.match(/^`(\w+)`/)
    return { sql, name: results[1], pos }
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
    content = sqlFormat.format(content, ['simple', 'spaceLine0'])
    let reg = /\bCREATE TABLE (\w+) \(/gi
    let results = util.findByQuote(content, reg)
    return results.map(math => math[1])
  },

}