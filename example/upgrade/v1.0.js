'use strict'

//返回 upgrade 数组,按顺序执行, 只允许向后追加, 即使是取消上一步, 也应该是在最后追加一个 upgrade
//本地开发过程中频繁变化, 请使用 autoSync 功能, 等测试完成后, 将 autoSync 的内容追加到 upgrade 中
//所有 upgrade 执行都会在 `prefix_upgrade` 表中记录日志, 
//如果异常就会终止, 后续不再执行, 下次执行(重启服务器) 会从上次异常处重新尝试.
module.exports = [
  //最简单的是使用一个 SQL 字符串, 
  'CREATE TABLE a (id int PRIMARY KEY, val int)',

  //可以指定多条 SQL 语句, 使用 ';' 隔开. 他们拥有 [2], [2-1], [2-2], ...的默认序号
  `
  CREATE TABLE d (id int, val int);
  CREATE TABLE e (
    id int ,
    val int
  );
  `,

  //可以是 SQL 字符串数组,每个元素必须是但语句. 他们拥有 [3], [3-1], [3-2], ... 的默认序号
  [
    'CREATE TABLE b (id int, val int)',
    `CREATE TABLE c (
      id int, 
      val int COMMENT 'Can be null'
    )`,
  ],


  //可以使用一个异步函数
  async db => {
    // 函数内所有内容会自动在同一个事务中执行,(只有函数类型会自动开启事务)
    // 具有隐性 commit 的命令. 如 ALTER 语句, 应该放在外部独立字符串中
    await db.query('INSERT INTO a(id, val) values(1, 10)')
    await db.query('INSERT INTO a(id, val) values(2, 20)')
    // throw new Error('')   //如果抛异常 就会回滚上面两条语句
  },

  //可对象配置跟多详细内容
  {
    //与外部相同, 支持单语句,多语句字符串,数组或异步函数
    up: 'ALTER TABLE a RENAME TO aaa',
    //指定校验签名,  执行完本条 upgrade 会进行校验, 如果失败将终止执行
    sign: 'sha1|9a01c24317aebc687561242a427229da37c22dd5',
    //添加注释, 会记录进 `prefix_upgrade` 表中
    comment: 'RENAME TABLE a TO aaa',
  },
]