-- Database Schema for MintDEV

CREATE DATABASE IF NOT EXISTS mintdev_db;
USE mintdev_db;

-- Users Table
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

-- Posts Table
CREATE TABLE IF NOT EXISTS posts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) DEFAULT 'Anonymous',
    content VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Scores Table (Updated for Flexible Leaderboards with avatar caching)
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

-- User Achievements Table
CREATE TABLE IF NOT EXISTS user_achievements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    game_id VARCHAR(255) NOT NULL,
    achievement_id VARCHAR(255) NOT NULL,
    unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_unlock (username, game_id, achievement_id)
);

-- Saved Games Table (Generic save system)
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

-- =============================================
-- Explain-TM Wiki System Tables
-- =============================================

-- Article Categories
CREATE TABLE IF NOT EXISTS explain_categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description VARCHAR(500),
    color VARCHAR(7) DEFAULT '#1DCD9F',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Articles (Main content)
-- Note: FULLTEXT index requires InnoDB engine (MariaDB 10.0.5+ / MySQL 5.6+)
CREATE TABLE IF NOT EXISTS explain_articles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    slug VARCHAR(255) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    category_id INT,
    author VARCHAR(255) NOT NULL,
    views INT DEFAULT 0,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES explain_categories(id) ON DELETE SET NULL,
    INDEX idx_status (status),
    INDEX idx_views (views DESC),
    INDEX idx_category (category_id),
    FULLTEXT INDEX idx_search (title, content)
) ENGINE=InnoDB;

-- Article Edit History (For revisions and moderation)
CREATE TABLE IF NOT EXISTS explain_revisions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    article_id INT NOT NULL,
    content TEXT NOT NULL,
    editor VARCHAR(255) NOT NULL,
    edit_summary VARCHAR(500),
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (article_id) REFERENCES explain_articles(id) ON DELETE CASCADE,
    INDEX idx_article_status (article_id, status)
);

-- Rate limiting for anti-spam
CREATE TABLE IF NOT EXISTS explain_rate_limits (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ip_address VARCHAR(45) NOT NULL,
    action_type ENUM('create', 'edit') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ip_action (ip_address, action_type, created_at)
);

-- Insert default categories
INSERT IGNORE INTO explain_categories (name, description, color) VALUES
    ('General', 'General topics and miscellaneous articles', '#1DCD9F'),
    ('Gaming', 'Video games, game mechanics, and gaming culture', '#FF6B6B'),
    ('Technology', 'Tech, programming, and digital topics', '#4ECDC4'),
    ('Science', 'Scientific concepts and discoveries', '#45B7D1'),
    ('Culture', 'Internet culture, memes, and trends', '#96CEB4'),
    ('Tutorial', 'How-to guides and tutorials', '#FFEAA7');

