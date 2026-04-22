CREATE TABLE IF NOT EXISTS sys_suggest (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  route_date DATE NOT NULL,
  waybill_no VARCHAR(50) NOT NULL,
  route_line VARCHAR(100) NOT NULL,
  warehouse_name VARCHAR(200) NOT NULL,
  stores TEXT NOT NULL,
  vehicle_type VARCHAR(100) NOT NULL DEFAULT '',
  volume DECIMAL(10,2) NOT NULL,
  load_rate DECIMAL(5,2) NOT NULL,
  est_distance DECIMAL(10,2) NOT NULL,
  est_duration INT NOT NULL,
  route_polyline MEDIUMTEXT NULL,
  batch_id VARCHAR(64) NOT NULL,
  is_active TINYINT NOT NULL DEFAULT 1,
  import_operator VARCHAR(64) NULL,
  imported_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sys_route_date(route_date),
  INDEX idx_sys_active(route_date, is_active)
);

CREATE TABLE IF NOT EXISTS manual_route (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  route_date DATE NOT NULL,
  waybill_no VARCHAR(50) NOT NULL,
  route_line VARCHAR(100) NOT NULL,
  warehouse_name VARCHAR(200) NOT NULL,
  stores TEXT NOT NULL,
  vehicle_type VARCHAR(100) NOT NULL DEFAULT '',
  volume DECIMAL(10,2) NOT NULL,
  load_rate DECIMAL(5,2) NOT NULL,
  est_distance DECIMAL(10,2) NULL,
  est_duration INT NULL,
  route_polyline MEDIUMTEXT NULL,
  delivery_store_order MEDIUMTEXT NULL,
  calc_status TINYINT DEFAULT 0,
  batch_id VARCHAR(64) NOT NULL,
  is_active TINYINT NOT NULL DEFAULT 1,
  import_operator VARCHAR(64) NULL,
  imported_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_manual_route_date(route_date),
  INDEX idx_manual_active(route_date, is_active)
);

CREATE TABLE IF NOT EXISTS address_cache (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  address_name VARCHAR(200) NOT NULL UNIQUE,
  address_type VARCHAR(20) NOT NULL,
  longitude DECIMAL(10,6) NOT NULL,
  latitude DECIMAL(10,6) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS store_coordinate (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  store_name VARCHAR(300) NOT NULL,
  longitude DOUBLE NOT NULL,
  latitude DOUBLE NOT NULL,
  data_source VARCHAR(120) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_store_coordinate_name (store_name),
  INDEX idx_store_coordinate_name (store_name)
);

CREATE TABLE IF NOT EXISTS store_pair_distance (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  store_from VARCHAR(300) NOT NULL,
  store_to VARCHAR(300) NOT NULL,
  distance_km DOUBLE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_store_pair_from_to (store_from, store_to)
);

CREATE TABLE IF NOT EXISTS compare_result (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  route_date DATE NOT NULL,
  sys_id BIGINT NULL,
  manual_id BIGINT NULL,
  match_status VARCHAR(20) NOT NULL,
  store_match_rate DECIMAL(5,2) NOT NULL,
  match_score DECIMAL(8,4) NOT NULL,
  volume_diff DECIMAL(10,2) NULL,
  line_consistent TINYINT DEFAULT 0,
  est_distance_diff DECIMAL(10,2) NULL,
  est_duration_diff INT NULL,
  run_batch_id VARCHAR(64) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_compare_route_date(route_date)
);

CREATE TABLE IF NOT EXISTS import_audit_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  batch_id VARCHAR(64) NOT NULL,
  dataset_type VARCHAR(16) NOT NULL,
  route_date DATE NOT NULL,
  operator VARCHAR(64) NULL,
  total_rows INT NOT NULL,
  success_rows INT NOT NULL,
  failed_rows INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_import_audit_date(route_date)
);

CREATE TABLE IF NOT EXISTS compare_run_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  run_batch_id VARCHAR(64) NOT NULL,
  route_date DATE NOT NULL,
  operator VARCHAR(64) NULL,
  duration_ms BIGINT NOT NULL,
  result_count INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_compare_run_date(route_date)
);

CREATE TABLE IF NOT EXISTS gaode_calc_failure_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  manual_id BIGINT NOT NULL,
  route_date DATE NOT NULL,
  failed_store VARCHAR(200) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  retry_count INT NOT NULL DEFAULT 0,
  last_retry_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_gaode_failure_date(route_date)
);
