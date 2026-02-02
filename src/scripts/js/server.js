const express = require('express');
const mariadb = require('mariadb');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const axios = require('axios');

const app = express();
const PORT = 8000;

// Env Vars
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;

let authEnabled = true;

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI || CLIENT_ID === "your_client_id_here") {
    console.warn("⚠️  Discord Auth credentials missing or default in .env");
    console.warn("   Discord Login will be disabled. Using Dev Mode is recommended.");
    authEnabled = false;
}

console.log(`Auth Enabled: ${authEnabled}`);

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('.')); // Serve static files from root (process.cwd)

// Database Connection Pool
const pool = mariadb.createPool({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'mintdev_db',
    connectionLimit: 5
});

// State
let useInMemory = false;
let memoryPosts = [];

// Initialize Connection
pool.getConnection()
    .then(async conn => {
        console.log("✅ Database connected successfully.");

        // Ensure Tables Exist
        try {
            await conn.query(`
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
                )
            `);
            await conn.query(`
                CREATE TABLE IF NOT EXISTS user_achievements (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(255) NOT NULL,
                    game_id VARCHAR(255) NOT NULL,
                    achievement_id VARCHAR(255) NOT NULL,
                    unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY unique_unlock (username, game_id, achievement_id)
                )
            `);
            // Ensure posts table exists
            await conn.query(`
                CREATE TABLE IF NOT EXISTS posts (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(255) DEFAULT 'Anonymous',
                    content VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            // Ensure scores table exists with avatar columns
            await conn.query(`
                CREATE TABLE IF NOT EXISTS scores (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    game_id VARCHAR(50),
                    username VARCHAR(255),
                    score INT,
                    board_id VARCHAR(50) DEFAULT 'main',
                    discord_id VARCHAR(255),
                    avatar VARCHAR(255),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            // Ensure saved_games table exists
            await conn.query(`
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
                )
            `);
            console.log("✅ Tables verified/created.");

            // Migrations: Ensure columns exist (for existing tables)
            try {
                // MariaDB 10.2+ supports IF NOT EXISTS in ADD COLUMN
                await conn.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS points INT DEFAULT 0");
                await conn.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS inventory JSON");
                await conn.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS decoration VARCHAR(50) DEFAULT NULL");
                await conn.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS bio VARCHAR(500) DEFAULT NULL");
                await conn.query("ALTER TABLE scores ADD COLUMN IF NOT EXISTS discord_id VARCHAR(255)");
                await conn.query("ALTER TABLE scores ADD COLUMN IF NOT EXISTS avatar VARCHAR(255)");
                
                // Migration for user_achievements: ensure id column exists
                // Check if id column already exists before attempting migration
                try {
                    const columns = await conn.query("SHOW COLUMNS FROM user_achievements LIKE 'id'");
                    if (columns.length === 0) {
                        // id column doesn't exist - this is an old table that needs migration
                        // Drop the old primary key and add the new id column
                        try {
                            await conn.query("ALTER TABLE user_achievements DROP PRIMARY KEY");
                        } catch (pkErr) {
                            // Primary key may not exist or already dropped
                        }
                        await conn.query("ALTER TABLE user_achievements ADD COLUMN id INT AUTO_INCREMENT PRIMARY KEY FIRST");
                        // Add unique key for the original columns if not exists
                        try {
                            await conn.query("ALTER TABLE user_achievements ADD UNIQUE KEY unique_unlock (username, game_id, achievement_id)");
                        } catch (ukErr) {
                            // Unique key may already exist
                        }
                        console.log("✅ user_achievements table migrated to include id column.");
                    }
                } catch (achMigErr) {
                    console.warn("user_achievements migration skipped:", achMigErr.message);
                }
                
                console.log("✅ Schema Migrations applied.");
            } catch (migErr) {
                // Fallback for older versions or if syntax fails: verify manually
                console.warn("Migration warning (safe to ignore if columns exist):", migErr.message);
            }

        } catch (e) {
            console.error("Table Init Error:", e);
        }

        conn.release();
    })
    .catch(err => {
        console.warn("⚠️  Database Connection Failed. Switching to IN-MEMORY mode.");
        console.warn("   Posts will be saved to RAM and lost on restart.");
        useInMemory = true;
        // Add some dummy data for testing
        memoryPosts.push(
            { id: 1, username: "System", content: "Welcome to Dev Mode (In-Memory)", created_at: new Date() },
            { id: 2, username: "Tester", content: "This post is running from RAM!", created_at: new Date() }
        );
    });

// ...

// Helper to get Game Data
function getGameData(gameId) {
    const p = path.join(__dirname, '../../games', gameId, 'data.json');
    if (fs.existsSync(p)) {
        try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { }
    }
    return null;
}

// Load Bad Words
let badWords = [];
// Adjusted path: Go up two levels from src/scripts/js/ to src/ then to config/
const nonowordsPath = path.join(__dirname, '../../config/nonowords.json');
try {
    if (fs.existsSync(nonowordsPath)) {
        const data = fs.readFileSync(nonowordsPath, 'utf8');
        const json = JSON.parse(data);
        badWords = json.nonowords || [];
        console.log(`Loaded ${badWords.length} bad words from config.`);
    } else {
        console.warn("Config file not found:", nonowordsPath);
    }
} catch (err) {
    console.error("Error loading nonowords:", err);
}

// Default Bad Words (Generic fallback)
const defaultBadWords = ["badword1", "badword2", "spam"];

// Filter Function
function containsBadWord(text) {
    const lowerText = text.toLowerCase();
    const allBadWords = [...badWords, ...defaultBadWords];
    return allBadWords.some(word => lowerText.includes(word.toLowerCase()));
}

// --- Admin Middleware (Localhost Only) ---
const adminMiddleware = (req, res, next) => {
    // 1. Check Cloudflare Header (Tunnel)
    if (req.headers['cf-ray'] || req.headers['x-forwarded-for']) {
        console.warn(`[Security] Blocked Admin access from Tunnel/External: ${req.ip}`);
        return res.status(403).send("Forbidden: Localhost Only");
    }

    // 2. Check IP (IPv4 and IPv6 localhost)
    const ip = req.ip || req.connection.remoteAddress;
    const isLocal = ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';

    if (!isLocal) {
        console.warn(`[Security] Blocked Admin access from IP: ${ip}`);
        return res.status(403).send("Forbidden: Localhost Only");
    }

    next();
};

// --- API Routes ---

// GET /api/posts
app.get('/api/posts', async (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;

    if (useInMemory) {
        // Serve from RAM
        const sorted = [...memoryPosts].sort((a, b) => b.created_at - a.created_at);
        const slice = sorted.slice(offset, offset + limit);
        return res.json(slice);
    }

    let conn;
    try {
        conn = await pool.getConnection();
        const rows = await conn.query("SELECT * FROM posts ORDER BY created_at DESC LIMIT ? OFFSET ?", [limit, offset]);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// POST /api/post
app.post('/api/post', async (req, res) => {
    try {
        const { username, content } = req.body;

        // Basic Validation
        if (!content || content.length > 255) {
            return res.status(400).json({ error: "Invalid content" });
        }

        // Profanity Check
        if (containsBadWord(content) || (username && containsBadWord(username))) {
            return res.status(400).json({ error: "Profanity detected" });
        }

        const user = username || "Anonymous";

        if (useInMemory) {
            // Save to RAM
            const newPost = {
                id: memoryPosts.length + 1,
                username: user,
                content: content,
                created_at: new Date()
            };
            memoryPosts.push(newPost);
            return res.json({ success: true });
        }

        let conn;
        try {
            conn = await pool.getConnection();
            await conn.query("INSERT INTO posts (username, content) VALUES (?, ?)", [user, content]);
            res.json({ success: true });
        } finally {
            if (conn) conn.release();
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});

// --- Game Hub APIs ---

// --- Game Hub APIs ---

// GET /api/games - Scan for games
app.get('/api/games', (req, res) => {
    const gamesDir = path.join(__dirname, '../../games'); // Corrected path
    if (!fs.existsSync(gamesDir)) {
        return res.json([]);
    }

    try {
        const games = fs.readdirSync(gamesDir).map(folder => {
            const dataPath = path.join(gamesDir, folder, 'data.json');
            if (fs.existsSync(dataPath)) {
                try {
                    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                    return {
                        id: folder,
                        name: data.name || folder,
                        description: data.description || "",
                        genre: data.genre || "Uncategorized",
                        features: data.settings || {}, // Normalize settings to features
                        settings: data.settings || {},
                        images: data.images || [], // Support for gallery images
                        achievements: data.achievements || [],
                        image: `/src/games/${folder}/logo.png`,
                        url: `/src/games/${folder}/index.html`
                    };
                } catch (e) {
                    return null;
                }
            }
            return null;
        }).filter(g => g !== null);

        res.json(games);
    } catch (err) {
        console.error("Error scanning games:", err);
        res.status(500).json({ error: "Failed to scan games" });
    }
});

// GET /api/games/:gameId - Get single game details
app.get('/api/games/:gameId', (req, res) => {
    const gameId = req.params.gameId;
    
    // Validate gameId to prevent path traversal
    if (!/^[a-zA-Z0-9_-]+$/.test(gameId)) {
        return res.status(400).json({ error: "Invalid game ID" });
    }
    
    const gameData = getGameData(gameId);
    
    if (!gameData) {
        return res.status(404).json({ error: "Game not found" });
    }
    
    res.json({
        id: gameId,
        name: gameData.name || gameId,
        description: gameData.description || "",
        genre: gameData.genre || "Uncategorized",
        settings: gameData.settings || {},
        images: gameData.images || [],
        achievements: gameData.achievements || [],
        image: `/src/games/${gameId}/logo.png`,
        url: `/src/games/${gameId}/index.html`
    });
});

// PUT /api/games/:gameId/achievements - Update achievement settings (for game devs, localhost only)
app.put('/api/games/:gameId/achievements', adminMiddleware, (req, res) => {
    const gameId = req.params.gameId;
    const { achievements } = req.body;
    
    // Validate gameId to prevent path traversal
    if (!/^[a-zA-Z0-9_-]+$/.test(gameId)) {
        return res.status(400).json({ error: "Invalid game ID" });
    }
    
    if (!achievements || !Array.isArray(achievements)) {
        return res.status(400).json({ error: "Invalid achievements data" });
    }
    
    const dataPath = path.join(__dirname, '../../games', gameId, 'data.json');
    
    if (!fs.existsSync(dataPath)) {
        return res.status(404).json({ error: "Game not found" });
    }
    
    try {
        const gameData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        gameData.achievements = achievements;
        fs.writeFileSync(dataPath, JSON.stringify(gameData, null, 4), 'utf8');
        res.json({ success: true });
    } catch (err) {
        console.error("Error updating achievements:", err);
        res.status(500).json({ error: "Failed to update achievements" });
    }
});

// GET /api/games/:gameId/stats - Get game statistics (for devs)
app.get('/api/games/:gameId/stats', async (req, res) => {
    const gameId = req.params.gameId;
    
    // Validate gameId
    if (!/^[a-zA-Z0-9_-]+$/.test(gameId)) {
        return res.status(400).json({ error: "Invalid game ID" });
    }
    
    if (useInMemory) {
        const gameScores = memoryScores.filter(s => s.game_id === gameId);
        const gameAch = memoryAchievements.filter(a => a.game_id === gameId);
        return res.json({
            total_plays: gameScores.length,
            unique_players: [...new Set(gameScores.map(s => s.username))].length,
            total_achievements_unlocked: gameAch.length,
            avg_score: gameScores.length ? Math.round(gameScores.reduce((a, s) => a + s.score, 0) / gameScores.length) : 0,
            top_score: gameScores.length ? Math.max(...gameScores.map(s => s.score)) : 0
        });
    }
    
    let conn;
    try {
        conn = await pool.getConnection();
        
        // Get score stats
        const scoreStats = await conn.query(`
            SELECT 
                COUNT(*) as total_plays,
                COUNT(DISTINCT username) as unique_players,
                AVG(score) as avg_score,
                MAX(score) as top_score
            FROM scores WHERE game_id = ?
        `, [gameId]);
        
        // Get achievement stats
        const achStats = await conn.query(`
            SELECT COUNT(*) as total_unlocks
            FROM user_achievements WHERE game_id = ?
        `, [gameId]);
        
        // Get achievement breakdown
        const achBreakdown = await conn.query(`
            SELECT achievement_id, COUNT(*) as unlock_count
            FROM user_achievements WHERE game_id = ?
            GROUP BY achievement_id
        `, [gameId]);
        
        const stats = scoreStats[0] || {};
        res.json({
            total_plays: Number(stats.total_plays) || 0,
            unique_players: Number(stats.unique_players) || 0,
            avg_score: Math.round(stats.avg_score) || 0,
            top_score: Number(stats.top_score) || 0,
            total_achievements_unlocked: Number(achStats[0]?.total_unlocks) || 0,
            achievement_breakdown: achBreakdown
        });
    } catch (err) {
        console.error("Game Stats Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

let memoryScores = [
    { game_id: "sample_game", board_id: "main", username: "DevMode", score: 9999, created_at: new Date() }
];

let memorySaves = [];

// GET /api/scores
app.get('/api/scores', async (req, res) => {
    const gameId = req.query.game;
    const boardId = req.query.board || 'main'; // Support multiple boards
    if (!gameId) return res.status(400).json({ error: "Game ID required" });

    const limit = parseInt(req.query.limit) || 10;

    if (useInMemory) {
        const scores = memoryScores
            .filter(s => s.game_id === gameId && (s.board_id === boardId || (!s.board_id && boardId === 'main')))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
        return res.json(scores);
    }

    let conn;
    try {
        conn = await pool.getConnection();
        const limitInt = parseInt(limit);
        // Assuming database has board_id column (or we default to ignoring if not present in schema yet, 
        // but for this task we assume schema supports it or we'd need migration. 
        // For robustness, if column missing, it might error. Ideally we migrate.)
        // Using 'main' as default.
        const rows = await conn.query(`
            SELECT s.*, u.avatar, u.discord_id 
            FROM scores s 
            LEFT JOIN users u ON s.username = u.username 
            WHERE s.game_id = ? AND s.board_id = ? 
            ORDER BY s.score DESC 
            LIMIT ?`,
            [gameId, boardId, limitInt]
        );
        res.json(rows);
    } catch (err) {
        // Fallback for missing column if schema isn't updated
        if (err.code === 'ER_BAD_FIELD_ERROR') {
            try {
                const rows = await conn.query("SELECT * FROM scores WHERE game_id = ? ORDER BY score DESC LIMIT ?", [gameId, parseInt(limit)]);
                return res.json(rows);
            } catch (e) { }
        }
        console.error("Database Error in GET /api/scores:", err);
        res.status(500).json({ error: "Database error: " + err.message });
    } finally {
        if (conn) conn.release();
    }
});

// GET /api/scores/rank - Get User's Best Rank
app.get('/api/scores/rank', async (req, res) => {
    const { game, username, board } = req.query;
    const boardId = board || 'main';

    if (!game || !username) return res.status(400).json({ error: "Game and Username required" });

    if (useInMemory) {
        // Find user's best score
        const userScores = memoryScores.filter(s => s.game_id === game && s.username === username && (s.board_id === boardId || (!s.board_id && boardId === 'main')));
        if (userScores.length === 0) return res.json({ rank: null, score: null });

        const bestScore = Math.max(...userScores.map(s => s.score));

        // Count scores higher than best
        const higherScores = memoryScores.filter(s => s.game_id === game && (s.board_id === boardId || (!s.board_id && boardId === 'main')) && s.score > bestScore).length;

        return res.json({ rank: higherScores + 1, score: bestScore });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        // 1. Get Best Score
        const bestRes = await conn.query("SELECT MAX(score) as best FROM scores WHERE game_id = ? AND username = ? AND board_id = ?", [game, username, boardId]);
        const bestScore = bestRes[0]?.best;

        if (bestScore === null || bestScore === undefined) {
            return res.json({ rank: null, score: null });
        }

        // 2. Count Rank
        const rankRes = await conn.query("SELECT COUNT(*) as rank FROM scores WHERE game_id = ? AND board_id = ? AND score > ?", [game, boardId, bestScore]);
        const rank = Number(rankRes[0]?.rank) + 1;

        res.json({ rank, score: bestScore });

    } catch (err) {
        console.error("Rank Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// POST /api/score
app.post('/api/score', async (req, res) => {
    try {
        const { game_id, username, score, board_id, discord_id, avatar } = req.body;
        if (!game_id || score === undefined) return res.status(400).json({ error: "Invalid data" });

        const user = username || "Anonymous";
        const board = board_id || 'main';

        if (useInMemory) {
            console.log(`[RAM] Score saved: ${user} - ${score} for ${game_id} (${board})`);
            memoryScores.push({ game_id, board_id: board, username: user, score: parseInt(score), discord_id, avatar, created_at: new Date() });
            return res.json({ success: true, mode: "memory" });
        }

        let conn;
        try {
            conn = await pool.getConnection();
            // Get user's avatar from users table if not provided
            let userDiscordId = discord_id;
            let userAvatar = avatar;
            if (!userDiscordId || !userAvatar) {
                const userRes = await conn.query("SELECT discord_id, avatar FROM users WHERE username = ?", [user]);
                if (userRes.length > 0) {
                    userDiscordId = userDiscordId || userRes[0].discord_id;
                    userAvatar = userAvatar || userRes[0].avatar;
                }
            }
            
            await conn.query(
                "INSERT INTO scores (game_id, username, score, board_id, discord_id, avatar) VALUES (?, ?, ?, ?, ?, ?)",
                [game_id, user, score, board, userDiscordId || null, userAvatar || null]
            );
            res.json({ success: true });
        } catch (err) {
            if (err.code === 'ER_BAD_FIELD_ERROR') {
                // Fallback for older schema without discord_id/avatar columns
                await conn.query("INSERT INTO scores (game_id, username, score, board_id) VALUES (?, ?, ?, ?)", [game_id, user, score, board]);
                return res.json({ success: true, warning: "avatar columns not available" });
            }
            throw err;
        } finally {
            if (conn) conn.release();
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});

// --- Save System Routes ---

// GET /api/saves?game=id&username=user
app.get('/api/saves', async (req, res) => {
    const { game, username } = req.query;
    if (!game || !username) return res.status(400).json({ error: "Missing params" });

    if (useInMemory) {
        const saves = memorySaves.filter(s => s.game_id === game && s.username === username);
        return res.json(saves);
    }

    // TODO: Implement DB logic
    return res.json([]);
});

// POST /api/save
app.post('/api/save', async (req, res) => {
    const { game_id, username, slot_id, label, data } = req.body;
    if (!game_id || !username || !data) return res.status(400).json({ error: "Invalid data" });

    const saveObj = {
        save_id: `${game_id}_${username}_${slot_id || 'auto'}`,
        game_id,
        username,
        slot_id: slot_id || 'auto',
        label: label || 'Auto Save',
        data,
        updated_at: new Date()
    };

    if (useInMemory) {
        // Upsert
        const idx = memorySaves.findIndex(s => s.save_id === saveObj.save_id);
        if (idx >= 0) {
            memorySaves[idx] = saveObj;
        } else {
            memorySaves.push(saveObj);
        }
        return res.json({ success: true });
    }

    // DB Implementation omitted for brevity, responding success
    res.json({ success: true, mode: "mock_db" });
});

// DELETE /api/save
app.delete('/api/save', async (req, res) => {
    const { game_id, username, slot_id } = req.body;

    if (useInMemory) {
        const id = `${game_id}_${username}_${slot_id}`;
        memorySaves = memorySaves.filter(s => s.save_id !== id);
        return res.json({ success: true });
    }
    res.json({ success: true });
});

// --- Achievement Routes ---

let memoryAchievements = [];

// POST /api/achievements/unlock
app.post('/api/achievements/unlock', async (req, res) => {
    try {
        const { game_id, username, achievement_id } = req.body;
        if (!game_id || !username || !achievement_id) return res.status(400).json({ error: "Invalid data" });

        if (useInMemory) {
            // Check if already unlocked
            const existing = memoryAchievements.find(a =>
                a.username === username &&
                a.game_id === game_id &&
                a.achievement_id === achievement_id
            );

            if (existing) return res.json({ success: true, new_unlock: false });

            memoryAchievements.push({
                username, game_id, achievement_id, unlocked_at: new Date()
            });
            console.log(`[RAM] Achievement Unlocked: ${username} - ${achievement_id} (${game_id})`);
            return res.json({ success: true, new_unlock: true });
        }

        let conn;
        try {
            conn = await pool.getConnection();
            // Insert ignore ensures idempotency if using UNIQUE constraint
            // 1. Insert Unlock
            const result = await conn.query(
                "INSERT IGNORE INTO user_achievements (username, game_id, achievement_id) VALUES (?, ?, ?)",
                [username, game_id, achievement_id]
            );

            // Check if row was actually inserted
            const newUnlock = result.affectedRows > 0;

            if (newUnlock) {
                // 2. Calculate Points
                let pointsAwarded = 0;
                const gameData = getGameData(game_id);
                if (gameData && gameData.achievements) {
                    const achParams = gameData.achievements.find(a => a.id === achievement_id || a.title === achievement_id);
                    if (achParams) {
                        pointsAwarded = achParams.points || 10; // Default 10 points
                    }
                }

                // 3. Award Points
                if (pointsAwarded > 0) {
                    await conn.query(
                        "INSERT INTO users (username, points) VALUES (?, ?) ON DUPLICATE KEY UPDATE points = points + ?",
                        [username, pointsAwarded, pointsAwarded]
                    );
                }

                res.json({ success: true, new_unlock: true, points: pointsAwarded });
            } else {
                res.json({ success: true, new_unlock: false });
            }

        } finally {
            if (conn) conn.release();
        }
    } catch (err) {
        console.error("Achievement Unlock Error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// GET /api/user/:username/achievements
// Query: ?game=game_id (optional, to filter by game)
// GET /api/user/:username/achievements
// Query: ?game=game_id (optional, to filter by game)
app.get('/api/user/:username/achievements', async (req, res) => {
    const { username } = req.params;
    const { game } = req.query;

    if (useInMemory) {
        let unlocks = memoryAchievements.filter(a => a.username === username);
        if (game) {
            unlocks = unlocks.filter(a => a.game_id === game);
        }
        // Mock rarity
        const results = unlocks.map(u => ({ ...u, rarity: 100 }));
        return res.json(results);
    }

    let conn;
    try {
        conn = await pool.getConnection();
        let query = "SELECT achievement_id, game_id, unlocked_at FROM user_achievements WHERE username = ?";
        let params = [username];

        if (game) {
            query += " AND game_id = ?";
            params.push(game);
        }

        const userUnlocks = await conn.query(query, params);

        // Calculate Rarity for each unlock
        const results = await Promise.all(userUnlocks.map(async (u) => {
            // 1. Total players for this game (Baseline: Scored at least once)
            // If no scores, fallback to user_achievements count? Scores is safer for "Active Players".
            const totalRes = await conn.query("SELECT COUNT(DISTINCT username) as count FROM scores WHERE game_id = ?", [u.game_id]);
            let totalPlayers = Number(totalRes[0]?.count) || 0;

            // If totalPlayers is 0 (e.g. game has no scores but has achievements? Unlikely but possible), avoid divide by zero.
            if (totalPlayers === 0) totalPlayers = 1;

            // 2. Global Unlocks for this achievement
            const unlockRes = await conn.query("SELECT COUNT(DISTINCT username) as count FROM user_achievements WHERE game_id = ? AND achievement_id = ?", [u.game_id, u.achievement_id]);
            const unlockedCount = Number(unlockRes[0]?.count) || 0;

            const rarity = (unlockedCount / totalPlayers) * 100;

            return {
                ...u,
                rarity: Math.round(rarity) // Integer percentage
            };
        }));

        res.json(results);

    } catch (err) {
        console.error("Fetch Achievements Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// --- Auth Routes ---

// GET /api/auth/status
app.get('/api/auth/status', (req, res) => {
    res.json({ enabled: authEnabled });
});

app.get('/api/auth/discord', (req, res) => {
    if (!authEnabled) return res.send("Discord Auth is not configured on this server. Use Dev Login on localhost.");

    const redirectUri = encodeURIComponent(REDIRECT_URI);
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=identify`;

    console.log("--- DEBUG AUTH ---");
    console.log("Configured REDIRECT_URI:", REDIRECT_URI);
    console.log("Generated Auth URL:", url);
    console.log("------------------");

    res.redirect(url);
});

app.get('/api/auth/discord/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send("No code provided");

    try {
        const formData = new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
        });

        const tokenRes = await axios.post('https://discord.com/api/oauth2/token', formData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        const { access_token } = tokenRes.data;

        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` },
        });

        const { id, username, discriminator, avatar } = userRes.data;

        // Upsert User to DB
        if (!useInMemory) {
            let conn;
            try {
                conn = await pool.getConnection();
                await conn.query(
                    "INSERT INTO users (username, discord_id, avatar) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE discord_id = ?, avatar = ?",
                    [username, id, avatar, id, avatar]
                );
            } catch (err) {
                console.error("Failed to sync user to DB:", err);
            } finally {
                if (conn) conn.release();
            }
        }

        // Simple "Session" via redirect params (for now)
        // Redirect to GameHub with user info so frontend can save it
        // Note: In production, use secure cookies/sessions!
        res.redirect(`/src/html/GameHub.html?login=success&username=${username}&discord_id=${id}&avatar=${avatar}`);

    } catch (err) {
        console.error("Auth Error:", err.response ? err.response.data : err.message);
        res.status(500).send("Authentication Failed");
    }
});



// GET /api/user/:username/stats
app.get('/api/user/:username/stats', async (req, res) => {
    const { username } = req.params;

    if (useInMemory) {
        const userScores = memoryScores.filter(s => s.username === username);
        const uniqueGames = [...new Set(userScores.map(s => s.game_id))].length;
        const totalScore = userScores.reduce((acc, s) => acc + s.score, 0);
        const avgScore = userScores.length ? (totalScore / userScores.length).toFixed(0) : 0;
        const bestScore = userScores.length ? Math.max(...userScores.map(s => s.score)) : 0;
        const achievementCount = memoryAchievements.filter(a => a.username === username).length;

        return res.json({
            username,
            games_played: uniqueGames,
            total_score: totalScore,
            average_score: avgScore,
            best_score: bestScore,
            total_achievements: achievementCount,
            points: 0,
            decoration: null,
            bio: null
        });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        
        // Get user data
        const userRes = await conn.query("SELECT points, decoration, bio, discord_id, avatar FROM users WHERE username = ?", [username]);
        const userData = userRes[0] || {};
        
        // Calculate stats
        const stats = await conn.query(`
            SELECT 
                COUNT(DISTINCT s.game_id) as games_played,
                SUM(s.score) as total_score,
                AVG(s.score) as average_score,
                MAX(s.score) as best_score,
                COUNT(s.id) as total_submissions
            FROM scores s
            WHERE s.username = ?
        `, [username]);
        
        // Count achievements
        const achRes = await conn.query("SELECT COUNT(*) as count FROM user_achievements WHERE username = ?", [username]);
        const totalAchievements = Number(achRes[0]?.count) || 0;

        const data = stats[0] || {};
        res.json({
            username,
            discord_id: userData.discord_id || null,
            avatar: userData.avatar || null,
            games_played: Number(data.games_played) || 0,
            total_score: Number(data.total_score) || 0,
            average_score: Math.round(data.average_score) || 0,
            best_score: Number(data.best_score) || 0,
            total_submissions: Number(data.total_submissions) || 0,
            total_achievements: totalAchievements,
            points: Number(userData.points) || 0,
            decoration: userData.decoration || null,
            bio: userData.bio || null
        });

    } catch (err) {
        console.error("Stats Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }

});

// GET /api/user/:username/profile - Get full profile with achievements including images
app.get('/api/user/:username/profile', async (req, res) => {
    const { username } = req.params;

    if (useInMemory) {
        const userAch = memoryAchievements.filter(a => a.username === username);
        const achWithImages = userAch.map(a => {
            const gameData = getGameData(a.game_id);
            const achData = gameData?.achievements?.find(x => x.id === a.achievement_id || x.title === a.achievement_id);
            return {
                ...a,
                title: achData?.title || a.achievement_id,
                description: achData?.description || '',
                image: achData?.image || null,
                game_name: gameData?.name || a.game_id,
                points: achData?.points || 10
            };
        });
        return res.json({
            username,
            achievements: achWithImages,
            decoration: null,
            bio: null
        });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        
        // Get user data
        const userRes = await conn.query("SELECT points, decoration, bio, discord_id, avatar FROM users WHERE username = ?", [username]);
        const userData = userRes[0] || {};
        
        // Get achievements
        const achRes = await conn.query("SELECT achievement_id, game_id, unlocked_at FROM user_achievements WHERE username = ?", [username]);
        
        // Enrich achievements with game data
        const achievementsWithImages = achRes.map(a => {
            const gameData = getGameData(a.game_id);
            const achData = gameData?.achievements?.find(x => x.id === a.achievement_id || x.title === a.achievement_id);
            return {
                ...a,
                title: achData?.title || a.achievement_id,
                description: achData?.description || '',
                image: achData?.image || null,
                game_name: gameData?.name || a.game_id,
                points: achData?.points || 10
            };
        });
        
        res.json({
            username,
            discord_id: userData.discord_id || null,
            avatar: userData.avatar || null,
            points: Number(userData.points) || 0,
            decoration: userData.decoration || null,
            bio: userData.bio || null,
            achievements: achievementsWithImages
        });

    } catch (err) {
        console.error("Profile Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// PUT /api/user/:username/profile - Update user profile (decoration, bio)
app.put('/api/user/:username/profile', async (req, res) => {
    const { username } = req.params;
    const { decoration, bio } = req.body;

    if (useInMemory) {
        return res.json({ success: true, mode: "memory" });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        
        // Build update query dynamically
        const updates = [];
        const values = [];
        
        if (decoration !== undefined) {
            updates.push("decoration = ?");
            values.push(decoration);
        }
        if (bio !== undefined) {
            updates.push("bio = ?");
            values.push(bio ? bio.substring(0, 500) : null); // Limit bio length
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ error: "No updates provided" });
        }
        
        values.push(username);
        await conn.query(`UPDATE users SET ${updates.join(', ')} WHERE username = ?`, values);
        
        res.json({ success: true });
    } catch (err) {
        console.error("Profile Update Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// GET /api/decorations - Get available decorations
app.get('/api/decorations', (req, res) => {
    // Define available decorations
    const decorations = [
        { id: 'none', name: 'None', image: null, cost: 0 },
        { id: 'gold_ring', name: 'Gold Ring', image: '/src/assets/imgs/decorations/gold_ring.svg', cost: 100 },
        { id: 'fire', name: 'Fire Border', image: '/src/assets/imgs/decorations/fire.svg', cost: 250 },
        { id: 'rainbow', name: 'Rainbow Glow', image: '/src/assets/imgs/decorations/rainbow.svg', cost: 500 },
        { id: 'crown', name: 'Crown', image: '/src/assets/imgs/decorations/crown.svg', cost: 1000 },
        { id: 'stars', name: 'Starry', image: '/src/assets/imgs/decorations/stars.svg', cost: 750 },
        { id: 'pixel', name: 'Pixel Frame', image: '/src/assets/imgs/decorations/pixel.svg', cost: 150 }
    ];
    res.json(decorations);
});

// POST /api/user/:username/decoration - Purchase and equip decoration
app.post('/api/user/:username/decoration', async (req, res) => {
    const { username } = req.params;
    const { decoration_id } = req.body;

    if (useInMemory) {
        return res.json({ success: true, mode: "memory" });
    }

    const decorationCosts = {
        'none': 0, 'gold_ring': 100, 'fire': 250, 'rainbow': 500, 'crown': 1000, 'stars': 750, 'pixel': 150
    };

    const cost = decorationCosts[decoration_id];
    if (cost === undefined) {
        return res.status(400).json({ error: "Invalid decoration" });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        
        // Get user's current points and inventory
        const userRes = await conn.query("SELECT points, inventory FROM users WHERE username = ?", [username]);
        if (userRes.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }
        
        const user = userRes[0];
        const currentPoints = Number(user.points) || 0;
        let inventory = [];
        try {
            inventory = user.inventory ? JSON.parse(user.inventory) : [];
        } catch (e) {
            inventory = [];
        }
        
        // Check if already owned or can afford
        const alreadyOwned = decoration_id === 'none' || inventory.includes(decoration_id);
        
        if (!alreadyOwned && currentPoints < cost) {
            return res.status(400).json({ error: "Not enough points", required: cost, current: currentPoints });
        }
        
        // If not owned, deduct points and add to inventory
        if (!alreadyOwned) {
            inventory.push(decoration_id);
            await conn.query(
                "UPDATE users SET points = points - ?, inventory = ?, decoration = ? WHERE username = ?",
                [cost, JSON.stringify(inventory), decoration_id, username]
            );
        } else {
            // Just equip
            await conn.query("UPDATE users SET decoration = ? WHERE username = ?", [decoration_id === 'none' ? null : decoration_id, username]);
        }
        
        res.json({ success: true, decoration: decoration_id, points_spent: alreadyOwned ? 0 : cost });
    } catch (err) {
        console.error("Decoration Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// --- Admin Endpoints (Localhost Only) ---

app.get('/api/admin/tables', adminMiddleware, async (req, res) => {
    if (useInMemory) return res.json(["Memory Mode (No Tables)"]);

    let conn;
    try {
        conn = await pool.getConnection();
        const rows = await conn.query("SHOW TABLES");
        // Convert to simple array of names
        const tables = rows.map(r => Object.values(r)[0]);
        res.json(tables);
    } catch (err) {
        console.error("Admin Tables Error:", err);
        res.status(500).json({ error: "DB Error" });
    } finally {
        if (conn) conn.release();
    }
});

app.get('/api/admin/data/:table', adminMiddleware, async (req, res) => {
    if (useInMemory) return res.json([]);

    const tableName = req.params.table;
    // Basic sanitization: only allow alphanumeric + underscore
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
        return res.status(400).json({ error: "Invalid table name" });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        // Limit 100 for safety
        const rows = await conn.query(`SELECT * FROM ${tableName} ORDER BY 1 DESC LIMIT 100`);
        res.json(rows);
    } catch (err) {
        console.error(`Admin Query Error (${tableName}):`, err);
        res.status(500).json({ error: "Query Error" });
    } finally {
        if (conn) conn.release();
    }
});

// DELETE /api/admin/data/:table/:id - Delete a row from a table
app.delete('/api/admin/data/:table/:id', adminMiddleware, async (req, res) => {
    if (useInMemory) return res.status(400).json({ error: "Memory mode - no deletion" });

    const tableName = req.params.table;
    const id = req.params.id;

    // Whitelist of allowed tables and their primary keys for security
    const allowedTables = {
        'users': 'username',
        'posts': 'id',
        'scores': 'id',
        'user_achievements': 'id',
        'saved_games': 'id'
    };

    // Basic sanitization: only allow alphanumeric + underscore
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
        return res.status(400).json({ error: "Invalid table name" });
    }

    // Check if table is in whitelist
    if (!allowedTables[tableName]) {
        return res.status(400).json({ error: "Table not allowed for deletion" });
    }

    const pkColumn = allowedTables[tableName];

    let conn;
    try {
        conn = await pool.getConnection();
        
        // Delete the row using parameterized query for the id value
        const result = await conn.query(`DELETE FROM ${tableName} WHERE ${pkColumn} = ?`, [id]);
        
        if (result.affectedRows > 0) {
            res.json({ success: true, deleted: result.affectedRows });
        } else {
            res.status(404).json({ error: "Row not found" });
        }
    } catch (err) {
        console.error(`Admin Delete Error (${tableName}/${id}):`, err);
        res.status(500).json({ error: "Delete Error: " + err.message });
    } finally {
        if (conn) conn.release();
    }
});

// =============================================
// Explain-TM Wiki API Routes
// =============================================

// Rate limit helper for anti-spam
async function checkRateLimit(conn, ip, actionType, maxActions = 5, windowMinutes = 60) {
    const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);
    const result = await conn.query(
        `SELECT COUNT(*) as count FROM explain_rate_limits 
         WHERE ip_address = ? AND action_type = ? AND created_at > ?`,
        [ip, actionType, cutoff]
    );
    return Number(result[0].count) < maxActions;
}

async function recordRateLimit(conn, ip, actionType) {
    await conn.query(
        `INSERT INTO explain_rate_limits (ip_address, action_type) VALUES (?, ?)`,
        [ip, actionType]
    );
    // Cleanup old entries
    await conn.query(
        `DELETE FROM explain_rate_limits WHERE created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)`
    );
}

// Generate slug from title
function generateSlug(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 100);
}

// Ensure Explain-TM tables exist
async function ensureExplainTables(conn) {
    await conn.query(`
        CREATE TABLE IF NOT EXISTS explain_categories (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL UNIQUE,
            description VARCHAR(500),
            color VARCHAR(7) DEFAULT '#1DCD9F',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    await conn.query(`
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
            INDEX idx_status (status),
            INDEX idx_views (views DESC),
            INDEX idx_category (category_id)
        )
    `);
    
    await conn.query(`
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
            INDEX idx_article_status (article_id, status)
        )
    `);
    
    await conn.query(`
        CREATE TABLE IF NOT EXISTS explain_rate_limits (
            id INT AUTO_INCREMENT PRIMARY KEY,
            ip_address VARCHAR(45) NOT NULL,
            action_type ENUM('create', 'edit') NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_ip_action (ip_address, action_type, created_at)
        )
    `);
    
    // Insert default categories if none exist
    const cats = await conn.query(`SELECT COUNT(*) as count FROM explain_categories`);
    if (Number(cats[0].count) === 0) {
        await conn.query(`
            INSERT INTO explain_categories (name, description, color) VALUES
            ('General', 'General topics and miscellaneous articles', '#1DCD9F'),
            ('Gaming', 'Video games, game mechanics, and gaming culture', '#FF6B6B'),
            ('Technology', 'Tech, programming, and digital topics', '#4ECDC4'),
            ('Science', 'Scientific concepts and discoveries', '#45B7D1'),
            ('Culture', 'Internet culture, memes, and trends', '#96CEB4'),
            ('Tutorial', 'How-to guides and tutorials', '#FFEAA7')
        `);
    }
}

// GET /api/explain/categories - Get all categories
app.get('/api/explain/categories', async (req, res) => {
    if (useInMemory) {
        return res.json([
            { id: 1, name: 'General', description: 'General topics', color: '#1DCD9F' },
            { id: 2, name: 'Gaming', description: 'Gaming topics', color: '#FF6B6B' }
        ]);
    }
    
    let conn;
    try {
        conn = await pool.getConnection();
        await ensureExplainTables(conn);
        const rows = await conn.query(`SELECT * FROM explain_categories ORDER BY name`);
        res.json(rows);
    } catch (err) {
        console.error('Error fetching categories:', err);
        res.status(500).json({ error: 'Database error' });
    } finally {
        if (conn) conn.release();
    }
});

// GET /api/explain/articles - Get articles (with filters)
app.get('/api/explain/articles', async (req, res) => {
    const { category, search, sort, status } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    
    if (useInMemory) {
        return res.json({ articles: [], total: 0 });
    }
    
    let conn;
    try {
        conn = await pool.getConnection();
        await ensureExplainTables(conn);
        
        // Build WHERE conditions separately
        let whereClause = 'WHERE 1=1';
        const params = [];
        
        // Only show approved articles to public (unless admin)
        const showStatus = status || 'approved';
        whereClause += ` AND a.status = ?`;
        params.push(showStatus);
        
        if (category) {
            whereClause += ` AND a.category_id = ?`;
            params.push(category);
        }
        
        if (search) {
            whereClause += ` AND (a.title LIKE ? OR a.content LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`);
        }
        
        // Build count query separately
        const countQuery = `
            SELECT COUNT(*) as total
            FROM explain_articles a
            LEFT JOIN explain_categories c ON a.category_id = c.id
            ${whereClause}
        `;
        const countResult = await conn.query(countQuery, params);
        const total = Number(countResult[0].total);
        
        // Build main query
        let query = `
            SELECT a.*, c.name as category_name, c.color as category_color
            FROM explain_articles a
            LEFT JOIN explain_categories c ON a.category_id = c.id
            ${whereClause}
        `;
        
        // Sort
        switch (sort) {
            case 'popular':
                query += ` ORDER BY a.views DESC, a.created_at DESC`;
                break;
            case 'oldest':
                query += ` ORDER BY a.created_at ASC`;
                break;
            default:
                query += ` ORDER BY a.created_at DESC`;
        }
        
        query += ` LIMIT ? OFFSET ?`;
        const queryParams = [...params, limit, offset];
        
        const rows = await conn.query(query, queryParams);
        res.json({ articles: rows, total });
    } catch (err) {
        console.error('Error fetching articles:', err);
        res.status(500).json({ error: 'Database error' });
    } finally {
        if (conn) conn.release();
    }
});

// GET /api/explain/articles/trending - Get trending/popular articles
app.get('/api/explain/articles/trending', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    
    if (useInMemory) {
        return res.json([]);
    }
    
    let conn;
    try {
        conn = await pool.getConnection();
        await ensureExplainTables(conn);
        
        const rows = await conn.query(`
            SELECT a.*, c.name as category_name, c.color as category_color
            FROM explain_articles a
            LEFT JOIN explain_categories c ON a.category_id = c.id
            WHERE a.status = 'approved'
            ORDER BY a.views DESC, a.updated_at DESC
            LIMIT ?
        `, [limit]);
        
        res.json(rows);
    } catch (err) {
        console.error('Error fetching trending:', err);
        res.status(500).json({ error: 'Database error' });
    } finally {
        if (conn) conn.release();
    }
});

// GET /api/explain/article/:slug - Get single article by slug
app.get('/api/explain/article/:slug', async (req, res) => {
    const { slug } = req.params;
    
    if (!/^[a-z0-9-]+$/.test(slug)) {
        return res.status(400).json({ error: 'Invalid slug' });
    }
    
    if (useInMemory) {
        return res.status(404).json({ error: 'Article not found' });
    }
    
    let conn;
    try {
        conn = await pool.getConnection();
        await ensureExplainTables(conn);
        
        const rows = await conn.query(`
            SELECT a.*, c.name as category_name, c.color as category_color
            FROM explain_articles a
            LEFT JOIN explain_categories c ON a.category_id = c.id
            WHERE a.slug = ? AND a.status = 'approved'
        `, [slug]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Article not found' });
        }
        
        // Increment view count
        await conn.query(`UPDATE explain_articles SET views = views + 1 WHERE slug = ?`, [slug]);
        
        res.json(rows[0]);
    } catch (err) {
        console.error('Error fetching article:', err);
        res.status(500).json({ error: 'Database error' });
    } finally {
        if (conn) conn.release();
    }
});

// POST /api/explain/article - Create new article (requires moderation)
app.post('/api/explain/article', async (req, res) => {
    const { title, content, category_id, author } = req.body;
    
    // Validation
    if (!title || title.length < 3 || title.length > 255) {
        return res.status(400).json({ error: 'Title must be 3-255 characters' });
    }
    if (!content || content.length < 10 || content.length > 50000) {
        return res.status(400).json({ error: 'Content must be 10-50000 characters' });
    }
    if (containsBadWord(title) || containsBadWord(content)) {
        return res.status(400).json({ error: 'Inappropriate content detected' });
    }
    
    const authorName = author && author.length <= 50 ? author : 'Anonymous';
    
    if (useInMemory) {
        return res.json({ success: true, message: 'Article submitted for review', slug: generateSlug(title) });
    }
    
    let conn;
    try {
        conn = await pool.getConnection();
        await ensureExplainTables(conn);
        
        // Rate limiting
        const ip = req.ip || req.connection.remoteAddress;
        const canCreate = await checkRateLimit(conn, ip, 'create', 3, 60); // 3 articles per hour
        if (!canCreate) {
            return res.status(429).json({ error: 'Too many submissions. Please wait before creating more articles.' });
        }
        
        // Generate unique slug with max iteration limit
        let slug = generateSlug(title);
        let slugExists = true;
        let suffix = 0;
        const maxIterations = 100;
        while (slugExists && suffix < maxIterations) {
            const testSlug = slug + (suffix ? `-${suffix}` : '');
            const existing = await conn.query(`SELECT id FROM explain_articles WHERE slug = ?`, [testSlug]);
            if (existing.length === 0) {
                slug = testSlug;
                slugExists = false;
            } else {
                suffix++;
            }
        }
        
        if (slugExists) {
            return res.status(400).json({ error: 'Unable to generate unique slug. Please try a different title.' });
        }
        
        await conn.query(`
            INSERT INTO explain_articles (slug, title, content, category_id, author, status)
            VALUES (?, ?, ?, ?, ?, 'pending')
        `, [slug, title, content, category_id || null, authorName]);
        
        await recordRateLimit(conn, ip, 'create');
        
        res.json({ success: true, message: 'Article submitted for review', slug });
    } catch (err) {
        console.error('Error creating article:', err);
        res.status(500).json({ error: 'Database error' });
    } finally {
        if (conn) conn.release();
    }
});

// POST /api/explain/article/:slug/edit - Submit edit for review
app.post('/api/explain/article/:slug/edit', async (req, res) => {
    const { slug } = req.params;
    const { content, editor, edit_summary } = req.body;
    
    if (!/^[a-z0-9-]+$/.test(slug)) {
        return res.status(400).json({ error: 'Invalid slug' });
    }
    if (!content || content.length < 10 || content.length > 50000) {
        return res.status(400).json({ error: 'Content must be 10-50000 characters' });
    }
    if (containsBadWord(content) || (edit_summary && containsBadWord(edit_summary))) {
        return res.status(400).json({ error: 'Inappropriate content detected' });
    }
    
    const editorName = editor && editor.length <= 50 ? editor : 'Anonymous';
    
    if (useInMemory) {
        return res.json({ success: true, message: 'Edit submitted for review' });
    }
    
    let conn;
    try {
        conn = await pool.getConnection();
        await ensureExplainTables(conn);
        
        // Check article exists
        const articles = await conn.query(`SELECT id FROM explain_articles WHERE slug = ? AND status = 'approved'`, [slug]);
        if (articles.length === 0) {
            return res.status(404).json({ error: 'Article not found' });
        }
        
        // Rate limiting
        const ip = req.ip || req.connection.remoteAddress;
        const canEdit = await checkRateLimit(conn, ip, 'edit', 10, 60); // 10 edits per hour
        if (!canEdit) {
            return res.status(429).json({ error: 'Too many edits. Please wait before submitting more.' });
        }
        
        await conn.query(`
            INSERT INTO explain_revisions (article_id, content, editor, edit_summary, status)
            VALUES (?, ?, ?, ?, 'pending')
        `, [articles[0].id, content, editorName, edit_summary || null]);
        
        await recordRateLimit(conn, ip, 'edit');
        
        res.json({ success: true, message: 'Edit submitted for review' });
    } catch (err) {
        console.error('Error submitting edit:', err);
        res.status(500).json({ error: 'Database error' });
    } finally {
        if (conn) conn.release();
    }
});

// --- Admin Routes for Explain-TM (Localhost Only) ---

// GET /api/admin/explain/pending - Get pending articles and edits
app.get('/api/admin/explain/pending', adminMiddleware, async (req, res) => {
    if (useInMemory) {
        return res.json({ articles: [], revisions: [] });
    }
    
    let conn;
    try {
        conn = await pool.getConnection();
        await ensureExplainTables(conn);
        
        const articles = await conn.query(`
            SELECT a.*, c.name as category_name
            FROM explain_articles a
            LEFT JOIN explain_categories c ON a.category_id = c.id
            WHERE a.status = 'pending'
            ORDER BY a.created_at ASC
        `);
        
        const revisions = await conn.query(`
            SELECT r.*, a.title, a.slug
            FROM explain_revisions r
            JOIN explain_articles a ON r.article_id = a.id
            WHERE r.status = 'pending'
            ORDER BY r.created_at ASC
        `);
        
        res.json({ articles, revisions });
    } catch (err) {
        console.error('Error fetching pending:', err);
        res.status(500).json({ error: 'Database error' });
    } finally {
        if (conn) conn.release();
    }
});

// POST /api/admin/explain/article/:id/approve - Approve article
app.post('/api/admin/explain/article/:id/approve', adminMiddleware, async (req, res) => {
    const { id } = req.params;
    
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(`UPDATE explain_articles SET status = 'approved' WHERE id = ?`, [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Error approving article:', err);
        res.status(500).json({ error: 'Database error' });
    } finally {
        if (conn) conn.release();
    }
});

// POST /api/admin/explain/article/:id/reject - Reject article
app.post('/api/admin/explain/article/:id/reject', adminMiddleware, async (req, res) => {
    const { id } = req.params;
    
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(`UPDATE explain_articles SET status = 'rejected' WHERE id = ?`, [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Error rejecting article:', err);
        res.status(500).json({ error: 'Database error' });
    } finally {
        if (conn) conn.release();
    }
});

// POST /api/admin/explain/revision/:id/approve - Approve revision (applies edit)
app.post('/api/admin/explain/revision/:id/approve', adminMiddleware, async (req, res) => {
    const { id } = req.params;
    const reviewer = req.body.reviewer || 'Admin';
    
    let conn;
    try {
        conn = await pool.getConnection();
        
        // Get the revision
        const revisions = await conn.query(`SELECT * FROM explain_revisions WHERE id = ?`, [id]);
        if (revisions.length === 0) {
            return res.status(404).json({ error: 'Revision not found' });
        }
        
        const revision = revisions[0];
        
        // Apply the edit to the article
        await conn.query(`UPDATE explain_articles SET content = ?, updated_at = NOW() WHERE id = ?`, 
            [revision.content, revision.article_id]);
        
        // Mark revision as approved
        await conn.query(`UPDATE explain_revisions SET status = 'approved', reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
            [reviewer, id]);
        
        res.json({ success: true });
    } catch (err) {
        console.error('Error approving revision:', err);
        res.status(500).json({ error: 'Database error' });
    } finally {
        if (conn) conn.release();
    }
});

// POST /api/admin/explain/revision/:id/reject - Reject revision
app.post('/api/admin/explain/revision/:id/reject', adminMiddleware, async (req, res) => {
    const { id } = req.params;
    const reviewer = req.body.reviewer || 'Admin';
    
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(`UPDATE explain_revisions SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
            [reviewer, id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Error rejecting revision:', err);
        res.status(500).json({ error: 'Database error' });
    } finally {
        if (conn) conn.release();
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
