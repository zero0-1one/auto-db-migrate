const fs = require('fs')
const sqlParser = require('../lib/sqlParser')
const { expect } = require('chai').use(require('chai-like'))



describe('sqlParser 测试', function () {
  it('parseCreateSql()', function () {
    let sql = fs.readFileSync(__dirname + '/sql/table_d.sql', 'utf8')
    let schema = sqlParser.parseCreateSql(sql.trim())
    expect(schema).to.be.deep.like({
      tableName: 'd',
      header: {},
      options: {
        'ENGINE': "InnoDB",
        'DEFAULT CHARSET': "utf8"
      },
      keys: {
        'primaryKey': { type: 'primaryKey', name: 'primaryKey', columns: [`d_id`] },
        'd_value': { type: 'key', name: 'd_value', columns: ['d_value'] },
        'd_id': { type: 'key', name: 'd_id', columns: ['d_id', 'd_value'] },
        'd_ibfk_1': { type: 'foreignKey', name: 'd_ibfk_1', columns: ['d_id'], tableName: 'table', refColumns: ['id'] },
      },
      columns: {
        'd_id': { name: 'd_id', pos: 0, pre: null, next: { name: 'd_value' } },
        'd_value': { name: 'd_value', pos: 1, pre: { name: 'd_id' }, next: null }
      }
    })
  })
})