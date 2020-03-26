'use strict'
const sqlFormatter = require("sql-formatter-plus")

module.exports = {
  //查找被 ' 括起来的字符串
  findString(str, c = '\'') {
    let isIn = false
    let isEscape = false
    let start = 0
    let results = []
    for (let i = 0; i < str.length; i++) {
      let c = str[i]
      if (c == '\'' && !isEscape) {
        isIn = !isIn
        if (isIn) {
          start = i
        } else {
          results.push({
            str: str.slice(start, i + 1),
            start
          })
        }
      }
      if (c == '\\' && !isEscape) {
        isEscape = true
      } else {
        isEscape = false
      }
    }
    return results
  },

  replaceInString(str, reg, newSub) {
    let stringData = this.findString(str)
    let lastIndex = 0
    let newStr = ''
    for (const { str: s, start } of stringData) {
      let newS = s.replace(reg, newSub)
      newStr += str.slice(lastIndex, start) + newS
      lastIndex = start + s.length
    }
    newStr += str.slice(lastIndex)
    return newStr
  },

  replaceOutString(str, reg, newSub) {
    let stringData = this.findString(str)
    let lastIndex = 0
    let newStr = ''
    for (const { str: s, start } of stringData) {
      newStr += str.slice(lastIndex, start).replace(reg, newSub) + s
      lastIndex = start + s.length
    }
    newStr += str.slice(lastIndex).replace(reg, newSub)
    return newStr
  },

  filterCreateSql(sql) {
    sql = this.replaceOutString(sql, /[ ]*AUTO_INCREMENT=[0-9]+/g, '')
    sql = this.replaceOutString(sql, /int\([0-9]+\)/g, 'int')
    return sql
  },

  //移除外部注释
  removeExtComment(sql) {
    let rows = sql.split('\n')
    rows = rows.filter(row => !row.match(/\s*#/))
    return rows.join('\n')
  },

  sqlFormat(sql) {
    sql = sqlFormatter.format(sql, { uppercase: true, linesBetweenQueries: 2 })
    sql = this.removeExtComment(sql)
    sql = this.replaceInString(sql, '\n', '\\n')//转换内部注释中的换行符
    sql = this.filterCreateSql(sql)
    return sql
  },

  parseCreateSql(sql) {
    sql = sql.trim()
    let reg = /^CREATE\s+TABLE\s+`?([a-z0-9_]+)`?\s*\(/i
    let results = sql.match(reg)
    if (!results) throw new Error('语法错误: ' + sql)
    return {
      tableName: results[1],
      rows: sql.split('\n')
    }
  },
}