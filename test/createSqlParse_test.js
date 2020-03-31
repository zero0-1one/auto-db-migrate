const fs = require('fs')
const createSqlParser = require('../lib/createSqlParser')
const { expect } = require('chai').use(require('chai-like'))



describe('createSqlParser 测试', function () {
  it('parseCreateSql()', function () {
    let sql = fs.readFileSync(__dirname + '/sql/table_d.sql', 'utf8')
    let schema = createSqlParser.parseCreateSql(sql)
    expect(schema).to.be.deep.like({
      tableName: 'd',
      options: {},
      keys: {
        'primaryKey': { type: 'primaryKey', name: 'primaryKey', columns: ['d_id'] },
        'd_value': { type: 'key', name: 'd_value', columns: ['d_value'] },
        'd_ibfk_1': { type: 'foreignKey', name: 'd_ibfk_1', columns: ['d_id'], tableName: 'table', refColumns: ['id'] },
      },
      columns: {
        'd_id': { name: 'd_id', pos: 0 },
        'd_value': { name: 'd_value', pos: 1 }
      }
    })
  })
})