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
      `noBackQuote`,
      'noSpaceInBrackets',
      'noSpaceWrapEqual',
      'spaceWrapBrackets',
      'noSpaceBeforeTypeBrackets',
      'referencesOrder',
      'useNow',
      'useKey',
      'noKeyName',
      'noIntLen',
      'stringMultiLine',
      'noAutoIncrement',
      'noForeignAutoKey',
      'uppercase',

      'indent2',
      'spaceLine2',
    ],

    'normal': [
      'uppercase',
      'useKey',
      'useCurrent',
      'noSpaceInBrackets',
      'spaceBeforeBrackets',
      'noSpaceBeforeTypeBrackets',
      'noSpaceWrapEqual',
      'indent2',
      'spaceLine2',
    ],

    //缩进
    '_clearIndent': [[/^\s+\)/, ')', 'out']],
    'indent0': [[/\n\s+/g, '\n', 'out'], '_clearIndent'],
    'indent2': [[/\n\s+/g, '\n  ', 'out'], '_clearIndent'],
    'indent4': [[/\n\s+/g, '\n    ', 'out'], '_clearIndent'],
    //; 中间的空行数
    '_clearEndLine': [[/\s+$/, '', 'raw']],
    'noSpaceLine': [[/;\s*/g, ';', 'out'], '_clearEndLine'],
    'spaceLine0': [[/;\s*/g, ';\n', 'out'], '_clearEndLine'],
    'spaceLine1': [[/;\s*/g, ';\n\n', 'out'], '_clearEndLine'],
    'spaceLine2': [[/;\s*/g, ';\n\n\n', 'out'], '_clearEndLine'],
    'spaceLine3': [[/;\s*/g, ';\n\n\n\n', 'out'], '_clearEndLine'],


    'zeroDate': [
      [/date NOT NULL DEFAULT '0000-00-00'/gi, 'date NOT NULL DEFAULT 0', 'raw'],
      [/datetime NOT NULL DEFAULT '0000-00-00 00:00:00'/gi, 'datetime NOT NULL DEFAULT 0', 'raw'],
    ],
    'referencesOrder': [
      [/ON UPDATE(( \w+){1,2}) ON DELETE(( \w+){1,2})/gi, 'ON DELETE$3 ON UPDATE$1', 'out'],
    ],
    'useNow': [[/\bCURRENT_TIMESTAMP\b/gi, 'NOW()', 'out']],
    'useCurrent': [[/\bNOW\s*\(\s*\)/gi, 'CURRENT_TIMESTAMP', 'out']],
    'useKey': [[/\bINDEX\b/gi, 'KEY', 'out']],
    'useIndex': [[/\bKEY\b/gi, 'INDEX', 'out']],
    'noKeyName': [
      [/CONSTRAINT\s*`?\w+`?\s*/gi, '', 'out', '\''],
      [/KEY(\s+|\s*`)\w+`?(\s*)\(/gi, 'KEY$2(', 'out', '\''],
    ],
    'noIndexName': ['noKeyName'],
    'noIntLen': [[/int\s*\([0-9]+\)/gi, 'int', 'out']],
    'stringMultiLine': [[/\\n/g, '\n', 'in', '\'']],
    'stringInLine': [[/\n/g, '\\n', 'in', '\'']],
    'noBackQuote': [[/`(.+)`/gi, '$1', 'in', '`']],
    'noSpaceWrapBackQuote': [[/ *(`\w+`) */gi, '$1', 'out', '\'']],
    'noSpaceInBrackets': [
      [/\( +(\S)/g, '($1', 'out'],
      [/(\S) +\)/g, '$1)', 'out']
    ],
    'noSpaceBeforeBrackets': [[/ *\(/g, '(', 'out']],
    'noSpaceAfterBrackets': [[/\) */g, ')', 'out']],
    'spaceBeforeBrackets': [[/ *\(/g, ' (', 'out']],
    'spaceAfterBrackets': [[/\) */g, ') ', 'out']],
    'noSpaceWrapBrackets': ['noSpaceBeforeBrackets', 'noSpaceAfterBrackets'],
    'spaceWrapBrackets': ['spaceBeforeBrackets', 'spaceAfterBrackets'],
    'noSpaceBeforeTypeBrackets': [
      [/int(\s*)\(/gi, 'int(', 'out'],
      [/char(\s*)\(/gi, 'char(', 'out'],
    ],
    'noSpaceWrapEqual': [[/\s*=\s*/gi, '=', 'out']],
    'noTableCharset_utf8': [[/\s*DEFAULT CHARSET\s*=\s*utf8\b/gi, '', 'out']],
    'noTableCharset_utf8mb4': [[/\s*DEFAULT\s+CHARSET\s*=\s*utf8mb4\s+COLLATE\s*=\s*utf8mb4_0900_ai_ci/gi, '', 'out']],
    'noTableCharset': ['noTableCharset_utf8', 'noTableCharset_utf8mb4'],
    'noAutoIncrement': [[/\s*AUTO_INCREMENT\s*=\s*[0-9]+/gi, '', 'out']],
    'intValueNoQuote': [[/int(.*) DEFAULT '(-?[0-9]+)'/gi, 'int$1 DEFAULT $2', 'raw']],
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
      let rows = util.splitOutQuote(items, ',')
      let foreignKey = []
      for (const row of rows) {
        let rt = row.match(/\bFOREIGN\s+KEY\s*\(\s*`?(\w+)`?\s*\)/i)
        if (rt) foreignKey.push(rt[1])
      }
      let oldLen = rows.length
      for (const key of foreignKey) {
        rows = rows.filter(row => !row.match(new RegExp(`^\\s*KEY\\s*\\(\\s*\`?${key}\`?\\s*\\)`)))
      }
      if (rows.length != oldLen) return rows.join(',') //修改了才返回
    }],
    'noExtComment': [(sql) => util.removeComment(sql)]
  },

  createRules(rules = [], names = new Set()) {
    let newRules = []
    if (typeof rules == 'string') {
      if (!this.rules[rules]) throw new Error(`formatRules没有 '${rules}'`)
      names.add(rules)
      newRules.push(...this.createRules(this.rules[rules], names))
    } else if (Array.isArray(rules)) {
      for (const rule of rules) {
        if (Array.isArray(rule) || typeof rule == 'function') {
          newRules.push(rule)
        } else if (typeof rule == 'string') {
          if (!this.rules[rule]) throw new Error(`formatRules没有 '${rule}'`)
          if (names.has(rule)) throw new Error(`循环或重复引用规则 '${rule}'`)
          names.add(rule)
          newRules.push(...this.createRules(this.rules[rule], names))
        } else {
          throw new Error('formatRules 错误')
        }
      }
    } else {
      throw new Error('formatRules 错误')
    }
    return newRules
  },

  format(sql, rules, outComment) {
    let _rules = [...this.rules._base]
    if (typeof rules == 'string') {
      _rules.push(rules)
    } else {
      _rules.push(...rules)
    }
    _rules = this.createRules(_rules)
    let _sql = util.removeComment(sql, undefined, outComment)

    let items = null
    let itemsChar
    let needUpdateItems = true

    let updateString = (newSql) => {
      if (newSql == undefined) return
      if (newSql != _sql) {
        _sql = newSql
        needUpdateItems = true
      }
    }

    let updateItems = (char) => {
      items = util.splitByQuote(newStr(), { type: 'all', char })
      itemsChar = char
      needUpdateItems = false
    }

    //needUpdateItems 为 true 的时候,说明 sql 是最新的,  否则以 items 内的为准
    let newStr = () => needUpdateItems ? _sql : items.map(item => item.str).join('')
    for (const rule of _rules) {
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
        util.forEachQuoteItems(items, where, item => item.str = item.str.replace(reg, sub))
      }
    }
    return newStr()
  }
}
