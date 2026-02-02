-- Database Initialization

CREATE DATABASE IF NOT EXISTS mintdev_db;
USE mintdev_db;

-- Table: Users
CREATE TABLE IF NOT EXISTS users (
    username VARCHAR(255) PRIMARY KEY,
    discord_id VARCHAR(255),
    avatar VARCHAR(255),
    points INT DEFAULT 0,
    inventory JSON,
    decoration VARCHAR(50) DEFAULT NULL,
    bio VARCHAR(500) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Table: Posts
CREATE TABLE IF NOT EXISTS posts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) DEFAULT 'Anonymous',
    content VARCHAR(255) NOT NULL,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'approved',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: Scores (with avatar caching for leaderboard)
CREATE TABLE IF NOT EXISTS scores (
    id INT AUTO_INCREMENT PRIMARY KEY,
    game_id VARCHAR(50) NOT NULL,
    board_id VARCHAR(50) DEFAULT 'main',
    username VARCHAR(255) DEFAULT 'Anonymous',
    score INT NOT NULL,
    discord_id VARCHAR(255),
    avatar VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_game_board_score (game_id, board_id, score DESC)
);

-- Table: User Achievements
CREATE TABLE IF NOT EXISTS user_achievements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    game_id VARCHAR(255) NOT NULL,
    achievement_id VARCHAR(255) NOT NULL,
    unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_unlock (username, game_id, achievement_id)
);

-- Table: Saved Games
CREATE TABLE IF NOT EXISTS saved_games (
    id INT AUTO_INCREMENT PRIMARY KEY,
    save_id VARCHAR(100) NOT NULL UNIQUE,
    game_id VARCHAR(50) NOT NULL,
    username VARCHAR(255) NOT NULL,
    slot_id VARCHAR(50) NOT NULL DEFAULT 'auto',
    label VARCHAR(100),
    data JSON NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_game (username, game_id)
);
