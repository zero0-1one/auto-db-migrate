'use strict'
const sqlFormatter = require("sql-formatter-plus")

const FORMAT_RULES = {
  simple: [
    'noIntLen',
    'noBackQuote',
    'noDefaultCharset',
    'inline',
    'noKeyName',
    'base',
    'useNow',
    'useKey',
    'noAutoIncrement',
    'noForeignAutoKey',
    'noSpaceBeforeBracket',
  ],

  base: [
    [/\s+=\s+/gi, '=', 'out'],
    [/int NOT NULL DEFAULT '(-?[0-9]+)'/gi, 'int NOT NULL DEFAULT $1', 'all'],
    [/int unsigned NOT NULL DEFAULT '([0-9]+)'/gi, 'int unsigned NOT NULL DEFAULT $1', 'all'],
    [/(\s)KEY\(/gi, '$1KEY (', 'out'],
    [/(\s)enum\s\(/gi, '$1enum(', 'out'],
    [/(\s)UNSIGNED([\s,])/gi, '$1unsigned$2', 'out'],
    [/ENGINE=innodb/gi, 'ENGINE=InnoDB', 'out'],
    [/date NOT NULL DEFAULT '0000-00-00'/gi, 'date NOT NULL DEFAULT 0', 'all'],
    [/datetime NOT NULL DEFAULT '0000-00-00 00:00:00'/gi, 'datetime NOT NULL DEFAULT 0', 'all'],
    [/ON UPDATE CASCADE ON DELETE CASCADE/gi, 'ON DELETE CASCADE ON UPDATE CASCADE', 'out'],
    'noSpaceInBracket',
  ],
  useNow: [[/CURRENT_TIMESTAMP/gi, 'NOW()', 'out']],
  useCurrent: [[/NOW\s*\(\s*\)/gi, 'CURRENT_TIMESTAMP', 'out']],
  useKey: [[/(\s)INDEX([\s\(`,)])/gi, '$1KEY$2', 'out']],
  useIndex: [[/(\s)KEY([\s\(`,)])/gi, '$1INDEX$2', 'out']],
  noKeyName: [
    [/CONSTRAINT\s+`?\w+`?\s+/gi, '', 'out', '\''],
    [/KEY\s+`?\w+`?\s*\(/gi, 'KEY (', 'out', '\''],
  ],
  noIntLen: [[/int\s*\([0-9]+\)/gi, 'int', 'out']],
  inline: [[/\\n/g, '\n', 'in']],
  noInline: [[/\n/g, '\\n', 'in']],
  noBackQuote: [[/`(.+)`/gi, '$1', 'in', '`']],
  noSpaceInBracket: [[/\([ ]*(.+)[ ]*\)/g, '($1)', 'out']],
  noSpaceBeforeBracket: [[/(\s+)\(/g, '(', 'out']],
  noDefaultCharset: [[/\s+DEFAULT\s+CHARSET\s*=\s*\w+\s+COLLATE\s*=\s*\w+(\s*)/gi, '$1', 'out']],
  noAutoIncrement: [[/\s+AUTO_INCREMENT\s*=\s*[0-9]+/gi, '', 'out']],
  noForeignAutoKey: [(sql, tools) => {
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
  }],
}

module.exports = {
  formatRules: [],

  createFormatRules(formatRules = [], names = new Set()) {
    let rules = []
    if (typeof formatRules == 'string') {
      if (!FORMAT_RULES[formatRules]) throw new Error(`formatRules没有 '${formatRules}'`)
      names.add(formatRules)
      rules.push(...this.createFormatRules(FORMAT_RULES[formatRules], names))
    } else if (Array.isArray(formatRules)) {
      for (const rule of formatRules) {
        if (Array.isArray(rule) || typeof rule == 'function') {
          rules.push(rule)
        } else if (typeof rule == 'string') {
          if (!FORMAT_RULES[rule]) throw new Error(`formatRules没有 '${rule}'`)
          if (names.has(rule)) throw new Error(`循环或重复引用规则 '${rule}'`)
          names.add(rule)
          rules.push(...this.createFormatRules(FORMAT_RULES[rule], names))
        } else {
          throw new Error('formatRules 错误')
        }
      }
    } else {
      throw new Error('formatRules 错误')
    }
    return rules
  },
  setFormatRules(formatRules) {
    this.formatRules = this.createFormatRules(formatRules)
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

  replaceOutString(str, reg, newSub, char = '\'`') {
    let stringData = this.findString(str)
    let lastIndex = 0
    let newStr = ''
    for (const { str: s, start, char: c } of stringData) {
      if (!char.includes(c)) continue
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
          sql = this.replaceOutString(sql, reg, sub, char)
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

  getCreateRowType(row) {
    if (row.match(/^CREATE\s+TABLE\s+`?(\w+)`?\s*\(/i)) {
      return 'header'
    } else if (row.match(/(\w+\s+)?(KEY|INDEX)/)) {
      return 'key'
    } else if (row.match(/\)/)) {
      return 'options'
    } else {
      return 'column'
    }
  },

  parseCreateHeader(row) {
    let reg = /^CREATE\s+TABLE\s+`?(\w+)`?\s*\(/i
    let results = row.match(reg)
    if (!results) throw new Error('CreateHeader 语法错误: ' + row)
    return { type: 'header', tableName: results[1] }
  },


  parseCreateKey(row) {
    let results = null

    let matches = [
      () => {
        let results = row.match(/^PRIMARY\s+KEY\s*\((\w+)\)/)
        if (results) return {
          type: 'primaryKey',
          keyName: results[1],
          column: [results[1]]
        }
      },
      () => {
        let results = row.match(/^CONSTRAINT\s+(\w+)\s+FOREIGN\s+KEY\s*\((.+)\)/i) || row.match(/^FOREIGN\s+KEY\s*\((.+)\)/i)
        let column = results[2] || results[1]
        if (results) {
          data.keyType = 'foreignKey'
          data.keyName = results[1]
          data.column = column.split(',').map(c => c.trim())
        }
      },
      () => {
        let results = row.match(/^UNIQUE\s+`?(\w+)`?\s+KEY\s*\((.+)\)/i) || row.match(/^UNIQUE\s+KEY\s*\((.+)\)/i)
        let column = results[2] || results[1]
        if (results) {
          data.keyType = 'uniqueKey'
          data.keyName = results[1]
          data.column = column.split(',').map(c => c.trim())
        }
      },
      () => {
        let results = row.match(/^KEY\s*\((.+)\)/i) || row.match(/^UNIQUE\s+KEY\s*\((.+)\)/i)
        let column = results[2] || results[1]
        if (results) {
          data.keyType = 'uniqueKey'
          data.keyName = results[1]
          data.column = column.split(',').map(c => c.trim())
        }
      },
    ]
  },



  parseCreateOptions(row) {

  },

  parseCreateColumn(row) {

  },

  parseCreateRow(row) {
    let type = this.getCreateRowType(row)
    let syntax = [
      [/^CREATE\s+TABLE\s+`?(\w+)`?\s*\(/i, 'tableName'],
      [/^\s+(\w+)/i, 'tableName'],
    ]
  },

  parseCreateSql(sql) {
    sql = sql.trim()
    let reg = /^CREATE\s+TABLE\s+`?(\w+)`?\s*\(/i
    let results = sql.match(reg)
    if (!results) throw new Error('语法错误: ' + sql)
    return {
      tableName: results[1],
      rows: this.splitOutString(sql, '\n'),
    }
  }
}
