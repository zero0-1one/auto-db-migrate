'use strict'

module.exports = [
  //最简单的是使用一个 SQL 字符串, 
  'CREATE TABLE a (id int PRIMARY KEY, val int)',

  //可以指定多条 SQL 语句, 使用 ';' 隔开. 他们拥有 [1], [1-1], [1-2], ...的默认序号
  `
  CREATE TABLE d (id int, val int);
  CREATE TABLE e (
    id int ,
    val int
  );
  `,

  //可以是 SQL 字符串数组,每个元素必须是单语句(不能是多语句或函数). 他们拥有 [2], [2-1], [2-2], ... 的默认序号
  [
    'CREATE TABLE b (id int, val int)',
    `CREATE TABLE c (
      id int, 
      val int COMMENT 'Can be null'
    )`,
  ],


  //可以使用一个异步函数 它会接受到一个 db 参数, 注意函数只能单独使用, 不能放入数组
  async db => {
    // 函数内所有内容会自动在同一个事务中执行,(只有函数类型会自动开启事务)
    // 具有隐性 commit 的命令. 如 ALTER 语句, 应该放在外部独立字符串中
    await db.query('INSERT INTO a(id, val) values(1, 10)')
    await db.query('INSERT INTO a(id, val) values(2, 20)')
    // throw new Error('')   //如果抛异常 就会回滚上面两条语句
  },

  //可对象配置更多详细内容
  {
    //与外部相同, 支持单语句,多语句字符串,数组或异步函数
    up: 'ALTER TABLE a RENAME TO aaa',

    //添加注释, 会记录进 `prefix_upgrade` 表中
    comment: 'RENAME TABLE a TO aaa',
  },
]