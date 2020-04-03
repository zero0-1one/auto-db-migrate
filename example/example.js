'use strict'

const Migration = require('../')
const options = require('./options')


module.exports = {
  async run() {
    let migration = new Migration(options)
    await migration.upgrade()
  }
}
