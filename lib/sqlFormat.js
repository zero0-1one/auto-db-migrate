'use strict'
const util = require('./util')


const KEY_WORDS = `
ACTION,ALGORITHM,ALWAYS,AS,ASC,AUTO_INCREMENT,AVG_ROW_LENGTH,BTREE,BY,CASCADE,CHARACTER,CHECK,CHECKSUM,
COLLATE,COLUMNS,COLUMN_FORMAT,COMMENT,COMPACT,COMPRESSED,COMPRESSION,CONNECTION,CONSTRAINT,CREATE,DATA,
DEFAULT,DELAY_KEY_WRITE,DELETE,DESC,DIRECTORY,DISK,DYNAMIC,ENCRYPTION,ENFORCED,ENGINE,EXISTS,FIRST,FIXED,
FOREIGN,FULL,FULLTEXT,GENERATED,HASH,IF,IGNORE,IN,INDEX,INSERT_METHOD,INVISIBLE,KEY,KEY_BLOCK_SIZE,LAST,
LESS,LIKE,LINEAR,LIST,LZ,MATCH,MAXVALUE,MAX_ROWS,MEMORY,MIN_ROWS,NO,NONE,NOT,NULL,ON,PACK_KEYS,PARSER,
PARTIAL,PARTITION,PARTITIONS,PASSWORD,PRIMARY,RANGE,REDUNDANT,REFERENCES,REPLACE,RESTRICT,ROW_FORMAT,SELECT,
SET,SIMPLE,SPATIAL,STATS_AUTO_RECALC,STATS_PERSISTENT,STATS_SAMPLE_PAGES,STORAGE,STORED,SUBPARTITION,
SUBPARTITIONS,TABLE,TABLESPACE,TEMPORARY,THAN,UNION,UNIQUE,UPDATE,USING,VALUES,VIRTUAL,VISIBLE,WITH,ZLIB
`.split(',').map(w => w.trim())
const KEY_WORDS_SET = new Set(KEY_WORDS)
const KEY_WORDS_MAP = {
  'INNODB': 'InnoDB'
}


