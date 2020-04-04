'use strict'

const Migration = require('../')
const options = require('./options')


module.exports = {
  async onServerStart() {
    let migration = new Migration(options)
    await migration.upgrade()
  }
}
