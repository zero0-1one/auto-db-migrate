const mysql = require('mysql2/promise')

// create the connection to database
const tempDbPrefix = '__temp_sync__'
const msg = `数据库同步中, 临时数据库会反复清空重建多次, 为了防止配置失误. 必须使用一个以'${tempDbPrefix}'开头的数据库`

module.exports = class Db {
  constructor(opts) {
    this.opts = Object.assign({}, opts)
    // this.opts.multipleStatements = true
    this.database = opts.database
    this._db = null
  }

  async query(...args) {
    if (!this._db) this._db = await mysql.createConnection(this.opts)
    try {
      return (await this._db.query(...args))[0]
    } catch (e) {
      throw new Error(e.message + '\nsql:' + args[0])
    }
  }

  async close() {
    if (this._db) {
      await this._db.end()
      this._db = null
    }
  }

  // multipleStatements
  // async queryM(sqlArray) {
  //   if (sqlArray.length == 1) {
  //     return [await this.query(sqlArray[0])]
  //   } else {
  //     sqlArray = sqlArray.map(s => {
  //       s = s.trim()
  //       return s.endsWith(';') ? s : s + ';';
  //     })
  //     return await this.query(sqlArray.join('\n'))
  //   }
  // }

  async queryM(sqlArray) {
    let results = []
    for (const sql of sqlArray) {
      results.push(await this.query(sql))
    }
    return results
  }

  async offForeignKey(cb) {
    await this.query('SET FOREIGN_KEY_CHECKS = 0')
    try {
      await cb(this)
    } finally {
      await this.query('SET FOREIGN_KEY_CHECKS = 1')
    }
  }

  async transaction(cb) {
    try {
      if (!this._db) this._db = await mysql.createConnection(this.opts)
      await this._db.beginTransaction()
      let rt = await cb(this)
      await this._db.commit()
      return rt
    } catch (e) {
      if (this._db) await this._db.rollback()
      throw e
    }
  }

  static async transaction(options, cb) {
    let db = new Db(options)
    return db.transaction(cb).finally(() => {
      db.close()
    })
  }

  async checkTempDb() {
    let dbName = (await this.query('SELECT DATABASE() name'))[0]['name']
    if (dbName != this.database) throw new Error('当前连接的数据库被切换了')
    if (!dbName.startsWith(tempDbPrefix)) throw new Error(msg)
  }
}
