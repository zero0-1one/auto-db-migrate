const AutoSync = require('../lib/autoSync')
const { expect } = require('chai').use(require('chai-like'))
const path = require('path')
const Db = require('../lib/db')
// const util = require('../lib/util')

const options = {
  'host': 'localhost',
  'user': 'root',
  'password': '1',
  'database': '__temp_sync__db',
}

const tempOptions = {
  'host': 'localhost',
  'user': 'root',
  'password': '1',
  'database': '__temp_sync__temp_db',
}


let autoSync = new AutoSync()
describe('autoSync 测试', function () {
  let db = null
  let tempDb = null
  async function createMigration(current, target) {
    if (current) {
      await autoSync.initTempDbByDir(db, path.join(__dirname, 'sql/' + current))
    } else {
      await autoSync.clearTempDataBase(db)
    }
    if (target) {
      await autoSync.initTempDbByDir(tempDb, path.join(__dirname, 'sql/' + target))
    } else {
      await autoSync.clearTempDataBase(tempDb)
    }
    let { migration, succeed } = await autoSync.createMigrationByDb(db, tempDb)
    if (!succeed) throw new Error()
    return migration
  }

  it('init dbTools', function () {
    db = new Db(options)
    tempDb = new Db(tempOptions)
  })

  it('getTableGroup()', function () {
    let group = autoSync.getTableGroup(path.join(__dirname, 'sql'), 'test_')
    expect(group).to.be.deep.like({
      a: [{ tableName: 'a1' }, { tableName: 'a2' }, { tableName: 'a3' }],
      b: [{ tableName: 'b1' }, { tableName: 'b2' }],
    })
  })

  it('initTempDbByDir, clearTempDataBase, getCreateTables', async function () {
    await autoSync.initTempDbByDir(tempDb, path.join(__dirname, 'sql/base'))
    let group = autoSync.getTableGroup(path.join(__dirname, 'sql/base'))
    let tables = await autoSync.getCreateTables(tempDb)
    let exp = group.create.map(v => v.tableName).sort()
    expect(Object.keys(tables).sort()).to.be.deep.equal(exp)

    await autoSync.clearTempDataBase(tempDb)
    let tables2 = await autoSync.getCreateTables(tempDb)
    expect(tables2).to.be.deep.equal({})
  })

  it('getTablesSignByDb, cloneStructToTempDb', async function () {
    await autoSync.initTempDbByDir(db, path.join(__dirname, 'sql/base'))
    let dbSign = await autoSync.getTablesSignByDb(db)
    await autoSync.cloneStructToTempDb(db, tempDb)
    let tempDbSign = await autoSync.getTablesSignByDb(tempDb)

    expect(dbSign).to.be.equal(tempDbSign)
  })

  it('dataBaseDiff', async function () {
    await autoSync.clearTempDataBase(db)
    await autoSync.initTempDbByDir(tempDb, path.join(__dirname, 'sql/base'))
    let diff = await autoSync.dataBaseDiff(db, tempDb)
    expect(diff).to.be.deep.like({ delTables: {}, changeTables: [] })
    expect(diff.addTables).to.have.all.keys(['table_a', 'table_b', 'table_c'])
    expect(diff.delTables).to.be.deep.equal({})

    diff = await autoSync.dataBaseDiff(tempDb, db)
    expect(diff).to.be.like({ addTables: {}, changeTables: [] })
    expect(diff.delTables).to.have.all.keys(['table_a', 'table_b', 'table_c'])
    expect(diff.addTables).to.be.deep.equal({})
  })

  describe('createMigration change table', function () {
    it('createMigration same', async function () {
      await autoSync.initTempDbByDir(db, path.join(__dirname, 'sql/base'))
      await autoSync.cloneStructToTempDb(db, tempDb)
      let results = await autoSync.createMigrationByDb(db, tempDb)
      expect(results).to.be.deep.like({ succeed: true, migration: [] })
    })

    it('createMigration add table', async function () {
      let migration = await createMigration('', 'base')
      let createTables = await autoSync.getCreateTables(tempDb)
      let exp = []
      for (const tableName in createTables) {
        exp.push(createTables[tableName])
      }
      expect(migration.sort()).to.be.deep.equal(exp.sort())
    })

    it('createMigration del table', async function () {
      let migration = await createMigration('base', '')
      let createTables = await autoSync.getCreateTables(db)
      let exp = []
      for (const tableName in createTables) {
        exp.push(createTables[tableName])
      }
      expect(migration.sort()).to.be.deep.equal(
        ['table_a', 'table_b', 'table_c'].map(t => 'DROP TABLE `' + t + '`').sort()
      )
    })

    it('createMigration rename table', async function () {
      let migration = await createMigration('base', 'rename')
      expect(migration).to.be.deep.like([
        'ALTER TABLE `table_c` RENAME TO `table_c2`',
        'ALTER TABLE `table_a` ADD COLUMN `a_value1` char(12) NOT NULL DEFAULT \'\' AFTER `a_id`',
        'ALTER TABLE `table_a` CHANGE COLUMN `a_value` `a_value2` int(11) NOT NULL AFTER `a_value1`',
        'ALTER TABLE `table_a` RENAME KEY `a_value` TO `a_value2`'
      ])
    })
  })



  //最后释放
  describe('释放db', function () {
    it('release db', async function () {
      db.close()
      tempDb.close()
    })
  })
})