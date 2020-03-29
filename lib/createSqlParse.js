'use strict'
const util = require('./util')
const sqlFormat = require('./sqlFormat')
//使用标准的 
module.exports = {
  safeLv: {
    high: [],
    middle: [],
    low: []
  },

  formatCreateSql(sql) {
    return sqlFormat.format(sql, ['compact'])
  },

  //createSql 格式标准参考 SHOW CREATE TABLE 格式, 若有差异可能无法得到正确的结构(比如 缺少 `` 包裹, 字符串内不换行而是使用 '\n' 等)
  parseCreateSql(createSql) {
    createSql = this.formatCreateSql(createSql)
    let splits = util.splitByQuote(createSql, { type: 'out' }).map(row => row.trim())

    for (const row of rows) {

      let type = this.getCreateRowType(row)
    }
  },

  getColumnAlters(current, target) {

  },

  getKeyAlters(current, target) {

  },

  getOptionsAlters(current, target) {

  },


  getCreateRowType(row) {
    if (row.startsWith('CREATE TABLE')) {
      return 'header'
    } else if (row.match(/(\w+\s+)?(KEY|INDEX)/)) {
      return 'key'
    } else if (row.match(/\)/)) {
      return 'options'
    } else {
      return 'column'
    }
  },

}