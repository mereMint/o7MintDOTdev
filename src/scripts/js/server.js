const express = require('express');
const mariadb = require('mariadb');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
    console.warn("[WARN]  Discord Auth credentials missing or default in .env");
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

// =============================================
// Session Management - Secure Authentication
// =============================================

// In-memory session store (Map of sessionToken -> sessionData)
// In production, use Redis or database-backed sessions
const sessions = new Map();
const SESSION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Generate cryptographically secure session token
function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Create a new session
function createSession(username, discordId, avatar, role = 'user') {
    const token = generateSessionToken();
    const session = {
        token,
        username,
        discordId,
        avatar,
        role,
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_EXPIRY_MS
    };
    sessions.set(token, session);
    return token;
}

// Validate and get session
function getSession(token) {
    if (!token) return null;
    const session = sessions.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
        sessions.delete(token);
        return null;
    }
    return session;
}

// Destroy a session
function destroySession(token) {
    sessions.delete(token);
}

// Cleanup expired sessions periodically
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [token, session] of sessions.entries()) {
        if (now > session.expiresAt) {
            sessions.delete(token);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        console.log(`[Sessions] Cleaned up ${cleaned} expired sessions`);
    }
}, SESSION_CLEANUP_INTERVAL_MS);

// Authentication Middleware - Validates session token
const authMiddleware = (req, res, next) => {
    // Get token from Authorization header or query param
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : req.query.session_token;
    
    const session = getSession(token);
    
    if (!session) {
        return res.status(401).json({ error: "Authentication required. Please log in." });
    }
    
    // Attach session to request for use in handlers
    req.session = session;
    next();
};

// Owner verification middleware - Ensures user can only access their own data
const ownerMiddleware = (usernameParam = 'username') => {
    return (req, res, next) => {
        const targetUsername = req.params[usernameParam] || req.body[usernameParam] || req.query[usernameParam];
        
        if (!req.session) {
            return res.status(401).json({ error: "Authentication required" });
        }
        
        // Allow if user is accessing their own data or is admin/owner
        if (req.session.username === targetUsername || 
            ['admin', 'owner'].includes(req.session.role)) {
            next();
        } else {
            return res.status(403).json({ error: "You can only access your own data" });
        }
    };
};

