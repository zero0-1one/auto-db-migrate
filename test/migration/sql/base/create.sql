
CREATE TABLE table_b (
  b_id int NOT NULL AUTO_INCREMENT,
  b_value int NOT NULL,
  FOREIGN KEY (b_id) REFERENCES table_a (a_id) ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE table_c (
  c_id int NOT NULL AUTO_INCREMENT,
  c_value int NOT NULL,
  UNIQUE KEY (c_value),
  FOREIGN KEY (c_id) REFERENCES table_a (a_id) ON UPDATE CASCADE
) ENGINE=InnoDB;



CREATE TABLE table_a (
  a_id int NOT NULL AUTO_INCREMENT,
  a_value int NOT NULL,
  PRIMARY KEY (a_id),
  KEY(a_value)
) ENGINE=InnoDB;
