'use strict'

module.exports = [
  `
  CREATE TABLE new1 (
    id int NOT NULL,
    val char(3) DEFAULT NULL COMMENT 'Can be null'
  ) ENGINE=InnoDB;
  
  
  CREATE TABLE new2 (
    id int NOT NULL,
    val int NOT NULL
  ) ENGINE=InnoDB;
  `
]