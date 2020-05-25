const AutoSync = require('../lib/autoSync')
const { expect } = require('chai').use(require('chai-like'))
const path = require('path')
const Db = require('../lib/db')
const Migration = require('../lib/migration')

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

describe('migration 测试', function () {
  let db = null
  let tempDb = null
  it('初始 db', async function () {
    db = new Db(options)
    tempDb = new Db(tempOptions)
  })

  it('upgrade', async function () {
    await autoSync.clearTempDataBase(db)
    let migration = new Migration({
      db: options,
      tempDb: tempOptions,
      logs: false,
      dir: path.join(__dirname, '../example'),
    })
    migration.rmdir(migration.outDir())
    await migration.upgrade()
  })

  it('upgrade and autoSync', async function () {
    await autoSync.clearTempDataBase(db)
    let migration = new Migration({
      db: options,
      tempDb: tempOptions,
      autoSync: 'auto',
      logs: false,
      dir: path.join(__dirname, '../example'),
    })
    migration.rmdir(migration.outDir())
    await migration.upgrade()
  })

  it('upgrade and autoSyncBack', async function () {
    await autoSync.clearTempDataBase(db)
    let opts = {
      db: options,
      tempDb: tempOptions,
      logs: false,
      autoSync: 'auto',
      dir: path.join(__dirname, '../example'),
    }
    let migration = new Migration(opts)
    migration.rmdir(migration.outDir())
    await migration.upgrade()

    opts.upgradeDir = 'upgrade2'
    let migration2 = new Migration(opts)
    await migration2.upgrade()
  })

  it('format by dir', async function () {
    let migration = new Migration({
      db: options,
      tempDb: tempOptions,
      logs: false,
      autoSync: 'auto',
      dir: path.join(__dirname, '../example'),
    })
    migration.rmdir(migration.outDir())
    await migration.format()
  })

  it('format by db', async function () {
    let migration = new Migration({
      db: options,
      tempDb: tempOptions,
      logs: false,
      autoSync: 'auto',
      dir: path.join(__dirname, '../example'),
      formatByDb: true,
      formatRules: ['simple', 'noTableCharset'],
    })
    migration.rmdir(migration.outDir())
    await migration.format()
  })

  describe('释放 db', async function () {
    it('release db', async function () {
      db.close()
      tempDb.close()
    })
  })
})
