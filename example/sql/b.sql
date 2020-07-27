CREATE TABLE b1 (
  id int NOT NULL,
  val int NOT NULL,

  PRIMARY KEY (id) 
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


CREATE TABLE b2 (
  id int NOT NULL,
  val char(3) DEFAULT NULL COMMENT 'Can be null',

  FOREIGN KEY (id) REFERENCES a (id) 
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


CREATE TABLE b3 (
  id int NOT NULL,
  val int NOT NULL,

  FOREIGN KEY (id) REFERENCES a (id) 
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


