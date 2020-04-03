CREATE TABLE b1 (
  id int NOT NULL,
  val int NOT NULL,
  PRIMARY KEY (id) 
) ENGINE=InnoDB;


CREATE TABLE b2 (
  id int NOT NULL,
  val char(3) DEFAULT NULL COMMENT 'Can be null',
  FOREIGN KEY (id) REFERENCES a (id) 
) ENGINE=InnoDB;


CREATE TABLE b3 (
  id int NOT NULL,
  val int NOT NULL,
  FOREIGN KEY (id) REFERENCES a (id) 
) ENGINE=InnoDB;