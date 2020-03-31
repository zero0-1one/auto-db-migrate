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
SUBPARTITIONS,TABLE,TABLESPACE,TEMPORARY,THAN,UNION,UNIQUE,UPDATE,USING,VALUES,VIRTUAL,VISIBLE,WITH,ZLIB,

InnoDB
`.split(',').map(w => w.trim())

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
    ],

    'compact': [
      'stringInLine',
      [/\n/g, ' ', 'out'],
      [/\s+/g, ' ', 'out'],
      [/, /g, ',', 'out'],
      [/^\s+/, '', 'out'], //_base 是 raw 这里是 all 
      [/\s+$/, '', 'out'],  //_base 是 raw 这里是 all 
      'noSpaceInBrackets',
      'noSpaceWrapBrackets',
      'noSpaceWrapEqual',
    ],

    //缩进
    'indent0': [[/\n\s+/g, '\n', 'out']],
    'indent2': [[/\n\s+/g, '\n  ', 'out']],
    'indent4': [[/\n\s+/g, '\n    ', 'out']],
    //; 中间的空行数
    'noSpaceLine': [[/;\s*/g, ';', 'out']],
    'spaceLine0': [[/;\s*/g, ';\n', 'out']],
    'spaceLine1': [[/;\s*/g, ';\n\n', 'out']],
    'spaceLine2': [[/;\s*/g, ';\n\n\n', 'out']],
    'spaceLine3': [[/;\s*/g, ';\n\n\n\n', 'out']],

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
    'noSpaceWrapBackQuote': [[/\s*(`\w+`)\s*/gi, '$1', 'out', '\'']],
    'noSpaceInBrackets': [
      [/\( +(\S)/g, '($1', 'out'],
      [/(\S) +\)/g, '$1)', 'out']
    ],
    'noSpaceBeforeBrackets': [[/\s*\(/g, '(', 'out']],
    'noSpaceAfterBrackets': [[/\)\s*/g, ')', 'out']],
    'spaceBeforeBrackets': [[/\s*\(/g, ' (', 'out']],
    'spaceAfterBrackets': [[/\)\s*/g, ') ', 'out']],
    'noSpaceWrapBrackets': ['noSpaceBeforeBrackets', 'noSpaceAfterBrackets'],
    'spaceWrapBrackets': ['spaceBeforeBrackets', 'spaceAfterBrackets'],
    'noSpaceBeforeTypeBrackets': [
      [/int(\s*)\(/gi, 'int(', 'out'],
      [/char(\s*)\(/gi, 'char(', 'out'],
    ],
    'noSpaceWrapEqual': [[/\s*=\s*/gi, '=', 'out']],
    'noTableDefault_utf8': [[/\s*DEFAULT CHARSET\s*=\s*utf8\b/gi, '', 'out']],
    'noTableDefault_utf8mb4': [[/\s*DEFAULT\s+CHARSET\s*=\s*utf8mb4\s+COLLATE\s*=\s*utf8mb4_0900_ai_ci/gi, '', 'out']],
    'noAutoIncrement': [[/\s*AUTO_INCREMENT\s*=\s*[0-9]+/gi, '', 'out']],
    'intValueNoQuote': [[/int(.*) DEFAULT '(-?[0-9]+)'/gi, 'int$1 DEFAULT $2', 'raw']],
    'uppercase': [sql => {
      for (const word of KEY_WORDS) {
        sql = util.changeByQuote(sql, { type: 'out' }, item => item.str.replace(new RegExp(`\\b${word}\\b`, 'gi'), word))
      }
      return sql
    }],

    'noForeignAutoKey': [(sql) => {
      let rows = util.splitOutQuote(sql, ',')
      let foreignKey = []
      for (const row of rows) {
        let rt = row.match(/\bFOREIGN\s+KEY\s*\(\s*`?(\w+)`?\s*\)/i)
        if (rt) foreignKey.push(rt[1])
      }
      for (const key of foreignKey) {
        rows = rows.filter(row => !row.match(new RegExp(`^\\s*KEY\\s*\\(\\s*\`?${key}\`?\\s*\\)`)))
      }
      return rows.join(',')
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
    let _rules = [...this.rules._base, ...rules]
    _rules = this.createRules(_rules)
    sql = util.removeComment(sql, undefined, outComment)
    let old = sql
    for (let i = 0; i < 10; i++) {
      for (const rule of _rules) {
        if (typeof rule == 'function') {
          sql = rule(sql, this)
          continue
        }
        let [reg, sub, where, char] = rule
        if (where == 'raw') {
          sql = sql.replace(reg, sub)
        } else {
          sql = util.changeByQuote(sql, { type: where, char }, ({ str }) => str.replace(reg, sub))
        }
      }
      if (sql == old) break
      old = sql
    }
    if (sql != old) throw new Error('规则未能得到一个稳定的结果')
    return sql
  }
}

