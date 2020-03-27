'use strict'
const sqlFormatter = require("sql-formatter-plus")

const FORMAT_RULES = {
  simple: [
    [/int\s*\([0-9]+\)/gi, 'int', 'out'],
    [/\s+DEFAULT\s+CHARSET\s*=\s*\w+\s+COLLATE\s*=\s*\w+(\s*)/gi, '$1', 'out'],
    [/`(.+)`/gi, '$1', 'in', '`'],
    [/\\n/gi, '\n', 'in'],
    [/CONSTRAINT\s+\w+_ibfk_[0-9]+\s+/gi, '', 'out'],
    [/\s+=\s+/gi, '=', 'out'],
    [/KEY\s+\w+\s*\(/gi, 'KEY (', 'out'],
    [/date NOT NULL DEFAULT '0000-00-00'/gi, 'date NOT NULL DEFAULT 0', 'all'],
    [/datetime NOT NULL DEFAULT '0000-00-00 00:00:00'/gi, 'datetime NOT NULL DEFAULT 0', 'all'],
    [/ON UPDATE CASCADE ON DELETE CASCADE/gi, 'ON DELETE CASCADE ON UPDATE CASCADE', 'out'],
    [/(\s?)KEY\(/gi, '$1KEY (', 'out'],
    [/int NOT NULL DEFAULT '(-?[0-9]+)'/gi, 'int NOT NULL DEFAULT $1', 'all'],
    [/int unsigned NOT NULL DEFAULT '([0-9]+)'/gi, 'int unsigned NOT NULL DEFAULT $1', 'all'],
    [/CURRENT_TIMESTAMP/gi, 'NOW()', 'out'],
    [/UNSIGNED/gi, 'unsigned', 'out'],
    [/ENGINE=innodb/gi, 'ENGINE=InnoDB', 'out'],
    [/enum\s\(/gi, 'enum(', 'out'],
    (sql, tools) => {
      let { tableName, rows } = tools.parseCreateSql(sql)
      let foreignKey = []
      for (const row of rows) {
        let rt = row.match(/^\s*FOREIGN\s+KEY\s+\(\s*(\w+)\s*\)/)
        if (rt) foreignKey.push(rt[1])
      }
      for (const key of foreignKey) {
        rows = rows.filter(row => !row.match(new RegExp(`^\\s*KEY\\s*\\(\\s*${key}\\s*\\)`)))
      }
      let newSql = rows.join('\n')
      return rows.join('\n')
    }
  ]
}

module.exports = {
  formatRules: FORMAT_RULES.simple,
  setFormatRules(formatRules = []) {
    if (typeof formatRules == 'string') {
      if (!FORMAT_RULES[formatRules]) throw new Error(`formatRules没有 '${formatRules}'`)
      this.formatRules = FORMAT_RULES[formatRules]
    } else if (Array.isArray(formatRules)) {
      this.formatRules = formatRules
    } else {
      throw new Error('formatRules 错误')
    }
  },

  //查找被 ' 括起来的字符串
  findString(str, chars = ['\'', '`']) {
    let char = ''
    let isEscape = false
    let start = 0
    let results = []
    for (let i = 0; i < str.length; i++) {
      if (isEscape) {
        isEscape = false
        continue
      }
      let c = str[i]
      if (char) {
        if (c == char) {//结束
          results.push({
            str: str.slice(start, i + 1),
            start,
            char
          })
          char = ''
        } else if (c == '\\') isEscape = true
      } else {
        if (chars.includes(c)) {//开始
          char = c
          start = i
        }
      }
    }
    return results
  },

  replaceInString(str, reg, newSub, char = '\'') {
    let stringData = this.findString(str)
    let lastIndex = 0
    let newStr = ''
    for (const { str: s, start, char: c } of stringData) {
      let newS = c == char ? s.replace(reg, newSub) : s
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


  splitOutString(str, separator) {
    let stringData = this.findString(str)
    let lastIndex = 0
    let results = []
    let index = 0
    stringData.push({ str: '', start: str.length })
    for (const { str: s, start } of stringData) {
      let segments = str.slice(lastIndex, start).split(separator)
      let len = 0
      for (let i = 0; i < segments.length - 1; i++) {//忽略最后一个
        len += segments[i].length + separator.length
        results.push(str.slice(index, lastIndex + len - separator.length))
        index = lastIndex + len
      }
      lastIndex = start + s.length
    }
    results.push(str.slice(index))
    return results
  },

  //移除外部注释
  removeExtComment(sql) {
    let rows = sql.split('\n')
    rows = rows.filter(row => !row.match(/^\s*#/))
    return rows.join('\n')
  },


  createSqlFormat(sql) {
    sql = this.replaceOutString(sql, /\s+AUTO_INCREMENT\s*=\s*[0-9]+/gi, '')
    if (this.formatRules) {
      for (const rule of this.formatRules) {
        if (typeof rule == 'function') {
          sql = rule(sql, this)
          continue
        }
        let [reg, sub, where, char] = rule
        if (where == 'in') {
          sql = this.replaceInString(sql, reg, sub, char)
        } else if (where == 'out') {
          sql = this.replaceOutString(sql, reg, sub)
        } else {
          sql = sql.replace(reg, sub)
        }
      }
    }
    return sql
  },

  sqlFormat(sql) {
    sql = sqlFormatter.format(sql, { uppercase: true, linesBetweenQueries: 0 })
    sql = this.removeExtComment(sql)
    let newSql = ''
    for (let createSql of this.splitOutString(sql, ';')) {
      createSql = createSql.trim()
      if (!createSql) continue
      newSql += this.createSqlFormat(createSql) + ';\n\n\n'
    }
    return newSql
  },

  parseCreateSql(sql) {
    sql = sql.trim()
    let reg = /^CREATE\s+TABLE\s+`?([a-z0-9_]+)`?\s*\(/i
    let results = sql.match(reg)
    if (!results) throw new Error('语法错误: ' + sql)
    return {
      tableName: results[1],
      rows: this.splitOutString(sql, '\n')
    }
  },
}
