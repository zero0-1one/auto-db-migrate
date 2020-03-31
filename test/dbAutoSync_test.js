const autoSync = require('../lib/dbAutoSync')
const { expect } = require('chai').use(require('chai-like'))
const path = require('path')
const dbTools = require('../lib/dbTools')
const util = require('../lib/util')


const options = {
  'host': 'localhost',
  'user': 'root',
  'password': '1',
  'database': '__temp_sync__a',
}

const tempOptions = {
  'host': 'localhost',
  'user': 'root',
  'password': '1',
  'database': '__temp_sync__b',
}
// 初始化数据库
// CREATE DATABASE IF NOT EXISTS `__temp_sync__a`;  CREATE DATABASE IF NOT EXISTS `__temp_sync__b`;
//
dbTools.init(options, tempOptions)
let { db, tempDb } = dbTools

async function createMigration(current, target) {
  if (current) {
    await autoSync.initTempDbByDir(db, path.join(__dirname, 'migration/sql/' + current))
  } else {
    await autoSync.clearTempDataBase(db)
  }
  if (target) {
    await autoSync.initTempDbByDir(tempDb, path.join(__dirname, 'migration/sql/' + target))
  } else {
    await autoSync.clearTempDataBase(tempDb)
  }
  return await autoSync.createMigration(db, tempDb)
}

describe('dbAutoSync 测试', function () {
  it('getTableGroup()', function () {
    let group = autoSync.getTableGroup(path.join(__dirname, 'sql'), 'test_')
    expect(group).to.be.deep.equal({
      a: ['a1', 'a2', 'a3'],
      b: ['b1', 'b2'],
    })
  })

  it('initTempDbByDir, clearTempDataBase, getCreateTables', async function () {
    await autoSync.initTempDbByDir(tempDb, path.join(__dirname, 'migration/sql/base'))
    let group = autoSync.getTableGroup(path.join(__dirname, 'migration/sql/base'))
    let tables = await autoSync.getCreateTables(tempDb)
    expect(Object.keys(tables).sort()).to.be.deep.equal(group.create.sort())

    await autoSync.clearTempDataBase(tempDb)
    let tables2 = await autoSync.getCreateTables(tempDb)
    expect(tables2).to.be.deep.equal({})
  })

  it('getTablesSignByDb, cloneStructToTempDb', async function () {
    await autoSync.initTempDbByDir(db, path.join(__dirname, 'migration/sql/base'))
    let dbSign = await autoSync.getTablesSignByDb(db)

    await autoSync.cloneStructToTempDb(db, tempDb)
    let tempDbSign = await autoSync.getTablesSignByDb(tempDb)

    expect(dbSign).to.be.equal(tempDbSign)
  })

  it('dataBaseDiff', async function () {
    await autoSync.clearTempDataBase(db)
    await autoSync.initTempDbByDir(tempDb, path.join(__dirname, 'migration/sql/base'))
    let diff = await autoSync.dataBaseDiff(db, tempDb)
    expect(diff).to.be.deep.like({ delTables: {}, diffTables: [] })
    expect(diff.addTables).to.have.all.keys(['table_a', 'table_b', 'table_c'])
    expect(diff.sameTables).to.be.deep.equal({})
    expect(diff.delTables).to.be.deep.equal({})

    diff = await autoSync.dataBaseDiff(tempDb, db)
    expect(diff).to.be.like({ addTables: {}, diffTables: [] })
    expect(diff.delTables).to.have.all.keys(['table_a', 'table_b', 'table_c'])
    expect(diff.sameTables).to.be.deep.equal({})
    expect(diff.addTables).to.be.deep.equal({})
  })

  describe('createMigration change table', function () {
    it('createMigration same', async function () {
      await autoSync.initTempDbByDir(db, path.join(__dirname, 'migration/sql/base'))
      await autoSync.cloneStructToTempDb(db, tempDb)
      let migration = await autoSync.createMigration(db, tempDb)
      expect(migration).to.be.deep.equal({
        up: [],
        down: [],
      })
    })

    it('createMigration add table', async function () {
      let migration = await createMigration('', 'base')
      let createTables = await autoSync.getCreateTables(tempDb)
      let exp = []
      for (const tableName in createTables) {
        exp.push(createTables[tableName])
      }
      expect(migration.up.sort()).to.be.deep.equal(exp.sort())
      expect(migration.down.sort()).to.be.deep.equal(
        ['table_a', 'table_b', 'table_c'].map(t => 'DROP TABLE `' + t + '`').sort()
      )
    })

    it('createMigration del table', async function () {
      let migration = await createMigration('base', '')
      let createTables = await autoSync.getCreateTables(db)
      let exp = []
      for (const tableName in createTables) {
        exp.push(createTables[tableName])
      }
      expect(migration.up.sort()).to.be.deep.equal(
        ['table_a', 'table_b', 'table_c'].map(t => 'DROP TABLE `' + t + '`').sort()
      )
      expect(migration.down.sort()).to.be.deep.equal(exp.sort())
    })

    it('createMigration rename table', async function () {
      let migration = await createMigration('base', 'rename')
      expect(migration).to.be.deep.equal({
        up: ['ALTER TABLE `table_c` RENAME TO `table_c2`'],
        down: ['ALTER TABLE `table_c2` RENAME TO `table_c`'],
      })
    })
  })



  //最后释放
  describe('释放db', function () {
    it('release db', async function () {
      await dbTools.close()
    })
  })
})