const AutoSync = require('../lib/autoSync')
const { expect } = require('chai').use(require('chai-like'))
const path = require('path')
const Db = require('../lib/db')
const Migration = require('../lib/migration')
const { copyFileSync } = require('fs')

const options = {
  'host': 'localhost',
  'user': 'root',
  'password': '',
  'database': '__temp_sync__db',
}

const tempOptions = {
  'host': 'localhost',
  'user': 'root',
  'password': '',
  'database': '__temp_sync__temp_db',
}
const EXAMPLE_DIR = '../example'
const VERSION_1_0 = '1.0'
const UPGRADE_1_0 = `upgrade_${VERSION_1_0}`
let autoSync = new AutoSync()

describe.skip('upgrade 测试', function () {
  let db = null
  let tempDb = null
  before(async function () {
    db = new Db(options)
    tempDb = new Db(tempOptions)
    await autoSync.clearTempDataBase(db)
    await autoSync.clearTempDataBase(tempDb)
  })

  after(async function () {
    db.close()
    tempDb.close()
  })
  it('init database', async function () {
    let migration = new Migration({
      db: options,
      tempDb: tempOptions,
      logs: false,
      dir: path.join(__dirname, EXAMPLE_DIR),
    })
    migration.rmdir(migration.outDir())
    await migration.autoSync()
  })
  it('add tables', async function () {

    let migration = new Migration({
      db: options,
      tempDb: tempOptions,
      logs: false,
      dir: path.join(__dirname, EXAMPLE_DIR),
      sqlDir: 'sql_' + VERSION_1_0
    })
    await migration.autoSync()
    const updatePath = path.join(__dirname, EXAMPLE_DIR, UPGRADE_1_0)
    copyFileSync(
      migration.autoSyncFilePath('autoUpgrade'),
      path.join(updatePath, `v${VERSION_1_0}.js`)
    )
    migration.rmdir(migration.outDir())
  })
  it('upgrade from js', async function() {
    await autoSync.clearTempDataBase(db)
    await autoSync.clearTempDataBase(tempDb)
    const opts = {
      db: options,
      tempDb: tempOptions,
      logs: false,
      dir: path.join(__dirname, EXAMPLE_DIR),
    }
    let migration = new Migration(opts)
    migration.rmdir(migration.outDir())
    await migration.autoSync()

    opts.upgradeDir = UPGRADE_1_0
    let migration2 = new Migration(opts)
    await migration2.upgrade()
    migration.rmdir(migration.outDir())
  })
 
})
