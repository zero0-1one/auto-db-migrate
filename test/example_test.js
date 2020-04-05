const example = require('../example/example')
const Db = require('../lib/db')
const options = require('../example/options')
const Migration = require('../lib/migration')

describe('example 测', function () {
  it('run example', async function () {
    let migration = new Migration(options)
    migration.rmdir(migration.outDir())
    await Db.transaction(options.db, async db => {
      await db.query(`DROP DATABASE IF EXISTS ${db.database}`)
      await db.query(`CREATE DATABASE ${db.database}`)
    })
    await example.onServerStart()
  })
})