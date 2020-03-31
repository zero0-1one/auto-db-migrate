CREATE TABLE `d` (
  `d_id` int(20) NOT NULL AUTO_INCREMENT,
  `d_value` int(11) NOT NULL,
  PRIMARY KEY (`d_id`),
  KEY`d_value`(`d_value`),
  CONSTRAINT `d_ibfk_1` FOREIGN KEY (`d_id`) REFERENCES `table` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
