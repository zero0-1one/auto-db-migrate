let example = require('../example/example')
let Db = require('../lib/db')
let options = require('../example/options')

describe('example 测', function () {
  it('run example', async function () {
    await Db.transaction(options.db, async db => {
      await db.query(`DROP DATABASE IF EXISTS ${db.database}`)
      await db.query(`CREATE DATABASE ${db.database}`)
    })
    await example.onServerStart()
  })
})