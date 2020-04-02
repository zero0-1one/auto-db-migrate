CREATE TABLE b1 ( 
  id int NOT NULL, 
  val int, 
  PRIMARY KEY (id) 
);


CREATE TABLE b2 ( 
  id int NOT NULL, 
  val char(3), 
  FOREIGN KEY (id) REFERENCES a (id) 
);


CREATE TABLE b3 ( 
  id int, 
  val int, 
  FOREIGN KEY (id) REFERENCES a (id) 
);


