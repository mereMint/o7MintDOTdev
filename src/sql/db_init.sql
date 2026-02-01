-- Database Initialization

CREATE DATABASE IF NOT EXISTS mintdev_db;
USE mintdev_db;

-- Example Table: Users
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add more tables as needed for the Hub features