// Initialize Connection
pool.getConnection()
    .then(async conn => {
        console.log("[OK] Database connected successfully.");

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
                    status ENUM('pending', 'approved', 'rejected') DEFAULT 'approved',
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
            // Ensure Generic Daily Challenges table exists
            await conn.query(`
                CREATE TABLE IF NOT EXISTS daily_challenges (
                    date_id DATE,
                    game_id VARCHAR(50),
                    challenge_data JSON NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (date_id, game_id)
                )
            `);
            console.log("[OK] Tables verified/created.");

            // Migrations: Ensure columns exist (for existing tables)
            try {
                // MariaDB 10.2+ supports IF NOT EXISTS in ADD COLUMN
                await conn.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_id VARCHAR(255)");
                await conn.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar VARCHAR(255)");
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
                        console.log("[OK] user_achievements table migrated to include id column.");
                    }
                } catch (achMigErr) {
                    console.warn("user_achievements migration skipped:", achMigErr.message);
                }

                console.log("[OK] Schema Migrations applied.");
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
        console.warn("[WARN]  Database Connection Failed. Switching to IN-MEMORY mode.");
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

        // Try to get with avatar columns, fallback if not available
        try {
            const rows = await conn.query(`
                SELECT p.*, 
                    COALESCE(p.discord_id, u.discord_id) as discord_id,
                    COALESCE(p.avatar, u.avatar) as avatar
                FROM posts p
                LEFT JOIN users u ON p.username = u.username
                WHERE p.status = 'approved' OR p.status IS NULL
                ORDER BY p.created_at DESC LIMIT ? OFFSET ?
            `, [limit, offset]);
            res.json(rows);
        } catch (e) {
            // Fallback for older schema
            const rows = await conn.query("SELECT * FROM posts ORDER BY created_at DESC LIMIT ? OFFSET ?", [limit, offset]);
            res.json(rows);
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// POST /api/post
app.post('/api/post', authMiddleware, async (req, res) => {
    try {
        const { content, discord_id, avatar } = req.body;
        // Use username from authenticated session, not from request body
        const username = req.session.username;

        // Basic Validation
        if (!content || content.length > 255) {
            return res.status(400).json({ error: "Invalid content" });
        }

        // Profanity Check
        if (containsBadWord(content) || containsBadWord(username)) {
            return res.status(400).json({ error: "Profanity detected" });
        }

        if (useInMemory) {
            // Save to RAM
            const newPost = {
                id: memoryPosts.length + 1,
                username: username,
                content: content,
                discord_id: req.session.discordId || null,
                avatar: req.session.avatar || null,
                created_at: new Date()
            };
            memoryPosts.push(newPost);
            return res.json({ success: true });
        }

        let conn;
        try {
            conn = await pool.getConnection();

            // Ensure posts table has avatar columns and status column
            try {
                await conn.query("ALTER TABLE posts ADD COLUMN IF NOT EXISTS discord_id VARCHAR(255)");
                await conn.query("ALTER TABLE posts ADD COLUMN IF NOT EXISTS avatar VARCHAR(255)");
                await conn.query("ALTER TABLE posts ADD COLUMN IF NOT EXISTS status ENUM('pending', 'approved', 'rejected') DEFAULT 'approved'");
                // Migrate legacy posts with NULL status to 'approved'
                await conn.query("UPDATE posts SET status = 'approved' WHERE status IS NULL");
            } catch (e) { }

            // Use session discord info, fallback to database
            let userDiscordId = req.session.discordId || discord_id;
            let userAvatar = req.session.avatar || avatar;
            if (!userDiscordId || !userAvatar) {
                const userRes = await conn.query("SELECT discord_id, avatar FROM users WHERE username = ?", [username]);
                if (userRes.length > 0) {
                    userDiscordId = userDiscordId || userRes[0].discord_id;
                    userAvatar = userAvatar || userRes[0].avatar;
                }
            }

            await conn.query("INSERT INTO posts (username, content, discord_id, avatar) VALUES (?, ?, ?, ?)",
                [username, content, userDiscordId, userAvatar]);
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
                // Fallback for older schema - try without board_id first, then without avatar columns
                try {
                    await conn.query("INSERT INTO scores (game_id, username, score, board_id) VALUES (?, ?, ?, ?)", [game_id, user, score, board]);
                    return res.json({ success: true, warning: "avatar columns not available" });
                } catch (fallbackErr) {
                    if (fallbackErr.code === 'ER_BAD_FIELD_ERROR') {
                        // Even older schema without board_id column
                        await conn.query("INSERT INTO scores (game_id, username, score) VALUES (?, ?, ?)", [game_id, user, score]);
                        return res.json({ success: true, warning: "using legacy schema without board_id" });
                    }
                    throw fallbackErr;
                }
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

        } catch (err) {
            console.error("Achievement Unlock Error:", err);
            res.status(500).json({ error: "Server error" });
        } finally {
            if (conn) conn.release();
        }
    } catch (outerErr) {
        console.error("Unlock Route Error:", outerErr);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// --- Generic Daily Challenge System ---

// Helper: Server Delay
const serverDelay = ms => new Promise(res => setTimeout(res, ms));

// Helper: Sequel Check
function isSequelTitle(title) {
    if (!title) return false;
    const t = title.toLowerCase();
    const sequelPatterns = [
        /season \d+/, /\d+(?:st|nd|rd|th) season/,
        /part \d+/, /cour \d+/, /act \d+/,
        /collection/, /movie \d+/
    ];
    return sequelPatterns.some(p => t.match(p));
}

// Generators registry
const dailyGenerators = {
    'anidle': async () => {
        let attempts = 0;
        while (attempts < 10) {
            try {
                // Fetch random page of popular anime
                const page = Math.floor(Math.random() * 10) + 1;
                // We allow TV and Movie, but filter heavily later
                const listRes = await axios.get(`https://api.jikan.moe/v4/top/anime?page=${page}&filter=bypopularity&limit=25`);
                const candidates = listRes.data.data || [];

                if (candidates.length === 0) continue;

                const shuffled = candidates.sort(() => 0.5 - Math.random());

                for (const candidate of shuffled) {
                    // Title Filter
                    if (isSequelTitle(candidate.title) ||
                        isSequelTitle(candidate.title_english) ||
                        !candidate.approved) continue;

                    await serverDelay(800);

                    // Fetch Full Details
                    const detailRes = await axios.get(`https://api.jikan.moe/v4/anime/${candidate.mal_id}/full`);
                    const anime = detailRes.data.data;

                    // Logic: Originals Only (No Prequels)
                    const hasPrequel = anime.relations?.some(r => r.relation === 'Prequel');
                    const hasParent = anime.relations?.some(r => r.relation === 'Parent story');

                    if (!hasPrequel && !hasParent) return anime;
                }
            } catch (err) {
                console.error("[Anidle] Gen Error:", err.message);
                await serverDelay(1000);
            }
            attempts++;
            await serverDelay(1000);
        }
        throw new Error("Failed to generate Anidle daily");
    }
    // Add other games here
};

let memoryDailyCache = {}; // { "game_id|YYYY-MM-DD": {data} }

// GET /api/daily/:gameId
app.get('/api/daily/:gameId', async (req, res) => {
    const { gameId } = req.params;
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const cacheKey = `${gameId}|${today}`;

    // 1. Check Memory Cache (Fastest)
    if (memoryDailyCache[cacheKey]) {
        return res.json(memoryDailyCache[cacheKey]);
    }

    // 2. Check Database / Generate
    let conn;
    try {
        if (!useInMemory) {
            conn = await pool.getConnection();

            // Check DB
            const rows = await conn.query(
                "SELECT challenge_data FROM daily_challenges WHERE date_id = ? AND game_id = ?",
                [today, gameId]
            );

            if (rows.length > 0) {
                const data = rows[0].challenge_data;
                memoryDailyCache[cacheKey] = data; // Cache it
                return res.json(data);
            }
        }

        // 3. Generate New Challenge
        const generator = dailyGenerators[gameId];
        if (!generator) {
            return res.status(404).json({ error: "No daily generator for this game" });
        }

        console.log(`[Daily] Generating for ${gameId} on ${today}...`);
        const newData = await generator();

        // 4. Save to DB
        if (!useInMemory && conn) {
            await conn.query(
                "INSERT IGNORE INTO daily_challenges (date_id, game_id, challenge_data) VALUES (?, ?, ?)",
                [today, gameId, JSON.stringify(newData)]
            );
        }

        memoryDailyCache[cacheKey] = newData;
        return res.json(newData);

    } catch (err) {
        console.error("Daily API Error:", err);
        res.status(500).json({ error: "Server error handling daily challenge" });
    } finally {
        if (conn) conn.release();
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

        // Get user role from DB or default to 'user'
        let userRole = 'user';

        // Upsert User to DB
        if (!useInMemory) {
            let conn;
            try {
                conn = await pool.getConnection();
                await conn.query(
                    "INSERT INTO users (username, discord_id, avatar) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE discord_id = ?, avatar = ?",
                    [username, id, avatar, id, avatar]
                );
                // Fetch user role
                const roleRes = await conn.query("SELECT role FROM users WHERE username = ?", [username]);
                if (roleRes.length > 0 && roleRes[0].role) {
                    userRole = roleRes[0].role;
                }
            } catch (err) {
                console.error("Failed to sync user to DB:", err);
            } finally {
                if (conn) conn.release();
            }
        }

        // Create secure session
        const sessionToken = createSession(username, id, avatar, userRole);

        // Redirect with only the session token (not sensitive user data)
        // The frontend will use the token to fetch user data via API
        res.redirect(`/src/html/GameHub.html?session_token=${sessionToken}`);

    } catch (err) {
        console.error("Auth Error:", err.response ? err.response.data : err.message);
        res.status(500).send("Authentication Failed");
    }
});

// GET /api/auth/me - Get current user from session token
app.get('/api/auth/me', authMiddleware, (req, res) => {
    res.json({
        username: req.session.username,
        discord_id: req.session.discordId,
        avatar: req.session.avatar,
        role: req.session.role
    });
});

// POST /api/auth/logout - Destroy session
app.post('/api/auth/logout', authMiddleware, (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : req.body.session_token;
    
    if (token) {
        destroySession(token);
    }
    res.json({ success: true, message: "Logged out successfully" });
});

// Constants for dev mode
const DEV_DISCORD_ID = '000000000000000000';
const DEV_AVATAR = '0';

// POST /api/auth/dev-login - Dev mode login (localhost only)
app.post('/api/auth/dev-login', (req, res) => {
    // Localhost-only check (same as adminMiddleware but without auth requirement)
    if (req.headers['cf-ray'] || req.headers['x-forwarded-for']) {
        return res.status(403).json({ error: "Forbidden: Dev login only available on localhost" });
    }
    const ip = req.ip || req.connection.remoteAddress;
    const isLocal = ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';
    if (!isLocal) {
        return res.status(403).json({ error: "Forbidden: Dev login only available on localhost" });
    }
    
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ error: "Username required" });
    }
    
    // Create a dev session
    const sessionToken = createSession(username, DEV_DISCORD_ID, DEV_AVATAR, 'user');
    res.json({ 
        success: true, 
        session_token: sessionToken,
        user: {
            username,
            discord_id: DEV_DISCORD_ID,
            avatar: DEV_AVATAR,
            role: 'user'
        }
    });
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
app.put('/api/user/:username/profile', authMiddleware, ownerMiddleware('username'), async (req, res) => {
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
app.post('/api/user/:username/decoration', authMiddleware, ownerMiddleware('username'), async (req, res) => {
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
        'users': 'id',
        'posts': 'id',
        'scores': 'id',
        'user_achievements': 'id',
        'saved_games': 'id',
        'rhythm_pp': 'id',
        'explain_articles': 'id',
        'explain_revisions': 'id',
        'explain_categories': 'id',
        'explain_rate_limits': 'id'
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

// POST /api/admin/user/role - Update user role (admin only)
app.post('/api/admin/user/role', adminMiddleware, async (req, res) => {
    if (useInMemory) return res.status(400).json({ error: "Memory mode - role updates not available" });

    const { username, role } = req.body;

    if (!username || !role) {
        return res.status(400).json({ error: "Username and role are required" });
    }

    const validRoles = ['user', 'moderator', 'admin'];
    if (!validRoles.includes(role)) {
        return res.status(400).json({ error: "Invalid role. Must be: user, moderator, or admin" });
    }

    let conn;
    try {
        conn = await pool.getConnection();

        // Check if user exists
        const userCheck = await conn.query("SELECT username FROM users WHERE username = ?", [username]);
        if (userCheck.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        // Update user role
        await conn.query("UPDATE users SET role = ? WHERE username = ?", [role, username]);

        res.json({ success: true, message: `Updated ${username} to ${role}` });
    } catch (err) {
        console.error("Admin Role Update Error:", err);
        res.status(500).json({ error: "Failed to update role: " + err.message });
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

// POST /api/explain/categories - Create a new category
app.post('/api/explain/categories', async (req, res) => {
    const { name, description, color } = req.body;

    if (!name || name.trim().length < 2 || name.trim().length > 100) {
        return res.status(400).json({ error: 'Category name must be between 2 and 100 characters' });
    }

    // Validate color format (hex color)
    const colorValue = color && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : '#1DCD9F';
    const descValue = description ? description.substring(0, 500) : '';

    if (useInMemory) {
        return res.json({
            success: true,
            category: { id: Date.now(), name: name.trim(), description: descValue, color: colorValue }
        });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        await ensureExplainTables(conn);

        // Check if category with same name already exists
        const existing = await conn.query(
            `SELECT id FROM explain_categories WHERE LOWER(name) = LOWER(?)`,
            [name.trim()]
        );

        if (existing.length > 0) {
            return res.status(400).json({ error: 'A category with this name already exists' });
        }

        const result = await conn.query(
            `INSERT INTO explain_categories (name, description, color) VALUES (?, ?, ?)`,
            [name.trim(), descValue, colorValue]
        );

        res.json({
            success: true,
            category: {
                id: Number(result.insertId),
                name: name.trim(),
                description: descValue,
                color: colorValue
            }
        });
    } catch (err) {
        console.error('Error creating category:', err);
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

// =============================================
// Extended User Profile API
// =============================================

// Track initialization state
let extendedColumnsInitialized = false;
let friendsTableInitialized = false;
let multiplayerTablesInitialized = false;

// Ensure new columns exist (runs only once)
async function ensureUserExtendedColumns(conn) {
    if (extendedColumnsInitialized) return;
    try {
        await conn.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS role ENUM('user', 'moderator', 'admin', 'owner') DEFAULT 'user'");
        await conn.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS favorite_game VARCHAR(50) DEFAULT NULL");
        await conn.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_online TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
        await conn.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_settings JSON DEFAULT NULL");
        extendedColumnsInitialized = true;
        console.log("[OK] Extended user columns initialized.");
    } catch (err) {
        console.warn("Extended user columns migration warning:", err.message);
        extendedColumnsInitialized = true; // Don't retry on error
    }
}

// Ensure friends table exists (runs only once)
async function ensureFriendsTable(conn) {
    if (friendsTableInitialized) return;
    await conn.query(`
        CREATE TABLE IF NOT EXISTS friends (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user1 VARCHAR(255) NOT NULL,
            user2 VARCHAR(255) NOT NULL,
            status ENUM('pending', 'accepted', 'blocked') DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_friendship (user1, user2),
            INDEX idx_user1 (user1),
            INDEX idx_user2 (user2)
        )
    `);
    friendsTableInitialized = true;
    console.log("[OK] Friends table initialized.");
}

// GET /api/user/:username/full-profile - Get complete user profile with all stats
app.get('/api/user/:username/full-profile', async (req, res) => {
    const { username } = req.params;
    const requestingUser = req.query.viewer || null;

    if (useInMemory) {
        return res.json({
            username,
            discord_id: null,
            avatar: null,
            bio: null,
            role: 'user',
            favorite_game: null,
            last_online: new Date(),
            games_played: 0,
            total_score: 0,
            total_achievements: 0,
            posts_count: 0,
            articles_count: 0,
            points: 0,
            achievements: [],
            privacy: { show_stats: true, show_achievements: true, show_activity: true }
        });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        await ensureUserExtendedColumns(conn);

        // Get user data
        const userRes = await conn.query(`
            SELECT username, discord_id, avatar, bio, points, decoration, 
                   role, favorite_game, last_online, privacy_settings
            FROM users WHERE username = ?
        `, [username]);

        if (userRes.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const userData = userRes[0];
        let privacy = { show_stats: true, show_achievements: true, show_activity: true };
        try {
            if (userData.privacy_settings) {
                privacy = JSON.parse(userData.privacy_settings);
            }
        } catch (e) { }

        // Check if viewer is the profile owner
        const isOwner = requestingUser === username;

        // Get stats
        const statsRes = await conn.query(`
            SELECT 
                COUNT(DISTINCT game_id) as games_played,
                SUM(score) as total_score,
                MAX(score) as best_score
            FROM scores WHERE username = ?
        `, [username]);
        const stats = statsRes[0] || {};

        // Get achievements count
        const achRes = await conn.query("SELECT COUNT(*) as count FROM user_achievements WHERE username = ?", [username]);

        // Get posts count
        const postsRes = await conn.query("SELECT COUNT(*) as count FROM posts WHERE username = ?", [username]);

        // Get articles count
        let articlesCount = 0;
        try {
            const articlesRes = await conn.query("SELECT COUNT(*) as count FROM explain_articles WHERE author = ? AND status = 'approved'", [username]);
            articlesCount = Number(articlesRes[0]?.count) || 0;
        } catch (e) { }

        // Get achievements with images if allowed
        let achievements = [];
        if (isOwner || privacy.show_achievements) {
            const achListRes = await conn.query("SELECT achievement_id, game_id, unlocked_at FROM user_achievements WHERE username = ?", [username]);
            achievements = achListRes.map(a => {
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
        }

        // Get favorite game details
        let favoriteGameDetails = null;
        if (userData.favorite_game) {
            const gameData = getGameData(userData.favorite_game);
            if (gameData) {
                favoriteGameDetails = {
                    id: userData.favorite_game,
                    name: gameData.name,
                    image: `/src/games/${userData.favorite_game}/logo.png`
                };
            }
        }

        // Build response based on privacy
        const response = {
            username: userData.username,
            discord_id: userData.discord_id,
            avatar: userData.avatar,
            bio: userData.bio,
            role: userData.role || 'user',
            decoration: userData.decoration,
            points: Number(userData.points) || 0,
            favorite_game: favoriteGameDetails,
            last_online: (isOwner || privacy.show_activity) ? userData.last_online : null,
            games_played: (isOwner || privacy.show_stats) ? (Number(stats.games_played) || 0) : null,
            total_score: (isOwner || privacy.show_stats) ? (Number(stats.total_score) || 0) : null,
            best_score: (isOwner || privacy.show_stats) ? (Number(stats.best_score) || 0) : null,
            total_achievements: (isOwner || privacy.show_achievements) ? (Number(achRes[0]?.count) || 0) : null,
            posts_count: (isOwner || privacy.show_activity) ? (Number(postsRes[0]?.count) || 0) : null,
            articles_count: (isOwner || privacy.show_activity) ? articlesCount : null,
            achievements: achievements,
            privacy: isOwner ? privacy : null,
            is_owner: isOwner
        };

        res.json(response);
    } catch (err) {
        console.error("Full Profile Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// PUT /api/user/:username/settings - Update user settings (privacy, favorite game, etc.)
app.put('/api/user/:username/settings', authMiddleware, ownerMiddleware('username'), async (req, res) => {
    const { username } = req.params;
    const { favorite_game, privacy_settings, bio } = req.body;

    if (useInMemory) {
        return res.json({ success: true, mode: "memory" });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        await ensureUserExtendedColumns(conn);

        const updates = [];
        const values = [];

        if (favorite_game !== undefined) {
            updates.push("favorite_game = ?");
            values.push(favorite_game || null);
        }
        if (privacy_settings !== undefined) {
            updates.push("privacy_settings = ?");
            values.push(JSON.stringify(privacy_settings));
        }
        if (bio !== undefined) {
            updates.push("bio = ?");
            values.push(bio ? bio.substring(0, 500) : null);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: "No updates provided" });
        }

        values.push(username);
        await conn.query(`UPDATE users SET ${updates.join(', ')} WHERE username = ?`, values);

        res.json({ success: true });
    } catch (err) {
        console.error("Settings Update Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// =============================================
// Friends System API
// =============================================

// GET /api/user/:username/friends - Get user's friends list
app.get('/api/user/:username/friends', async (req, res) => {
    const { username } = req.params;

    if (useInMemory) {
        return res.json([]);
    }

    let conn;
    try {
        conn = await pool.getConnection();
        await ensureFriendsTable(conn);

        const friends = await conn.query(`
            SELECT 
                CASE WHEN f.user1 = ? THEN f.user2 ELSE f.user1 END as friend_username,
                f.status,
                f.created_at,
                u.discord_id,
                u.avatar,
                u.role,
                u.last_online
            FROM friends f
            JOIN users u ON (CASE WHEN f.user1 = ? THEN f.user2 ELSE f.user1 END) = u.username
            WHERE (f.user1 = ? OR f.user2 = ?) AND f.status = 'accepted'
        `, [username, username, username, username]);

        res.json(friends);
    } catch (err) {
        console.error("Friends List Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// GET /api/user/:username/friend-requests - Get pending friend requests
app.get('/api/user/:username/friend-requests', async (req, res) => {
    const { username } = req.params;

    if (useInMemory) {
        return res.json({ incoming: [], outgoing: [] });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        await ensureFriendsTable(conn);

        const incoming = await conn.query(`
            SELECT f.user1 as from_user, f.created_at, u.discord_id, u.avatar
            FROM friends f
            JOIN users u ON f.user1 = u.username
            WHERE f.user2 = ? AND f.status = 'pending'
        `, [username]);

        const outgoing = await conn.query(`
            SELECT f.user2 as to_user, f.created_at, u.discord_id, u.avatar
            FROM friends f
            JOIN users u ON f.user2 = u.username
            WHERE f.user1 = ? AND f.status = 'pending'
        `, [username]);

        res.json({ incoming, outgoing });
    } catch (err) {
        console.error("Friend Requests Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// POST /api/friends/request - Send friend request
app.post('/api/friends/request', authMiddleware, async (req, res) => {
    const { from_user, to_user } = req.body;

    // Verify the requester is the from_user
    if (req.session.username !== from_user) {
        return res.status(403).json({ error: "You can only send friend requests from your own account" });
    }

    if (!from_user || !to_user || from_user === to_user) {
        return res.status(400).json({ error: "Invalid users" });
    }

    if (useInMemory) {
        return res.json({ success: true, mode: "memory" });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        await ensureFriendsTable(conn);

        // Check if friendship already exists
        const existing = await conn.query(`
            SELECT * FROM friends 
            WHERE (user1 = ? AND user2 = ?) OR (user1 = ? AND user2 = ?)
        `, [from_user, to_user, to_user, from_user]);

        if (existing.length > 0) {
            return res.status(400).json({ error: "Friend request already exists or you are already friends" });
        }

        await conn.query(`
            INSERT INTO friends (user1, user2, status) VALUES (?, ?, 'pending')
        `, [from_user, to_user]);

        res.json({ success: true });
    } catch (err) {
        console.error("Friend Request Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// POST /api/friends/accept - Accept friend request
app.post('/api/friends/accept', authMiddleware, async (req, res) => {
    const { from_user, to_user } = req.body;

    // Verify the acceptor is the to_user (the one receiving the request)
    if (req.session.username !== to_user) {
        return res.status(403).json({ error: "You can only accept friend requests sent to you" });
    }

    if (useInMemory) {
        return res.json({ success: true, mode: "memory" });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(`
            UPDATE friends SET status = 'accepted' 
            WHERE user1 = ? AND user2 = ? AND status = 'pending'
        `, [from_user, to_user]);

        res.json({ success: true });
    } catch (err) {
        console.error("Accept Friend Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// POST /api/friends/decline - Decline/remove friend
app.post('/api/friends/decline', authMiddleware, async (req, res) => {
    const { user1, user2 } = req.body;

    // Verify the user is one of the parties in the friendship
    if (req.session.username !== user1 && req.session.username !== user2) {
        return res.status(403).json({ error: "You can only manage your own friendships" });
    }

    if (useInMemory) {
        return res.json({ success: true, mode: "memory" });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(`
            DELETE FROM friends 
            WHERE (user1 = ? AND user2 = ?) OR (user1 = ? AND user2 = ?)
        `, [user1, user2, user2, user1]);

        res.json({ success: true });
    } catch (err) {
        console.error("Decline Friend Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// GET /api/users/search - Search for users
app.get('/api/users/search', async (req, res) => {
    const { q } = req.query;

    if (!q || q.length < 2) {
        return res.status(400).json({ error: "Search query too short" });
    }

    if (useInMemory) {
        return res.json([]);
    }

    let conn;
    try {
        conn = await pool.getConnection();
        const users = await conn.query(`
            SELECT username, discord_id, avatar, role
            FROM users
            WHERE username LIKE ?
            LIMIT 20
        `, [`%${q}%`]);

        res.json(users);
    } catch (err) {
        console.error("User Search Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// =============================================
// Multiplayer API
// =============================================

// Ensure multiplayer tables exist (runs only once)
async function ensureMultiplayerTables(conn) {
    if (multiplayerTablesInitialized) return;
    await conn.query(`
        CREATE TABLE IF NOT EXISTS game_sessions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            session_id VARCHAR(100) NOT NULL UNIQUE,
            game_id VARCHAR(50) NOT NULL,
            host_username VARCHAR(255) NOT NULL,
            mode ENUM('against', 'party', 'coop') DEFAULT 'against',
            status ENUM('waiting', 'in_progress', 'finished') DEFAULT 'waiting',
            max_players INT DEFAULT 2,
            current_data JSON,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_game (game_id),
            INDEX idx_host (host_username),
            INDEX idx_status (status)
        )
    `);

    await conn.query(`
        CREATE TABLE IF NOT EXISTS game_session_players (
            id INT AUTO_INCREMENT PRIMARY KEY,
            session_id VARCHAR(100) NOT NULL,
            username VARCHAR(255) NOT NULL,
            status ENUM('invited', 'joined', 'left', 'declined') DEFAULT 'invited',
            player_data JSON,
            joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_player (session_id, username),
            INDEX idx_session (session_id),
            INDEX idx_username (username)
        )
    `);

    await conn.query(`
        CREATE TABLE IF NOT EXISTS game_invites (
            id INT AUTO_INCREMENT PRIMARY KEY,
            session_id VARCHAR(100) NOT NULL,
            from_username VARCHAR(255) NOT NULL,
            to_username VARCHAR(255) NOT NULL,
            status ENUM('pending', 'accepted', 'declined', 'expired') DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_to_user (to_username, status),
            INDEX idx_session (session_id)
        )
    `);
    multiplayerTablesInitialized = true;
    console.log("[OK] Multiplayer tables initialized.");
}

// POST /api/multiplayer/session - Create a new game session
app.post('/api/multiplayer/session', async (req, res) => {
    const { game_id, host_username, mode, max_players } = req.body;

    if (!game_id || !host_username) {
        return res.status(400).json({ error: "game_id and host_username required" });
    }

    const sessionId = `${game_id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const gameMode = ['against', 'party', 'coop'].includes(mode) ? mode : 'against';
    const maxP = Math.min(Math.max(parseInt(max_players) || 2, 2), 10);

    if (useInMemory) {
        return res.json({ success: true, session_id: sessionId, mode: "memory" });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        await ensureMultiplayerTables(conn);

        await conn.query(`
            INSERT INTO game_sessions (session_id, game_id, host_username, mode, max_players)
            VALUES (?, ?, ?, ?, ?)
        `, [sessionId, game_id, host_username, gameMode, maxP]);

        // Add host as first player
        await conn.query(`
            INSERT INTO game_session_players (session_id, username, status)
            VALUES (?, ?, 'joined')
        `, [sessionId, host_username]);

        res.json({ success: true, session_id: sessionId });
    } catch (err) {
        console.error("Create Session Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// GET /api/multiplayer/session/:sessionId - Get session details
app.get('/api/multiplayer/session/:sessionId', async (req, res) => {
    const { sessionId } = req.params;

    if (useInMemory) {
        return res.status(404).json({ error: "Session not found" });
    }

    let conn;
    try {
        conn = await pool.getConnection();

        const sessions = await conn.query(`
            SELECT * FROM game_sessions WHERE session_id = ?
        `, [sessionId]);

        if (sessions.length === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        const players = await conn.query(`
            SELECT sp.*, u.discord_id, u.avatar
            FROM game_session_players sp
            LEFT JOIN users u ON sp.username = u.username
            WHERE sp.session_id = ?
        `, [sessionId]);

        res.json({
            ...sessions[0],
            players
        });
    } catch (err) {
        console.error("Get Session Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// POST /api/multiplayer/invite - Send game invite
app.post('/api/multiplayer/invite', async (req, res) => {
    const { session_id, from_username, to_username } = req.body;

    if (!session_id || !from_username || !to_username) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    if (useInMemory) {
        return res.json({ success: true, mode: "memory" });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        await ensureMultiplayerTables(conn);

        // Verify session exists
        const sessions = await conn.query(`SELECT * FROM game_sessions WHERE session_id = ? AND status = 'waiting'`, [session_id]);
        if (sessions.length === 0) {
            return res.status(404).json({ error: "Session not found or not accepting players" });
        }

        // Create invite
        await conn.query(`
            INSERT INTO game_invites (session_id, from_username, to_username)
            VALUES (?, ?, ?)
        `, [session_id, from_username, to_username]);

        // Add player as invited
        await conn.query(`
            INSERT IGNORE INTO game_session_players (session_id, username, status)
            VALUES (?, ?, 'invited')
        `, [session_id, to_username]);

        res.json({ success: true });
    } catch (err) {
        console.error("Send Invite Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// GET /api/multiplayer/invites/:username - Get pending invites for user
app.get('/api/multiplayer/invites/:username', async (req, res) => {
    const { username } = req.params;

    if (useInMemory) {
        return res.json([]);
    }

    let conn;
    try {
        conn = await pool.getConnection();

        const invites = await conn.query(`
            SELECT gi.*, gs.game_id, gs.mode, gs.host_username,
                   u.discord_id as from_avatar_discord_id, u.avatar as from_avatar
            FROM game_invites gi
            JOIN game_sessions gs ON gi.session_id = gs.session_id
            JOIN users u ON gi.from_username = u.username
            WHERE gi.to_username = ? AND gi.status = 'pending' AND gs.status = 'waiting'
            ORDER BY gi.created_at DESC
        `, [username]);

        res.json(invites);
    } catch (err) {
        console.error("Get Invites Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// POST /api/multiplayer/invite/respond - Accept or decline invite
app.post('/api/multiplayer/invite/respond', async (req, res) => {
    const { invite_id, session_id, username, accept } = req.body;

    if (useInMemory) {
        return res.json({ success: true, mode: "memory" });
    }

    let conn;
    try {
        conn = await pool.getConnection();

        if (accept) {
            // Update invite
            await conn.query(`UPDATE game_invites SET status = 'accepted' WHERE id = ?`, [invite_id]);
            // Update player status
            await conn.query(`
                UPDATE game_session_players SET status = 'joined' 
                WHERE session_id = ? AND username = ?
            `, [session_id, username]);
        } else {
            await conn.query(`UPDATE game_invites SET status = 'declined' WHERE id = ?`, [invite_id]);
            await conn.query(`
                UPDATE game_session_players SET status = 'declined' 
                WHERE session_id = ? AND username = ?
            `, [session_id, username]);
        }

        res.json({ success: true });
    } catch (err) {
        console.error("Respond Invite Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// POST /api/multiplayer/session/:sessionId/action - Send game action (for turn-based games)
app.post('/api/multiplayer/session/:sessionId/action', async (req, res) => {
    const { sessionId } = req.params;
    const { username, action_type, action_data } = req.body;

    if (useInMemory) {
        return res.json({ success: true, mode: "memory" });
    }

    let conn;
    try {
        conn = await pool.getConnection();

        // Get current session data
        const sessions = await conn.query(`SELECT * FROM game_sessions WHERE session_id = ?`, [sessionId]);
        if (sessions.length === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        let currentData = {};
        try {
            currentData = sessions[0].current_data ? JSON.parse(sessions[0].current_data) : {};
        } catch (e) { }

        // Add action to history
        if (!currentData.actions) currentData.actions = [];
        currentData.actions.push({
            username,
            action_type,
            action_data,
            timestamp: new Date().toISOString()
        });
        currentData.last_action = { username, action_type, action_data };

        await conn.query(`
            UPDATE game_sessions SET current_data = ?, updated_at = NOW()
            WHERE session_id = ?
        `, [JSON.stringify(currentData), sessionId]);

        res.json({ success: true, current_data: currentData });
    } catch (err) {
        console.error("Session Action Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// POST /api/multiplayer/session/:sessionId/start - Start the game session
app.post('/api/multiplayer/session/:sessionId/start', async (req, res) => {
    const { sessionId } = req.params;

    if (useInMemory) {
        return res.json({ success: true, mode: "memory" });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(`
            UPDATE game_sessions SET status = 'in_progress', updated_at = NOW()
            WHERE session_id = ? AND status = 'waiting'
        `, [sessionId]);

        res.json({ success: true });
    } catch (err) {
        console.error("Start Session Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// POST /api/multiplayer/session/:sessionId/end - End the game session
app.post('/api/multiplayer/session/:sessionId/end', async (req, res) => {
    const { sessionId } = req.params;
    const { winner, final_data } = req.body;

    if (useInMemory) {
        return res.json({ success: true, mode: "memory" });
    }

    let conn;
    try {
        conn = await pool.getConnection();

        let currentData = {};
        const sessions = await conn.query(`SELECT current_data FROM game_sessions WHERE session_id = ?`, [sessionId]);
        if (sessions.length > 0 && sessions[0].current_data) {
            try {
                currentData = JSON.parse(sessions[0].current_data);
            } catch (e) { }
        }

        currentData.winner = winner;
        currentData.final_data = final_data;
        currentData.ended_at = new Date().toISOString();

        await conn.query(`
            UPDATE game_sessions SET status = 'finished', current_data = ?, updated_at = NOW()
            WHERE session_id = ?
        `, [JSON.stringify(currentData), sessionId]);

        res.json({ success: true });
    } catch (err) {
        console.error("End Session Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// =============================================
// Moderator Routes (Role-based access)
// =============================================

// Middleware to check moderator role - uses session authentication
const moderatorMiddleware = async (req, res, next) => {
    // First, verify the session token
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : req.query.session_token;
    
    const session = getSession(token);
    
    if (!session) {
        return res.status(401).json({ error: "Authentication required. Please log in." });
    }
    
    // Attach session to request
    req.session = session;

    // In dev mode with in-memory storage, allow access
    if (useInMemory) {
        return next();
    }

    // Check if user has moderator, admin, or owner role from session
    if (!['moderator', 'admin', 'owner'].includes(session.role)) {
        return res.status(403).json({ error: "Insufficient permissions. Moderator access required." });
    }

    next();
};

// POST /api/moderator/article/:id/approve - Moderator approve article
app.post('/api/moderator/article/:id/approve', moderatorMiddleware, async (req, res) => {
    const { id } = req.params;

    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(`UPDATE explain_articles SET status = 'approved' WHERE id = ?`, [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Moderator approve article error:', err);
        res.status(500).json({ error: 'Database error' });
    } finally {
        if (conn) conn.release();
    }
});

// POST /api/moderator/article/:id/reject - Moderator reject article
app.post('/api/moderator/article/:id/reject', moderatorMiddleware, async (req, res) => {
    const { id } = req.params;

    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(`UPDATE explain_articles SET status = 'rejected' WHERE id = ?`, [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Moderator reject article error:', err);
        res.status(500).json({ error: 'Database error' });
    } finally {
        if (conn) conn.release();
    }
});

// GET /api/moderator/pending - Get pending items for moderators
app.get('/api/moderator/pending', moderatorMiddleware, async (req, res) => {
    if (useInMemory) {
        return res.json({ articles: [], revisions: [] });
    }

    let conn;
    try {
        conn = await pool.getConnection();

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
        console.error('Moderator pending error:', err);
        res.status(500).json({ error: 'Database error' });
    } finally {
        if (conn) conn.release();
    }
});

// =============================================
// Post Moderation Routes
// =============================================

// GET /api/moderator/posts/pending - Get pending posts for moderators
app.get('/api/moderator/posts/pending', moderatorMiddleware, async (req, res) => {
    if (useInMemory) {
        return res.json([]);
    }

    let conn;
    try {
        conn = await pool.getConnection();

        const posts = await conn.query(`
            SELECT p.*, u.discord_id, u.avatar
            FROM posts p
            LEFT JOIN users u ON p.username = u.username
            WHERE p.status = 'pending'
            ORDER BY p.created_at ASC
        `);

        res.json(posts);
    } catch (err) {
        console.error('Get pending posts error:', err);
        res.status(500).json({ error: 'Database error' });
    } finally {
        if (conn) conn.release();
    }
});

// POST /api/moderator/post/:id/approve - Approve a post
app.post('/api/moderator/post/:id/approve', moderatorMiddleware, async (req, res) => {
    const { id } = req.params;

    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(`UPDATE posts SET status = 'approved' WHERE id = ?`, [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Approve post error:', err);
        res.status(500).json({ error: 'Database error' });
    } finally {
        if (conn) conn.release();
    }
});

// POST /api/moderator/post/:id/reject - Reject a post
app.post('/api/moderator/post/:id/reject', moderatorMiddleware, async (req, res) => {
    const { id } = req.params;

    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(`UPDATE posts SET status = 'rejected' WHERE id = ?`, [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Reject post error:', err);
        res.status(500).json({ error: 'Database error' });
    } finally {
        if (conn) conn.release();
    }
});

// DELETE /api/moderator/post/:id - Delete a post (moderator)
app.delete('/api/moderator/post/:id', moderatorMiddleware, async (req, res) => {
    const { id } = req.params;

    let conn;
    try {
        conn = await pool.getConnection();
        const result = await conn.query(`DELETE FROM posts WHERE id = ?`, [id]);

        if (result.affectedRows > 0) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Post not found' });
        }
    } catch (err) {
        console.error('Delete post error:', err);
        res.status(500).json({ error: 'Database error' });
    } finally {
        if (conn) conn.release();
    }
});

// GET /api/moderator/posts/all - Get all posts for moderation (with status filter)
app.get('/api/moderator/posts/all', moderatorMiddleware, async (req, res) => {
    const { status } = req.query;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    if (useInMemory) {
        return res.json([]);
    }

    let conn;
    try {
        conn = await pool.getConnection();

        let query = `
            SELECT p.*, u.discord_id, u.avatar
            FROM posts p
            LEFT JOIN users u ON p.username = u.username
        `;
        const params = [];

        if (status && ['pending', 'approved', 'rejected'].includes(status)) {
            query += ` WHERE p.status = ?`;
            params.push(status);
        }

        query += ` ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const posts = await conn.query(query, params);
        res.json(posts);
    } catch (err) {
        console.error('Get all posts error:', err);
        res.status(500).json({ error: 'Database error' });
    } finally {
        if (conn) conn.release();
    }
});

// =============================================
// Rhythm Circle Game API Routes
// =============================================

// In-memory storage for rhythm game PP scores
let memoryRhythmPP = [];

// GET /api/rhythm/maps - Scan for rhythm game maps
app.get('/api/rhythm/maps', (req, res) => {
    const mapsDir = path.join(__dirname, '../../games/rhythm_circle/maps');
    if (!fs.existsSync(mapsDir)) {
        return res.json([]);
    }

    try {
        const songs = fs.readdirSync(mapsDir).map(folder => {
            const mapPath = path.join(mapsDir, folder, 'map.json');
            if (fs.existsSync(mapPath)) {
                try {
                    const data = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
                    return {
                        id: folder,
                        title: data.title || folder,
                        artist: data.artist || 'Unknown',
                        difficulty: data.difficulty || 'Normal',
                        difficultyLevel: data.difficultyLevel || 3,
                        bpm: data.bpm || 120,
                        noteCount: data.notes ? data.notes.length : 0,
                        path: `/src/games/rhythm_circle/maps/${folder}`
                    };
                } catch (e) {
                    return null;
                }
            }
            return null;
        }).filter(s => s !== null);

        res.json(songs);
    } catch (err) {
        console.error("Error scanning rhythm maps:", err);
        res.status(500).json({ error: "Failed to scan maps" });
    }
});

// POST /api/rhythm/pp - Submit PP score for rhythm game
app.post('/api/rhythm/pp', async (req, res) => {
    try {
        const { username, song_id, score, pp, accuracy, max_combo } = req.body;

        if (!username || !song_id || pp === undefined) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const ppRecord = {
            username,
            song_id,
            score: parseInt(score) || 0,
            pp: parseInt(pp) || 0,
            accuracy: parseFloat(accuracy) || 0,
            max_combo: parseInt(max_combo) || 0,
            created_at: new Date()
        };

        if (useInMemory) {
            // Check if user has a better score on this song
            const existingIdx = memoryRhythmPP.findIndex(r =>
                r.username === username && r.song_id === song_id
            );

            if (existingIdx >= 0) {
                // Only update if new PP is higher
                if (ppRecord.pp > memoryRhythmPP[existingIdx].pp) {
                    memoryRhythmPP[existingIdx] = ppRecord;
                }
            } else {
                memoryRhythmPP.push(ppRecord);
            }

            return res.json({ success: true, mode: "memory" });
        }

        let conn;
        try {
            conn = await pool.getConnection();

            // Ensure rhythm_pp table exists
            await conn.query(`
                CREATE TABLE IF NOT EXISTS rhythm_pp (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(255) NOT NULL,
                    song_id VARCHAR(100) NOT NULL,
                    score INT DEFAULT 0,
                    pp INT DEFAULT 0,
                    accuracy DECIMAL(5,2) DEFAULT 0,
                    max_combo INT DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY unique_user_song (username, song_id),
                    INDEX idx_pp (pp DESC)
                )
            `);

            // Upsert - only update all stats when new PP is higher than existing
            // This preserves the best PP score per song for each user
            await conn.query(`
                INSERT INTO rhythm_pp (username, song_id, score, pp, accuracy, max_combo)
                VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE 
                    score = IF(VALUES(pp) > pp, VALUES(score), score),
                    pp = IF(VALUES(pp) > pp, VALUES(pp), pp),
                    accuracy = IF(VALUES(pp) > pp, VALUES(accuracy), accuracy),
                    max_combo = IF(VALUES(pp) > pp, VALUES(max_combo), max_combo),
                    created_at = IF(VALUES(pp) > pp, NOW(), created_at)
            `, [username, song_id, ppRecord.score, ppRecord.pp, ppRecord.accuracy, ppRecord.max_combo]);

            res.json({ success: true });
        } finally {
            if (conn) conn.release();
        }
    } catch (err) {
        console.error("Rhythm PP Error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// GET /api/rhythm/pp/leaderboard - Get PP leaderboard
app.get('/api/rhythm/pp/leaderboard', async (req, res) => {
    const limit = parseInt(req.query.limit) || 10;

    if (useInMemory) {
        // Calculate total PP per user
        const userPP = {};
        memoryRhythmPP.forEach(r => {
            if (!userPP[r.username]) {
                userPP[r.username] = { username: r.username, total_pp: 0, play_count: 0 };
            }
            userPP[r.username].total_pp += r.pp;
            userPP[r.username].play_count++;
        });

        const leaderboard = Object.values(userPP)
            .sort((a, b) => b.total_pp - a.total_pp)
            .slice(0, limit);

        return res.json(leaderboard);
    }

    let conn;
    try {
        conn = await pool.getConnection();

        const rows = await conn.query(`
            SELECT 
                r.username,
                SUM(r.pp) as total_pp,
                COUNT(*) as play_count,
                u.discord_id,
                u.avatar
            FROM rhythm_pp r
            LEFT JOIN users u ON r.username = u.username
            GROUP BY r.username
            ORDER BY total_pp DESC
            LIMIT ?
        `, [limit]);

        res.json(rows);
    } catch (err) {
        console.error("PP Leaderboard Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// GET /api/rhythm/pp/user/:username - Get user's PP scores
app.get('/api/rhythm/pp/user/:username', async (req, res) => {
    const { username } = req.params;

    if (useInMemory) {
        const userScores = memoryRhythmPP
            .filter(r => r.username === username)
            .sort((a, b) => b.pp - a.pp);

        const totalPP = userScores.reduce((sum, r) => sum + r.pp, 0);

        return res.json({
            username,
            total_pp: totalPP,
            scores: userScores
        });
    }

    let conn;
    try {
        conn = await pool.getConnection();

        const scores = await conn.query(`
            SELECT song_id, score, pp, accuracy, max_combo, created_at
            FROM rhythm_pp
            WHERE username = ?
            ORDER BY pp DESC
        `, [username]);

        const totalPP = scores.reduce((sum, r) => sum + Number(r.pp), 0);

        res.json({
            username,
            total_pp: totalPP,
            scores
        });
    } catch (err) {
        console.error("User PP Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// GET /api/rhythm/pp/song/:songId - Get leaderboard for a specific song
app.get('/api/rhythm/pp/song/:songId', async (req, res) => {
    const { songId } = req.params;
    const limit = parseInt(req.query.limit) || 10;

    if (useInMemory) {
        const songScores = memoryRhythmPP
            .filter(r => r.song_id === songId)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        return res.json(songScores);
    }

    let conn;
    try {
        conn = await pool.getConnection();

        const rows = await conn.query(`
            SELECT 
                r.username,
                r.score,
                r.pp,
                r.accuracy,
                r.max_combo,
                r.created_at,
                u.discord_id,
                u.avatar
            FROM rhythm_pp r
            LEFT JOIN users u ON r.username = u.username
            WHERE r.song_id = ?
            ORDER BY r.score DESC
            LIMIT ?
        `, [songId, limit]);

        res.json(rows);
    } catch (err) {
        console.error("Song Leaderboard Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// =============================================
// Anidle Game API
// =============================================

// Anime data cache - fetched from Jikan API (MyAnimeList)
let anidleAnimeCache = [];
let anidleCacheLastUpdate = null;
const ANIDLE_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const JIKAN_API_BASE = 'https://api.jikan.moe/v4';

// Helper to delay between API calls (Jikan has rate limits)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Check if anime is a sequel/alternative based on title patterns
function isSequelOrAlternative(anime) {
    const title = (anime.title || '').toLowerCase();
    const sequelPatterns = [
        'season 2', 'season 3', 'season 4', 'season 5', 'season 6',
        '2nd season', '3rd season', '4th season', '5th season',
        'part 2', 'part 3', 'part ii', 'part iii', 'part iv',
        'the final', 'final season', 'cour 2',
        ': r2', ': shippuuden', ': shippuden',
        'movie', 'ova', 'special', 'recap',
        ' ii', ' iii', ' iv', ' 2:', ' 3:', ' 4:'
    ];
    return sequelPatterns.some(pattern => title.includes(pattern));
}

// Fetch anime from Jikan API and transform to our format
async function fetchAnimeFromJikan(page = 1) {
    try {
        // Fetch top anime by score, TV only, ordered by popularity
        const url = `${JIKAN_API_BASE}/top/anime?type=tv&filter=bypopularity&page=${page}&limit=25`;
        const response = await axios.get(url, { timeout: 10000 });

        if (!response.data || !response.data.data) {
            return [];
        }

        const animeList = response.data.data;
        const transformedAnime = [];

        for (const anime of animeList) {
            // Skip sequels and alternatives
            if (isSequelOrAlternative(anime)) continue;

            // Extract studio name
            const studio = anime.studios && anime.studios.length > 0
                ? anime.studios[0].name
                : 'Unknown';

            // Extract genres
            const genres = (anime.genres || []).map(g => g.name);

            // Extract themes as tags (primary) and demographics as tags (secondary)
            const tags = [];
            if (anime.themes) {
                anime.themes.forEach(t => tags.push({ name: t.name, primary: true }));
            }
            if (anime.demographics) {
                anime.demographics.forEach(d => tags.push({ name: d.name, primary: false }));
            }

            // Get release year
            const releaseDate = anime.aired?.from
                ? new Date(anime.aired.from).getFullYear().toString()
                : 'Unknown';

            transformedAnime.push({
                mal_id: anime.mal_id,
                title: anime.title,
                title_english: anime.title_english || anime.title,
                score: anime.score || 0,
                studio: studio,
                genres: genres,
                release_date: releaseDate,
                source: anime.source || 'Unknown',
                tags: tags.slice(0, 6), // Limit to 6 tags
                image: anime.images?.jpg?.image_url || anime.images?.jpg?.large_image_url,
                synopsis: anime.synopsis ? anime.synopsis.substring(0, 300) + '...' : 'No synopsis available.',
                main_character: null // Will be fetched separately if needed
            });
        }

        return transformedAnime;
    } catch (error) {
        console.error(`Error fetching anime from Jikan (page ${page}):`, error.message);
        return [];
    }
}

// Fetch main character for an anime
async function fetchMainCharacter(malId) {
    try {
        const url = `${JIKAN_API_BASE}/anime/${malId}/characters`;
        const response = await axios.get(url, { timeout: 10000 });

        if (response.data && response.data.data && response.data.data.length > 0) {
            // Get the first main character or the most favorited one
            const mainChar = response.data.data.find(c => c.role === 'Main') || response.data.data[0];
            if (mainChar && mainChar.character) {
                return {
                    name: mainChar.character.name,
                    image: mainChar.character.images?.jpg?.image_url
                };
            }
        }
        return null;
    } catch (error) {
        console.error(`Error fetching character for anime ${malId}:`, error.message);
        return null;
    }
}

// Initialize or refresh the anime cache
async function refreshAnidleCache() {
    console.log('[Anidle] Refreshing anime cache from Jikan API...');
    const allAnime = [];

    // Fetch first 4 pages (100 anime, after filtering should be ~50-70)
    for (let page = 1; page <= 4; page++) {
        const anime = await fetchAnimeFromJikan(page);
        allAnime.push(...anime);

        // Respect Jikan rate limit (3 requests per second)
        if (page < 4) await delay(400);
    }

    if (allAnime.length > 0) {
        anidleAnimeCache = allAnime;
        anidleCacheLastUpdate = Date.now();
        console.log(`[Anidle] Cache refreshed with ${allAnime.length} anime`);
    } else if (anidleAnimeCache.length === 0) {
        // Use fallback data if API is unreachable and cache is empty
        console.warn('[Anidle] Failed to fetch from API, using fallback data');
        anidleAnimeCache = getAnidleFallbackData();
        anidleCacheLastUpdate = Date.now();
        console.log(`[Anidle] Loaded ${anidleAnimeCache.length} anime from fallback`);
    } else {
        console.warn('[Anidle] Failed to fetch anime, using existing cache');
    }
}

// Fallback anime data in case API is unreachable
function getAnidleFallbackData() {
    return [
        { mal_id: 5114, title: "Fullmetal Alchemist: Brotherhood", title_english: "Fullmetal Alchemist: Brotherhood", score: 9.10, studio: "Bones", genres: ["Action", "Adventure", "Drama", "Fantasy"], release_date: "2009", source: "Manga", tags: [{ name: "Military", primary: true }, { name: "Shounen", primary: false }], image: "https://cdn.myanimelist.net/images/anime/1223/96541.jpg", synopsis: "Two brothers search for the Philosopher's Stone to restore their bodies after a failed alchemy experiment.", main_character: { name: "Edward Elric", image: "https://cdn.myanimelist.net/images/characters/9/72533.jpg" } },
        { mal_id: 1535, title: "Death Note", title_english: "Death Note", score: 8.62, studio: "Madhouse", genres: ["Supernatural", "Suspense"], release_date: "2006", source: "Manga", tags: [{ name: "Psychological", primary: true }, { name: "Shounen", primary: false }], image: "https://cdn.myanimelist.net/images/anime/9/9453.jpg", synopsis: "Light Yagami finds a notebook that kills anyone whose name is written in it.", main_character: { name: "Light Yagami", image: "https://cdn.myanimelist.net/images/characters/2/84177.jpg" } },
        { mal_id: 16498, title: "Shingeki no Kyojin", title_english: "Attack on Titan", score: 8.54, studio: "Wit Studio", genres: ["Action", "Drama", "Fantasy", "Mystery"], release_date: "2013", source: "Manga", tags: [{ name: "Military", primary: true }, { name: "Shounen", primary: false }], image: "https://cdn.myanimelist.net/images/anime/10/47347.jpg", synopsis: "Humanity lives within enormous walled cities to protect themselves from Titans.", main_character: { name: "Eren Yeager", image: "https://cdn.myanimelist.net/images/characters/10/216895.jpg" } },
        { mal_id: 11061, title: "Hunter x Hunter (2011)", title_english: "Hunter x Hunter", score: 9.04, studio: "Madhouse", genres: ["Action", "Adventure", "Fantasy"], release_date: "2011", source: "Manga", tags: [{ name: "Shounen", primary: true }, { name: "Adventure", primary: true }], image: "https://cdn.myanimelist.net/images/anime/1337/99013.jpg", synopsis: "Gon Freecss discovers his father is a legendary Hunter and sets out to become one himself.", main_character: { name: "Gon Freecss", image: "https://cdn.myanimelist.net/images/characters/11/174517.jpg" } },
        { mal_id: 9253, title: "Steins;Gate", title_english: "Steins;Gate", score: 9.08, studio: "White Fox", genres: ["Drama", "Sci-Fi", "Suspense"], release_date: "2011", source: "Visual novel", tags: [{ name: "Time Travel", primary: true }, { name: "Thriller", primary: true }], image: "https://cdn.myanimelist.net/images/anime/5/73199.jpg", synopsis: "A self-proclaimed mad scientist discovers he can send messages to the past.", main_character: { name: "Rintarou Okabe", image: "https://cdn.myanimelist.net/images/characters/6/122643.jpg" } },
        { mal_id: 38000, title: "Kimetsu no Yaiba", title_english: "Demon Slayer", score: 8.45, studio: "ufotable", genres: ["Action", "Fantasy"], release_date: "2019", source: "Manga", tags: [{ name: "Historical", primary: true }, { name: "Shounen", primary: false }], image: "https://cdn.myanimelist.net/images/anime/1286/99889.jpg", synopsis: "Tanjiro Kamado becomes a demon slayer to avenge his family and cure his sister.", main_character: { name: "Tanjiro Kamado", image: "https://cdn.myanimelist.net/images/characters/6/386735.jpg" } },
        { mal_id: 40748, title: "Jujutsu Kaisen", title_english: "Jujutsu Kaisen", score: 8.60, studio: "MAPPA", genres: ["Action", "Fantasy"], release_date: "2020", source: "Manga", tags: [{ name: "School", primary: true }, { name: "Supernatural", primary: true }], image: "https://cdn.myanimelist.net/images/anime/1171/109222.jpg", synopsis: "Yuji Itadori swallows a cursed finger and becomes host to a powerful curse.", main_character: { name: "Yuji Itadori", image: "https://cdn.myanimelist.net/images/characters/6/467646.jpg" } },
        { mal_id: 21, title: "One Piece", title_english: "One Piece", score: 8.71, studio: "Toei Animation", genres: ["Action", "Adventure", "Fantasy"], release_date: "1999", source: "Manga", tags: [{ name: "Pirates", primary: true }, { name: "Shounen", primary: false }], image: "https://cdn.myanimelist.net/images/anime/6/73245.jpg", synopsis: "Monkey D. Luffy sets out to become the King of Pirates.", main_character: { name: "Monkey D. Luffy", image: "https://cdn.myanimelist.net/images/characters/9/310307.jpg" } },
        { mal_id: 1735, title: "Naruto", title_english: "Naruto", score: 8.00, studio: "Pierrot", genres: ["Action", "Adventure", "Fantasy"], release_date: "2002", source: "Manga", tags: [{ name: "Ninja", primary: true }, { name: "Shounen", primary: false }], image: "https://cdn.myanimelist.net/images/anime/13/17405.jpg", synopsis: "Naruto Uzumaki dreams of becoming the Hokage.", main_character: { name: "Naruto Uzumaki", image: "https://cdn.myanimelist.net/images/characters/2/284121.jpg" } },
        { mal_id: 31964, title: "Boku no Hero Academia", title_english: "My Hero Academia", score: 7.95, studio: "Bones", genres: ["Action", "Comedy"], release_date: "2016", source: "Manga", tags: [{ name: "Superhero", primary: true }, { name: "School", primary: true }], image: "https://cdn.myanimelist.net/images/anime/10/78745.jpg", synopsis: "Izuku Midoriya dreams of becoming a hero in a world where superpowers are common.", main_character: { name: "Izuku Midoriya", image: "https://cdn.myanimelist.net/images/characters/7/299404.jpg" } },
        { mal_id: 40456, title: "Spy x Family", title_english: "Spy x Family", score: 8.51, studio: "Wit Studio", genres: ["Action", "Comedy"], release_date: "2022", source: "Manga", tags: [{ name: "Family", primary: true }, { name: "Espionage", primary: true }], image: "https://cdn.myanimelist.net/images/anime/1441/122795.jpg", synopsis: "A spy must create a fake family to complete his mission.", main_character: { name: "Anya Forger", image: "https://cdn.myanimelist.net/images/characters/8/461346.jpg" } },
        { mal_id: 48583, title: "Chainsaw Man", title_english: "Chainsaw Man", score: 8.54, studio: "MAPPA", genres: ["Action", "Fantasy"], release_date: "2022", source: "Manga", tags: [{ name: "Gore", primary: true }, { name: "Supernatural", primary: true }], image: "https://cdn.myanimelist.net/images/anime/1806/126216.jpg", synopsis: "Denji becomes a devil hunter after merging with his chainsaw devil pet.", main_character: { name: "Denji", image: "https://cdn.myanimelist.net/images/characters/3/489135.jpg" } },
        { mal_id: 32281, title: "Kimi no Na wa.", title_english: "Your Name", score: 8.83, studio: "CoMix Wave Films", genres: ["Drama", "Romance", "Supernatural"], release_date: "2016", source: "Original", tags: [{ name: "Time", primary: true }, { name: "Romance", primary: false }], image: "https://cdn.myanimelist.net/images/anime/5/87048.jpg", synopsis: "Two teenagers discover they are swapping bodies.", main_character: { name: "Mitsuha Miyamizu", image: "https://cdn.myanimelist.net/images/characters/14/316108.jpg" } },
        { mal_id: 37521, title: "Vinland Saga", title_english: "Vinland Saga", score: 8.72, studio: "Wit Studio", genres: ["Action", "Adventure", "Drama"], release_date: "2019", source: "Manga", tags: [{ name: "Vikings", primary: true }, { name: "Historical", primary: true }], image: "https://cdn.myanimelist.net/images/anime/1500/103005.jpg", synopsis: "Thorfinn seeks revenge in the Viking era.", main_character: { name: "Thorfinn", image: "https://cdn.myanimelist.net/images/characters/9/379687.jpg" } },
        { mal_id: 20583, title: "Haikyuu!!", title_english: "Haikyu!!", score: 8.44, studio: "Production I.G", genres: ["Sports"], release_date: "2014", source: "Manga", tags: [{ name: "Volleyball", primary: true }, { name: "Team", primary: true }], image: "https://cdn.myanimelist.net/images/anime/7/76014.jpg", synopsis: "Shoyo Hinata joins a high school volleyball team.", main_character: { name: "Shouyou Hinata", image: "https://cdn.myanimelist.net/images/characters/11/280453.jpg" } },
        { mal_id: 1, title: "Cowboy Bebop", title_english: "Cowboy Bebop", score: 8.75, studio: "Sunrise", genres: ["Action", "Adventure", "Sci-Fi"], release_date: "1998", source: "Original", tags: [{ name: "Space", primary: true }, { name: "Adult Cast", primary: false }], image: "https://cdn.myanimelist.net/images/anime/4/19644.jpg", synopsis: "Bounty hunters travel through space catching criminals.", main_character: { name: "Spike Spiegel", image: "https://cdn.myanimelist.net/images/characters/4/50197.jpg" } },
        { mal_id: 30831, title: "Kono Subarashii Sekai ni Shukufuku wo!", title_english: "KONOSUBA", score: 8.11, studio: "Studio Deen", genres: ["Adventure", "Comedy", "Fantasy"], release_date: "2016", source: "Light novel", tags: [{ name: "Isekai", primary: true }, { name: "Parody", primary: true }], image: "https://cdn.myanimelist.net/images/anime/8/77831.jpg", synopsis: "A teenager is reincarnated in a fantasy world with a useless goddess.", main_character: { name: "Kazuma Satou", image: "https://cdn.myanimelist.net/images/characters/13/291295.jpg" } },
        { mal_id: 22535, title: "Kiseijuu: Sei no Kakuritsu", title_english: "Parasyte -the maxim-", score: 8.35, studio: "Madhouse", genres: ["Action", "Horror", "Sci-Fi"], release_date: "2014", source: "Manga", tags: [{ name: "Gore", primary: true }, { name: "Psychological", primary: false }], image: "https://cdn.myanimelist.net/images/anime/3/73178.jpg", synopsis: "Shinichi's hand is taken over by a parasitic alien.", main_character: { name: "Shinichi Izumi", image: "https://cdn.myanimelist.net/images/characters/2/264549.jpg" } },
        { mal_id: 52299, title: "Oshi no Ko", title_english: "Oshi No Ko", score: 8.55, studio: "Doga Kobo", genres: ["Drama", "Supernatural"], release_date: "2023", source: "Manga", tags: [{ name: "Idol", primary: true }, { name: "Reincarnation", primary: true }], image: "https://cdn.myanimelist.net/images/anime/1812/134736.jpg", synopsis: "A doctor reincarnated as the child of his favorite idol.", main_character: { name: "Aqua Hoshino", image: "https://cdn.myanimelist.net/images/characters/6/506389.jpg" } },
        { mal_id: 50265, title: "Bocchi the Rock!", title_english: "Bocchi the Rock!", score: 8.77, studio: "CloverWorks", genres: ["Comedy"], release_date: "2022", source: "Manga", tags: [{ name: "Music", primary: true }, { name: "CGDCT", primary: false }], image: "https://cdn.myanimelist.net/images/anime/1448/127956.jpg", synopsis: "A socially anxious girl joins a rock band.", main_character: { name: "Hitori Gotou", image: "https://cdn.myanimelist.net/images/characters/16/497656.jpg" } }
    ];
}

// Get valid anime list (with cache check)
async function getAnidleValidAnime() {
    // Check if cache needs refresh
    const now = Date.now();
    const cacheExpired = !anidleCacheLastUpdate || (now - anidleCacheLastUpdate) > ANIDLE_CACHE_DURATION;

    if (cacheExpired || anidleAnimeCache.length === 0) {
        await refreshAnidleCache();
    }

    return anidleAnimeCache;
}

// Get today's daily anime (deterministic based on date)
async function getAnidleDailyAnime() {
    const animeList = await getAnidleValidAnime();
    if (animeList.length === 0) {
        return null;
    }

    const today = new Date();
    const dateString = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
    // Simple hash of date string
    let hash = 0;
    for (let i = 0; i < dateString.length; i++) {
        const char = dateString.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    const index = Math.abs(hash) % animeList.length;
    return animeList[index];
}

// GET /api/anidle/daily - Get today's anime for the daily challenge
app.get('/api/anidle/daily', async (req, res) => {
    try {
        const anime = await getAnidleDailyAnime();
        if (!anime) {
            return res.status(503).json({ error: "Anime data not available. Please try again later." });
        }
        // Don't send the title to the client!
        res.json({
            mal_id: anime.mal_id,
            score: anime.score,
            studio: anime.studio,
            genres: anime.genres,
            release_date: anime.release_date,
            source: anime.source,
            tags: anime.tags,
            image: anime.image,
            synopsis: anime.synopsis,
            main_character: anime.main_character
        });
    } catch (err) {
        console.error("Daily anime error:", err);
        res.status(500).json({ error: "Failed to get daily anime" });
    }
});

// GET /api/anidle/random - Get a random anime for unlimited mode
app.get('/api/anidle/random', async (req, res) => {
    try {
        const animeList = await getAnidleValidAnime();
        if (animeList.length === 0) {
            return res.status(503).json({ error: "Anime data not available. Please try again later." });
        }

        const index = Math.floor(Math.random() * animeList.length);
        const anime = animeList[index];
        res.json({
            mal_id: anime.mal_id,
            score: anime.score,
            studio: anime.studio,
            genres: anime.genres,
            release_date: anime.release_date,
            source: anime.source,
            tags: anime.tags,
            image: anime.image,
            synopsis: anime.synopsis,
            main_character: anime.main_character
        });
    } catch (err) {
        console.error("Random anime error:", err);
        res.status(500).json({ error: "Failed to get random anime" });
    }
});

// GET /api/anidle/anime-list - Get list of anime for autocomplete
app.get('/api/anidle/anime-list', async (req, res) => {
    try {
        const animeList = await getAnidleValidAnime();
        // Return only necessary fields for autocomplete
        const list = animeList.map(anime => ({
            mal_id: anime.mal_id,
            title: anime.title,
            title_english: anime.title_english,
            image: anime.image
        }));
        res.json(list);
    } catch (err) {
        console.error("Anime list error:", err);
        res.status(500).json({ error: "Failed to get anime list" });
    }
});

// GET /api/anidle/anime-full-list - Get full anime list with all details for AniCom
app.get('/api/anidle/anime-full-list', async (req, res) => {
    try {
        const animeList = await getAnidleValidAnime();
        // Return full anime data
        res.json(animeList);
    } catch (err) {
        console.error("Full anime list error:", err);
        res.status(500).json({ error: "Failed to get full anime list" });
    }
});

// GET /api/anidle/anime/:id - Get single anime by ID with full details
app.get('/api/anidle/anime/:id', async (req, res) => {
    try {
        const animeId = parseInt(req.params.id);
        const animeList = await getAnidleValidAnime();
        const anime = animeList.find(a => a.mal_id === animeId);
        
        if (!anime) {
            return res.status(404).json({ error: "Anime not found" });
        }
        
        res.json(anime);
    } catch (err) {
        console.error("Anime details error:", err);
        res.status(500).json({ error: "Failed to get anime details" });
    }
});

// POST /api/anidle/guess - Check a guess
app.post('/api/anidle/guess', async (req, res) => {
    const { guess, target_id, mode } = req.body;

    if (!guess || !target_id) {
        return res.status(400).json({ error: "Missing guess or target" });
    }

    try {
        const animeList = await getAnidleValidAnime();

        // Find guessed anime
        const guessedAnime = animeList.find(a =>
            a.title.toLowerCase() === guess.toLowerCase() ||
            (a.title_english && a.title_english.toLowerCase() === guess.toLowerCase())
        );

        if (!guessedAnime) {
            return res.status(400).json({ error: "Anime not found in database" });
        }

        // Find target anime
        const targetAnime = animeList.find(a => a.mal_id === target_id);

        if (!targetAnime) {
            return res.status(400).json({ error: "Target anime not found" });
        }

        // Check if correct
        const isCorrect = guessedAnime.mal_id === targetAnime.mal_id;

        // Compare properties
        const comparison = {
            score_match: guessedAnime.score === targetAnime.score,
            score_direction: guessedAnime.score < targetAnime.score ? '↑' : (guessedAnime.score > targetAnime.score ? '↓' : ''),
            studio_match: guessedAnime.studio === targetAnime.studio,
            source_match: guessedAnime.source === targetAnime.source,
            release_match: guessedAnime.release_date === targetAnime.release_date,
            release_direction: parseInt(guessedAnime.release_date) < parseInt(targetAnime.release_date) ? '↑' :
                (parseInt(guessedAnime.release_date) > parseInt(targetAnime.release_date) ? '↓' : '')
        };

        // Compare genres
        const guessGenres = guessedAnime.genres || [];
        const targetGenres = targetAnime.genres || [];
        const correctGenres = guessGenres.filter(g => targetGenres.includes(g));
        const wrongGenres = guessGenres.filter(g => !targetGenres.includes(g));

        comparison.genres_match = {
            correct: correctGenres.length,
            total: targetGenres.length
        };
        comparison.genres_details = {
            correct: correctGenres,
            wrong: wrongGenres
        };

        // Compare tags
        const guessTags = (guessedAnime.tags || []).map(t => t.name || t);
        const targetTags = targetAnime.tags || [];
        const targetTagNames = targetTags.map(t => t.name || t);
        const targetPrimaryTags = targetTags.filter(t => t.primary).map(t => t.name || t);
        const targetSecondaryTags = targetTags.filter(t => !t.primary).map(t => t.name || t);

        const primaryMatches = guessTags.filter(t => targetPrimaryTags.includes(t));
        const secondaryMatches = guessTags.filter(t => targetSecondaryTags.includes(t));
        const wrongTags = guessTags.filter(t => !targetTagNames.includes(t));

        comparison.tags_match = {
            primary: primaryMatches.length,
            secondary: secondaryMatches.length
        };
        comparison.tags_details = {
            primary: primaryMatches,
            secondary: secondaryMatches,
            wrong: wrongTags
        };

        res.json({
            correct: isCorrect,
            guessed_anime: {
                mal_id: guessedAnime.mal_id,
                title: guessedAnime.title,
                name: guessedAnime.title,
                score: guessedAnime.score,
                studio: guessedAnime.studio,
                genres: guessedAnime.genres,
                release_date: guessedAnime.release_date,
                source: guessedAnime.source,
                tags: guessedAnime.tags
            },
            comparison: comparison,
            target_anime: isCorrect ? {
                title: targetAnime.title,
                image: targetAnime.image
            } : null
        });
    } catch (err) {
        console.error("Guess error:", err);
        res.status(500).json({ error: "Failed to process guess" });
    }
});

// GET /api/anidle/check-daily - Check if user has completed today's daily
app.get('/api/anidle/check-daily', async (req, res) => {
    const { username } = req.query;

    if (!username) {
        return res.status(400).json({ error: "Username required" });
    }

    const today = new Date().toISOString().split('T')[0];

    if (useInMemory) {
        // Check memory scores for today
        const todayScores = memoryScores.filter(s =>
            s.game_id === 'anidle' &&
            s.board_id === 'daily' &&
            s.username === username &&
            s.created_at.toISOString().split('T')[0] === today
        );
        return res.json({ completed: todayScores.length > 0 });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        const result = await conn.query(`
            SELECT COUNT(*) as count FROM scores 
            WHERE game_id = 'anidle' 
            AND board_id = 'daily'
            AND username = ?
            AND DATE(created_at) = ?
        `, [username, today]);

        res.json({ completed: Number(result[0].count) > 0 });
    } catch (err) {
        console.error("Check daily error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// GET /api/anidle/daily-leaderboard - Get today's leaderboard
app.get('/api/anidle/daily-leaderboard', async (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const limit = parseInt(req.query.limit) || 10;

    if (useInMemory) {
        const todayScores = memoryScores
            .filter(s =>
                s.game_id === 'anidle' &&
                s.board_id === 'daily' &&
                s.created_at.toISOString().split('T')[0] === today
            )
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
        return res.json(todayScores);
    }

    let conn;
    try {
        conn = await pool.getConnection();
        const rows = await conn.query(`
            SELECT s.username, s.score, s.created_at, u.discord_id, u.avatar
            FROM scores s
            LEFT JOIN users u ON s.username = u.username
            WHERE s.game_id = 'anidle' 
            AND s.board_id = 'daily'
            AND DATE(s.created_at) = ?
            ORDER BY s.score DESC
            LIMIT ?
        `, [today, limit]);

        res.json(rows);
    } catch (err) {
        console.error("Daily leaderboard error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// POST /api/anidle/refresh-cache - Force refresh anime cache (admin only)
app.post('/api/anidle/refresh-cache', adminMiddleware, async (req, res) => {
    try {
        await refreshAnidleCache();
        res.json({
            success: true,
            count: anidleAnimeCache.length,
            message: `Cache refreshed with ${anidleAnimeCache.length} anime`
        });
    } catch (err) {
        console.error("Cache refresh error:", err);
        res.status(500).json({ error: "Failed to refresh cache" });
    }
});

// GET /api/anidle/cache-status - Get cache status
app.get('/api/anidle/cache-status', (req, res) => {
    res.json({
        count: anidleAnimeCache.length,
        lastUpdate: anidleCacheLastUpdate ? new Date(anidleCacheLastUpdate).toISOString() : null,
        cacheAge: anidleCacheLastUpdate ? Math.floor((Date.now() - anidleCacheLastUpdate) / 1000 / 60) + ' minutes' : 'never'
    });
});

// Start Server
app.listen(PORT, async () => {
    console.log(`Server running at http://localhost:${PORT}`);

    // Initialize anime cache on startup
    console.log('[Anidle] Initializing anime cache...');
    try {
        await refreshAnidleCache();
    } catch (err) {
        console.error('[Anidle] Failed to initialize cache on startup:', err.message);
    }
});
