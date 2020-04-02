const mysql = require('mysql2/promise');

// create the connection to database
const tempDbPrefix = '__temp_sync__'
const msg = `数据库同步中, 临时数据库会反复清空重建多次, 为了防止配置失误. 必须使用一个以'${tempDbPrefix}'开头的数据库`

module.exports = class Db {
  constructor(opts) {
    this.opts = opts
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

  //会创建多个连接同时查询, 所以无法在事务中执行
  async batchQuery(argsArray) {
    const pool = mysql.createPool(Object.assign({
      waitForConnections: true,
      connectionLimit: 50,
      queueLimit: 0
    }, this.opts))
    let task = []
    for (let args of argsArray) {
      if (Array.isArray(args)) {//每个query一个参数 可用一维数组,
        task.push(pool.query(...args))
      } else {
        task.push(pool.query(args))
      }
    }
    let results = await Promise.all(task)
    await pool.end()
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
      await this._db.rollback()
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