//目前不支持保留外部  注释, 请使用 mysql 的 COMMENT 语法
module.exports = {
  rules: {
    //必追加的规则, 最先执行
    '_base': [
      [/\n+/g, '\n', 'out'],
      [/[\f\r\t\v]/g, ' ', 'out'],
      [/[ ]+/g, ' ', 'out'],
      [/^\s+/, '', 'raw'],
      [/\s+$/, '', 'raw'],
    ],

    'simple': [
      'zeroDate',
      'noSpaceInBrackets',
      'noSpaceWrapEqual',
      'spaceWrapBrackets',
      'spaceAfterComma',
      'noSpaceBeforeFuncBrackets',
      'noSpaceBeforeTypeBrackets',
      'referencesOrder',
      'useNow',
      'useKey',
      'noKeyName',
      'noIntLen',
      'stringMultiLine',
      'noAutoIncrement',
      'noForeignAutoKey',
      'intValueNoQuote',
      'uppercase',

      'indent2',
      'spaceLine2',
      'partLine'
    ],

    'normal': [
      'uppercase',
      'useKey',
      'useCurrent',
      'noSpaceInBrackets',
      'spaceBeforeBrackets',
      'spaceAfterComma',
      'noSpaceBeforeFuncBrackets',
      'noSpaceBeforeTypeBrackets',
      'noSpaceWrapEqual',
      'indent2',
      'spaceLine2',
    ],

    //缩进
    'indent2': [[/\n +/g, '\n  ', 'out']],
    'indent4': [[/\n +/g, '\n    ', 'out']],
    //; 中间的空行数
    'noSpaceLine': [[/;\s*/, ';', 'out']],
    'spaceLine0': [[/;\s*/, ';\n', 'out']],
    'spaceLine1': [[/;\s*/, ';\n\n', 'out']],
    'spaceLine2': [[/;\s*/, ';\n\n\n', 'out']],
    'spaceLine3': [[/;\s*/, ';\n\n\n\n', 'out']],
    'partLine': [[/,\n+(\s*)(PRIMARY|KEY|UNIQUE|FOREIGN|CONSTRAINT)/i, ',\n\n$1$2', 'out']],

    'zeroDate': [
      [/date NOT NULL DEFAULT '0000-00-00'/gi, 'date NOT NULL DEFAULT 0', 'raw'],
      [/datetime NOT NULL DEFAULT '0000-00-00 00:00:00'/gi, 'datetime NOT NULL DEFAULT 0', 'raw'],
    ],
    'referencesOrder': [
      [/ON UPDATE(( \w+){1,2}) ON DELETE(( \w+){1,2})/gi, 'ON DELETE$3 ON UPDATE$1', 'out'],
    ],
    'useNow': [
      [/\bCURRENT_TIMESTAMP\s*\(([0-9]+)\)/gi, 'NOW($1)', 'out'],
      [/\bCURRENT_TIMESTAMP\b/gi, 'NOW()', 'out'],
    ],
    'useCurrent': [
      [/\bNOW\s*\(\s*([0-9]+)\s*\)/gi, 'CURRENT_TIMESTAMP($1)', 'out'],
      [/\bNOW\s*\(\s*\)/gi, 'CURRENT_TIMESTAMP', 'out']
    ],
    'useKey': [[/\bINDEX\b/gi, 'KEY', 'out']],
    'useIndex': [[/\bKEY\b/gi, 'INDEX', 'out']],

    'noKeyName': [
      [/\bCONSTRAINT\s*`?\w+`?\s*/gi, '', 'out', '\''],
      [/\bKEY(\s+|\s*`)\w+`?(\s*)\(/gi, 'KEY$2(', 'out', '\''],
    ],
    'noIndexName': ['noKeyName'],
    'noIntLen': [[/int\s*\([0-9]+\)/gi, 'int', 'out']],
    'stringMultiLine': [[/\\n/g, '\n', 'in', '\'']],
    'stringInLine': [[/\n/g, '\\n', 'in', '\'']],
    'noBackQuote': [[/^`(.+)`$/gi, '$1', 'in']],
    'noSpaceWrapBackQuote': [[/ *(`\w+`) */gi, '$1', 'out', '\'']],
    'noSpaceInBrackets': [
      [/\( +(\S)/g, '($1', 'out'],
      [/(\S) +\)/g, '$1)', 'out']
    ],
    'noSpaceBeforeBrackets': [[/ *\(/g, '(', 'out']],
    'noSpaceAfterBrackets': [[/\) */g, ')', 'out']],
    'spaceBeforeBrackets': [[/ *\(/g, ' (', 'out']],
    'spaceAfterBrackets': [[/\) */g, ') ', 'out'], [/\) ,/g, '),', 'out']],
    'spaceBeforeComma': [[/ *,/g, ' ,', 'out']],
    'spaceAfterComma': [[/, *([^\n]|$)/g, ', $1', 'out']],
    'noSpaceWrapBrackets': ['noSpaceBeforeBrackets', 'noSpaceAfterBrackets'],
    'spaceWrapBrackets': ['spaceBeforeBrackets', 'spaceAfterBrackets'],
    'noSpaceBeforeTypeBrackets': [
      [/int(\s*)\(/gi, 'int(', 'out'],
      [/char(\s*)\(/gi, 'char(', 'out'],
      [/\benum(\s*)\(/gi, 'enum(', 'out'],
      [/\bdatetime(\s*)\(/gi, 'datetime(', 'out'],
    ],
    'noSpaceBeforeFuncBrackets': [
      [/\bcurrent_timestamp(\s*)\(/gi, 'current_timestamp(', 'out'],
      [/\bnow(\s*)\(/gi, 'now(', 'out'],
    ],
    'noSpaceWrapEqual': [[/\s*=\s*/gi, '=', 'out']],
    'noTableCharset_utf8': [[/\s*DEFAULT CHARSET\s*=\s*utf8\b/i, '', 'out']],
    'noTableCharset_utf8mb4': [
      [/\s*DEFAULT\s+CHARSET\s*=\s*utf8mb4\s+COLLATE\s*=\s*utf8mb4_0900_ai_ci/i, '', 'out'],
      [/\s*DEFAULT\s+CHARSET\s*=\s*utf8mb4\s+COLLATE\s*=\s*utf8mb4_general_ci/i, '', 'out']
    ],
    'noTableCharset': ['noTableCharset_utf8', 'noTableCharset_utf8mb4'],
    'noAutoIncrement': [[/\s*AUTO_INCREMENT\s*=\s*[0-9]+/i, '', 'out']],
    'intValueNoQuote': [[/\b(tinyint|smallint|mediumint|int|bigint|float|double)( |\()(.*?) DEFAULT '(-?[0-9.]+)'/gi, '$1$2$3 DEFAULT $4', 'raw']],
    'uppercase': [(sql, items) => {
      util.forEachQuoteItems(items, 'out', item => {
        let words = item.str.match(/\b[a-z_]+\b/gi)
        words = [...new Set(words)]
        for (const word of words) {
          let uppercase = word.toUpperCase()
          if (uppercase != word && KEY_WORDS_SET.has(uppercase)) {
            item.str = item.str.replace(new RegExp(`\\b${word}\\b`, 'g'), uppercase)
          } else if (KEY_WORDS_MAP[uppercase]) {
            item.str = item.str.replace(new RegExp(`\\b${word}\\b`, 'g'), KEY_WORDS_MAP[uppercase])
          }
        }
      })
    }],

    'noForeignAutoKey': [(sql, items) => {
      let rows = util.splitOutQuote(items, '\n')
      let foreignKey = []
      for (const row of rows) {
        let rt = row.match(/\bFOREIGN\s+KEY\s*\((.*?)\)/i)
        if (rt) {
          let keys = rt[1].split(',').map(col => {
            col = col.trim()
            return col[0] == '`' ? col.slice(1, -1) : col
          })
          foreignKey.push(keys)
        }
      }
      let oldLen = rows.length
      for (const keys of foreignKey) {
        let strKeys = keys.map(key => `\`?${key}\`?`).join('\\s*,\\s*')
        rows = rows.filter(row => !row.match(new RegExp(`^\\s*KEY\\s*\\(\\s*${strKeys}\\s*\\)`)))
      }
      if (rows.length != oldLen) return rows.join('\n') //修改了才返回
    }]
  },
  createRules(rules = [], addBase = false) {
    let _rules = rules
    if (addBase) {
      let _rules = [...this.rules._base]
      if (typeof rules == 'string') {
        _rules.push(rules)
      } else {
        _rules.push(...rules)
      }
    }
    let newRules = []
    if (typeof _rules == 'string') {
      if (!this.rules[_rules]) throw new Error(`formatRules没有 '${_rules}'`)
      newRules.push(...this.createRules(this.rules[_rules]))
    } else if (Array.isArray(_rules)) {
      for (const rule of _rules) {
        if (Array.isArray(rule) || typeof rule == 'function') {
          newRules.push(rule)
        } else if (typeof rule == 'string') {
          if (!this.rules[rule]) throw new Error(`formatRules没有 '${rule}'`)
          newRules.push(...this.createRules(this.rules[rule]))
        } else {
          throw new Error('formatRules 错误')
        }
      }
    } else {
      throw new Error('formatRules 错误')
    }
    return newRules
  },


  rulesToString(rules) {
    if (typeof rules == 'string') return rules
    let strings = rules.map(rule => {
      if (Array.isArray(rule)) {
        return rule.map(v => v.toString()).join('|')
      } else if (typeof rule == 'function') {
        return rule.toString()
      } else if (typeof rule == 'string') {
        return rule
      } else {
        throw new Error('formatRules 错误')
      }
    })
    return strings.join(',')
  },

  format(sql, rules, outComment) {
    let _rules = this.createRules(rules, true)
    sql = util.removeComment(sql, undefined, outComment)
    let items = util.splitOutQuote(sql, ';')
    let content = ''
    items.forEach((str, i) => {
      str = str.trim()
      if (!str) return
      if (i != items.length - 1) str += ';'
      content += this.formatOne(str, _rules)
    })
    return content.trim()
  },

  formatOne(sql, rules) {
    let items = null
    let itemsChar
    let needUpdateItems = true
    let updateString = (newSql) => {
      if (newSql == undefined) return
      if (newSql != sql) {
        sql = newSql
        needUpdateItems = true
      }
    }

    let updateItems = (char) => {
      items = util.splitByQuote(newStr(), { type: 'all', char })
      itemsChar = char
      needUpdateItems = false
    }
    //needUpdateItems 为 true 的时候,说明 sql 是最新的,  否则以 items 内的为准
    let newStr = () => needUpdateItems ? sql : items.map(item => item.str).join('')
    for (const rule of rules) {
      if (typeof rule == 'function') {
        if (needUpdateItems) updateItems()
        updateString(rule(newStr(), items))
        continue
      }
      let [reg, sub, where, char] = rule
      if (where == 'raw') {
        updateString(newStr().replace(reg, sub))
      } else {
        if (needUpdateItems || char !== itemsChar) updateItems(char) //char 发生变化就需要更新 items
        let isBreak = false
        util.forEachQuoteItems(items, where, item => {
          if (isBreak) return
          let temp = item.str.replace(reg, sub)
          if (!reg.global) isBreak = temp != item.str
          item.str = temp
        })
      }
    }
    return newStr()
  }
}
