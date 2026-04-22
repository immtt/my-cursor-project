CREATE TABLE IF NOT EXISTS sys_suggest (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  route_date DATE NOT NULL,
  waybill_no VARCHAR(50) NOT NULL,
  route_line VARCHAR(100) NOT NULL,
  warehouse_name VARCHAR(200) NOT NULL,
  stores TEXT NOT NULL,
  volume DECIMAL(10,2) NOT NULL,
  load_rate DECIMAL(5,2) NOT NULL,
  est_distance DECIMAL(10,2) NOT NULL,
  est_duration INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sys_route_date(route_date)
);

CREATE TABLE IF NOT EXISTS manual_route (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  route_date DATE NOT NULL,
  waybill_no VARCHAR(50) NOT NULL,
  route_line VARCHAR(100) NOT NULL,
  warehouse_name VARCHAR(200) NOT NULL,
  stores TEXT NOT NULL,
  volume DECIMAL(10,2) NOT NULL,
  load_rate DECIMAL(5,2) NOT NULL,
  est_distance DECIMAL(10,2) NULL,
  est_duration INT NULL,
  calc_status TINYINT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_manual_route_date(route_date)
);

CREATE TABLE IF NOT EXISTS address_cache (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  address_name VARCHAR(200) NOT NULL UNIQUE,
  address_type VARCHAR(20) NOT NULL,
  longitude DECIMAL(10,6) NOT NULL,
  latitude DECIMAL(10,6) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS compare_result (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  route_date DATE NOT NULL,
  sys_id BIGINT NULL,
  manual_id BIGINT NULL,
  match_status VARCHAR(20) NOT NULL,
  store_match_rate DECIMAL(5,2) NOT NULL,
  volume_diff_rate DECIMAL(10,2) NULL,
  line_consistent TINYINT DEFAULT 0,
  est_distance_diff DECIMAL(10,2) NULL,
  est_duration_diff INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_compare_route_date(route_date)
);
