const sqlFormat = require('../lib/sqlFormat')
const { expect } = require('chai').use(require('chai-like'))

describe('sqlFormat 测试', function () {
  describe('createRules()', function () {
    it('createRules', function () {
      let rules = sqlFormat.createRules(['useNow', 'noSpaceInBrackets'])
      expect(rules).to.be.deep.equal([
        ...sqlFormat.rules['useNow'],
        ...sqlFormat.rules['noSpaceInBrackets'],
      ])
    })

    it('createRules 递归', function () {
      let rules = sqlFormat.createRules(['useNow', 'noSpaceWrapBrackets'])
      expect(rules).to.be.deep.equal([
        ...sqlFormat.rules['useNow'],
        ...sqlFormat.rules['noSpaceBeforeBrackets'],
        ...sqlFormat.rules['noSpaceAfterBrackets'],
      ])
    })

    it('createRules 自定义', function () {
      let rules = sqlFormat.createRules([[/\bCURRENT_TIMESTAMP\b/gi, 'NOW()', 'out']])
      expect(rules).to.be.deep.equal([[/\bCURRENT_TIMESTAMP\b/gi, 'NOW()', 'out']])
    })

    it('createRules 循环检测', function () {
      for (const name in sqlFormat.rules) {
        expect(() => sqlFormat.createRules([name])).to.not.throw()
      }
    })
  })

  it('removeExtComment()', function () {
    let sql = `
    #aaaa
    bbbb
    //cccc
    dddd
    ee#ee
  `
  })

  describe('format()', function () {
    let testData = [{
      rule: ['indent2'],
      sql: 'line1\n line2\n   line3',
      exp: 'line1\n  line2\n  line3'
    }, {
      rule: ['indent4'],
      sql: 'line1\n line2\n   line3',
      exp: 'line1\n    line2\n    line3'
    }, {
      rule: ['noSpaceLine'],
      sql: 'line1;\n\nline2;\nline3',
      exp: 'line1;line2;line3'
    }, {
      rule: ['spaceLine0'],
      sql: 'line1;\n\nline2;\nline3',
      exp: 'line1;\nline2;\nline3'
    }, {
      rule: ['spaceLine1'],
      sql: 'line1;\n\nline2;\nline3',
      exp: 'line1;\n\nline2;\n\nline3'
    }, {
      rule: ['spaceLine2'],
      sql: 'line1;\n\nline2;\nline3',
      exp: 'line1;\n\n\nline2;\n\n\nline3'
    }, {
      rule: ['spaceLine3'],
      sql: 'line1;\n\nline2;\nline3',
      exp: 'line1;\n\n\n\nline2;\n\n\n\nline3'
    }, {
      rule: ['referencesOrder'],
      sql: 'ON UPDATE CASCADE ON DELETE CASCADE',
      exp: 'ON DELETE CASCADE ON UPDATE CASCADE'
    }, {
      rule: ['referencesOrder'],
      sql: 'ON UPDATE SET DEFAULT ON DELETE CASCADE',
      exp: 'ON DELETE CASCADE ON UPDATE SET DEFAULT'
    }, {
      rule: ['useNow'],
      sql: '`g_dtTime` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
      exp: '`g_dtTime` datetime DEFAULT NOW() ON UPDATE NOW()'
    }, {
      rule: ['useNow'],
      sql: '`g_dtTime` datetime(2) DEFAULT CURRENT_TIMESTAMP(2) ON UPDATE CURRENT_TIMESTAMP(2)',
      exp: '`g_dtTime` datetime(2) DEFAULT NOW(2) ON UPDATE NOW(2)'
    }, {
      rule: ['useCurrent'],
      sql: 'g_dtTime datetime DEFAULT NOW() ON UPDATE NOW()',
      exp: 'g_dtTime datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
    }, {
      rule: ['useCurrent'],
      sql: 'g_dtTime datetime(3) DEFAULT NOW(3) ON UPDATE NOW(3)',
      exp: 'g_dtTime datetime(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)'
    },{
      rule: ['useKey'],
      sql: 'UNIQUE INDEX(abc)',
      exp: 'UNIQUE KEY(abc)'
    }, {
      rule: ['useIndex'],
      sql: 'UNIQUE KEY (abc)',
      exp: 'UNIQUE INDEX (abc)'
    }, {
      rule: ['noKeyName'],
      sql: 'UNIQUE KEY `abc` (abc)',
      exp: 'UNIQUE KEY (abc)'
    }, {
      rule: ['noKeyName'],
      sql: 'CONSTRAINT \`table_a_ibfk_1\` FOREIGN KEY (\`id\`) REFERENCES table_b (id) ON DELETE CASCADE ON UPDATE CASCADE',
      exp: 'FOREIGN KEY (\`id\`) REFERENCES table_b (id) ON DELETE CASCADE ON UPDATE CASCADE',
    }, {
      rule: ['noIndexName'],
      sql: 'UNIQUE KEY abc(abc)',
      exp: 'UNIQUE KEY(abc)'
    }, {
      rule: ['noIntLen'],
      sql: '`abc` tinyint(3) unsigned NOT NULL,',
      exp: '`abc` tinyint unsigned NOT NULL,'
    }, {
      rule: ['noIntLen', 'noBackQuote'],
      sql: '`abc` int(10) NOT NULL,',
      exp: 'abc int NOT NULL,'
    }, {
      rule: ['stringMultiLine'],
      sql: `abc int NOT NULL COMMENT 'line1\\nline2\nline3',`,
      exp: `abc int NOT NULL COMMENT 'line1\nline2\nline3',`
    }, {
      rule: ['stringInLine'],
      sql: `abc int NOT NULL COMMENT 'line1\\nline2\nline3',`,
      exp: `abc int NOT NULL COMMENT 'line1\\nline2\\nline3',`
    }, {
      rule: ['noBackQuote'],
      sql: '`abc` int(10) NOT NULL,',
      exp: 'abc int(10) NOT NULL,'
    }, {
      rule: ['noSpaceInBrackets'],
      sql: 'abc int( 10 ) NOT NULL,',
      exp: 'abc int(10) NOT NULL,'
    }, {
      rule: ['noSpaceBeforeBrackets'],
      sql: 'abc int (10) NOT NULL,',
      exp: 'abc int(10) NOT NULL,'
    }, {
      rule: ['noSpaceAfterBrackets'],
      sql: 'abc int (10) NOT NULL,',
      exp: 'abc int (10)NOT NULL,'
    }, {
      rule: ['spaceBeforeBrackets'],
      sql: 'abc int(10) NOT NULL,',
      exp: 'abc int (10) NOT NULL,'
    }, {
      rule: ['spaceAfterBrackets'],
      sql: 'abc int(10)NOT NULL,',
      exp: 'abc int(10) NOT NULL,'
    }, {
      rule: ['spaceBeforeComma'],
      sql: 'key(a,b,c) NOT NULL,',
      exp: 'key(a ,b ,c) NOT NULL ,',
    }, {
      rule: ['spaceAfterComma'],
      sql: 'key(a,  b,c) NOT NULL,\nkey(a,b,c) NOT NULL,',
      exp: 'key(a, b, c) NOT NULL,\nkey(a, b, c) NOT NULL,',
    }, {
      rule: ['noSpaceWrapBrackets'],
      sql: 'abc int (10) NOT NULL,',
      exp: 'abc int(10)NOT NULL,'
    }, {
      rule: ['spaceWrapBrackets'],
      sql: 'abc int(10)NOT NULL,',
      exp: 'abc int (10) NOT NULL,'
    }, {
      rule: ['noSpaceAfterBrackets'],
      sql: 'abc int (10) NOT NULL,',
      exp: 'abc int (10)NOT NULL,'
    }, {
      rule: ['noSpaceWrapEqual'],
      sql: 'ENGINE = InnoDB DEFAULT CHARSET= utf8;',
      exp: 'ENGINE=InnoDB DEFAULT CHARSET=utf8;'
    }, {
      rule: ['noTableCharset_utf8'],
      sql: 'ENGINE=InnoDB AUTO_INCREMENT=24557 DEFAULT CHARSET=utf8',
      exp: 'ENGINE=InnoDB AUTO_INCREMENT=24557',
    }, {
      rule: ['noTableCharset_utf8mb4'],
      sql: 'ENGINE=InnoDB AUTO_INCREMENT=24557 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci',
      exp: 'ENGINE=InnoDB AUTO_INCREMENT=24557'
    }, {
      rule: ['noAutoIncrement'],
      sql: 'ENGINE=InnoDB AUTO_INCREMENT=24557 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci',
      exp: 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci'
    }, {
      rule: ['intValueNoQuote'],
      sql: `abc tinyint(3) unsigned NOT NULL DEFAULT '0',`,
      exp: 'abc tinyint(3) unsigned NOT NULL DEFAULT 0,'
    }, {
      rule: ['uppercase'],
      sql: `abc char(13) not null default 'default',`,
      exp: `abc char(13) NOT NULL DEFAULT 'default',`
    }, {
      rule: ['noForeignAutoKey', 'indent2'],
      sql: 'CREATE TABLE table_a (\n'
        + '  id bigint(20) unsigned NOT NULL,\n'
        + '  value varchar(255) NOT NULL,\n'
        + '  KEY(id),\n'
        + '  CONSTRAINT \`table_a_ibfk_1\` FOREIGN KEY (\`id\`) REFERENCES table_b (id) ON DELETE CASCADE ON UPDATE CASCADE\n'
        + ') ENGINE = InnoDB DEFAULT CHARSET = utf8; ',
      exp: 'CREATE TABLE table_a (\n'
        + '  id bigint(20) unsigned NOT NULL,\n'
        + '  value varchar(255) NOT NULL,\n'
        + '  CONSTRAINT \`table_a_ibfk_1\` FOREIGN KEY (\`id\`) REFERENCES table_b (id) ON DELETE CASCADE ON UPDATE CASCADE\n'
        + ') ENGINE = InnoDB DEFAULT CHARSET = utf8;',
    }, {
      rule: ['simple'],
      sql: 'CREATE TABLE table_a (\n'
        + '  id bigint(20) unsigned NOT NULL,\n'
        + '  `value` varchar (255) NOT NULL,\n'
        + '  KEY(id),\n'
        + '  CONSTRAINT \`table_a_ibfk_1\` FOREIGN KEY (\`id\`) references table_b (id)  ON UPDATE CASCADE ON DELETE CASCADE\n'
        + ') ENGINE = InnoDB DEFAULT CHARSET = utf8; ',
      exp: 'CREATE TABLE table_a (\n'
        + '  id bigint unsigned NOT NULL,\n'
        + '  value varchar(255) NOT NULL,\n\n'
        + '  FOREIGN KEY (id) REFERENCES table_b (id) ON DELETE CASCADE ON UPDATE CASCADE\n'
        + ') ENGINE=InnoDB DEFAULT CHARSET=utf8;',
    },
    ]
    testData.forEach(({ rule, sql, exp }, i) => {
      it(`[${i}]` + rule.join(), function () {
        let format = sqlFormat.format(sql, rule)
        expect(format).to.be.equal(exp)
      })
    })
  })
})
