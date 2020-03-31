const mysql = require('mysql2/promise');

// create the connection to database
const tempDbPrefix = '__temp_sync__'
const msg = `数据库同步中, 临时数据库会反复清空重建多次, 为了防止配置失误. 必须使用一个以'${tempDbPrefix}'开头的数据库`

class Db {
  constructor(opts) {
    this.opts = opts
    this.database = opts.database
    this.db = null
  }

  async query(...args) {
    if (!this.db) this.db = await mysql.createConnection(this.opts)
    return (await this.db.query(...args))[0]
  }

  async close() {
    if (this.db) await this.db.end()
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

  async offForeignKey(db, cb) {
    await db.query('SET FOREIGN_KEY_CHECKS = 0')
    try {
      await cb()
    } finally {
      await db.query('SET FOREIGN_KEY_CHECKS = 1')
    }
  }

  async checkTempDb() {
    let dbName = (await this.query('SELECT DATABASE() name'))[0]['name']
    if (dbName != this.database) throw new Error('当前连接的数据库被切换了')
    if (!dbName.startsWith(tempDbPrefix)) throw new Error(msg)
  }
}

let share = {
  db: null,
  tempDb: null,
}
module.exports = {
  options: null,
  tempOptions: null,

  //全局共享连接 init 后可用, 通过 dbTools.close() 释放
  db: null,
  tempDb: null,

  init(options, tempOptions) {
    if (!tempOptions.database.startsWith(tempDbPrefix)) throw new Error(msg)
    this.close()
    this.options = options
    this.tempOptions = tempOptions
    this.db = new Db(options)
    this.tempDb = new Db(tempOptions)
  },

  getDb() {
    return new Db(options)
  },

  getTempDb() {
    return new Db(tempOptions)
  },

  async close() {
    if (this.db) {
      await this.db.close()
      this.db = null
    }
    if (this.tempDb) {
      await this.tempDb.close()
      this.tempDb = null
    }
  }
}