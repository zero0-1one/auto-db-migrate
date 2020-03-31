const mysql = require('mysql2/promise');

// create the connection to database

// 初始化数据库
// CREATE DATABASE IF NOT EXISTS `db_sync_test`;  CREATE DATABASE IF NOT EXISTS `__temp_sync__`;
//


const options = {
  'host': 'localhost',
  'user': 'root',
  'password': '1',
  'database': 'db_sync_test',
}

const tempOptions = {
  'host': 'localhost',
  'user': 'root',
  'password': '1',
  'database': '__temp_sync__',
}

class Db {
  constructor(opts) {
    this.opts = opts
    this.db = null
  }

  async query(...args) {
    if (!this.db) this.db = await mysql.createConnection(this.opts)
    return (await this.db.query(...args))[0]
  }

  async close() {
    if (this.db) await this.db.end()
  }
}


let share = {
  db: null,
  tempDb: null,
}
module.exports = {
  //全局共享连接 通过 dbTools.close() 释放
  db: {
    async query(...args) {
      if (!share.db) share.db = mysql.createConnection(options)
      let db = await share.db
      return (await db.query(...args))[0]
    }
  },
  //全局共享连接 通过 dbTools.close() 释放
  tempDb: {
    async query(...args) {
      if (!share.tempDb) share.tempDb = mysql.createConnection(tempOptions)
      let db = await share.tempDb
      return (await db.query(...args))[0]
    }
  },

  getDb() {
    return new Db(options)
  },

  getTempDb() {
    return new Db(tempOptions)
  },

  async close() {
    let { db, tempDb } = share
    share.db = null
    share.tempDb = null
    if (db) await (await db).end()
    if (tempDb) await (await tempDb).end()
  }
}