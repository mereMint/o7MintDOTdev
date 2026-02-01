-- Database Schema for MintDEV

CREATE DATABASE IF NOT EXISTS mintdev_db;
USE mintdev_db;

-- Posts Table
CREATE TABLE IF NOT EXISTS posts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Scores Table (Updated for Flexible Leaderboards)
CREATE TABLE IF NOT EXISTS scores (
    id INT AUTO_INCREMENT PRIMARY KEY,
    game_id VARCHAR(50) NOT NULL,
    board_id VARCHAR(50) DEFAULT 'main',
    username VARCHAR(255) NOT NULL,
    score INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_game_board_score (game_id, board_id, score DESC)
);

-- User Achievements Table
CREATE TABLE IF NOT EXISTS user_achievements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    game_id VARCHAR(50) NOT NULL,
    achievement_id VARCHAR(50) NOT NULL,
    unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_unlock (username, game_id, achievement_id)
);

-- Saved Games Table (NEW generic save system)
CREATE TABLE IF NOT EXISTS saved_games (
    id INT AUTO_INCREMENT PRIMARY KEY,
    save_id VARCHAR(100) NOT NULL UNIQUE, -- Combination of game_user_slot
    game_id VARCHAR(50) NOT NULL,
    username VARCHAR(255) NOT NULL,
    slot_id VARCHAR(50) NOT NULL DEFAULT 'auto', 
    label VARCHAR(100),
    data JSON NOT NULL, -- The actual save state
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_game (username, game_id)
);
