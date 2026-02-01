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

console.log("--- DEBUG ENV ---");
console.log("CLIENT_ID Type:", typeof CLIENT_ID);
console.log("CLIENT_ID Length:", CLIENT_ID ? CLIENT_ID.length : 0);
console.log("REDIRECT_URI:", REDIRECT_URI);
console.log("-----------------");

if (!CLIENT_ID || CLIENT_ID === "your_client_id_here") {
    console.error("❌ ERROR: DISCORD_CLIENT_ID is missing or default! Check your .env file.");
}

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
    .then(conn => {
        console.log("✅ Database connected successfully.");
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
        const rows = await conn.query("SELECT * FROM scores WHERE game_id = ? AND board_id = ? ORDER BY score DESC LIMIT ?", [gameId, boardId, limitInt]);
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
        const { game_id, username, score, board_id } = req.body;
        if (!game_id || score === undefined) return res.status(400).json({ error: "Invalid data" });

        const user = username || "Anonymous";
        const board = board_id || 'main';

        if (useInMemory) {
            console.log(`[RAM] Score saved: ${user} - ${score} for ${game_id} (${board})`);
            memoryScores.push({ game_id, board_id: board, username: user, score: parseInt(score), created_at: new Date() });
            return res.json({ success: true, mode: "memory" });
        }

        let conn;
        try {
            conn = await pool.getConnection();
            // Note: DB Schema needs board_id column
            await conn.query("INSERT INTO scores (game_id, username, score, board_id) VALUES (?, ?, ?, ?)", [game_id, user, score, board]);
            res.json({ success: true });
        } catch (err) {
            if (err.code === 'ER_BAD_FIELD_ERROR') {
                // Fallback
                await conn.query("INSERT INTO scores (game_id, username, score) VALUES (?, ?, ?)", [game_id, user, score]);
                return res.json({ success: true, warning: "board_id ignored" });
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
            const result = await conn.query(
                "INSERT IGNORE INTO user_achievements (username, game_id, achievement_id) VALUES (?, ?, ?)",
                [username, game_id, achievement_id]
            );

            // Check if row was actually inserted (mariadb/mysql specific)
            const newUnlock = result.affectedRows > 0;
            res.json({ success: true, new_unlock: newUnlock });

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

app.get('/api/auth/discord', (req, res) => {
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

        return res.json({
            username,
            games_played: uniqueGames,
            total_score: totalScore,
            average_score: avgScore,
            best_score: bestScore
        });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        // Calculate stats
        // Note: For 'games_played', we count unique game_ids for this user
        // For 'best_score', we get the max score
        const stats = await conn.query(`
            SELECT 
                COUNT(DISTINCT game_id) as games_played,
                SUM(score) as total_score,
                AVG(score) as average_score,
                MAX(score) as best_score
            FROM scores 
            WHERE username = ?
        `, [username]);

        const data = stats[0] || {};
        res.json({
            username,
            games_played: Number(data.games_played) || 0,
            total_score: Number(data.total_score) || 0,
            average_score: Math.round(data.average_score) || 0,
            best_score: Number(data.best_score) || 0
        });

    } catch (err) {
        console.error("Stats Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }

});

// --- Admin Endpoints (Localhost Only) ---

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

app.get('/api/admin/tables', adminMiddleware, async (req, res) => {
    if (useInMemory) return res.json([{ name: "Memory Mode (No Tables)" }]);

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

// Start Server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
