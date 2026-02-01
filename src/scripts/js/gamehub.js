const apiBase = ''; // Relative path for same-origin

document.addEventListener('DOMContentLoaded', () => {
    // Check for file protocol
    if (window.location.protocol === 'file:') {
        alert("⚠️ CRITICAL: You are opening this file directly!\n\nPlease access the site via the server:\nhttp://localhost:8000/src/html/GameHub.html");
        document.body.innerHTML = '<h1 style="color:red; padding: 20px;">Please open http://localhost:8000</h1>';
        return;
    }

    loadGames();

    // Auth Check
    const params = new URLSearchParams(window.location.search);
    if (params.get('login') === 'success') {
        const user = {
            username: params.get('username'),
            discord_id: params.get('discord_id'),
            avatar: params.get('avatar')
        };
        localStorage.setItem('discord_user', JSON.stringify(user));
        // Clean URL
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    loadGames();
    initGlobalSettings();

    document.getElementById('game-search').addEventListener('input', (e) => {
        filterGames(e.target.value);
    });
});

// --- Global Settings & Profile ---

function toggleSettings() {
    const modal = document.getElementById('settings-modal');
    modal.style.display = (modal.style.display === 'none') ? 'block' : 'none';
}

function toggleProfile() {
    const modal = document.getElementById('profile-modal');
    modal.style.display = (modal.style.display === 'none') ? 'block' : 'none';
    if (modal.style.display === 'block') {
        loadProfileStats();
    }
}

function updateGlobalVolume(value) {
    localStorage.setItem('global_volume', value);
    // Optional: Update current page audio if any
}

function initGlobalSettings() {
    // Volume
    const vol = localStorage.getItem('global_volume') || 100;
    const slider = document.getElementById('volume-slider');
    if (slider) slider.value = vol;

    // Auth
    checkAuthState();
}

function checkAuthState() {
    const authSection = document.getElementById('auth-section');
    const storedUser = localStorage.getItem('discord_user');

    if (storedUser) {
        const user = JSON.parse(storedUser);
        if (authSection) {
            authSection.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px; color: #fff; margin-bottom: 10px;">
                    <img src="https://cdn.discordapp.com/avatars/${user.discord_id}/${user.avatar}.png" style="width: 32px; height: 32px; border-radius: 50%;">
                    <span>${escapeHtml(user.username)}</span>
                </div>
                <button onclick="logout()" style="width: 100%; background: #333; color: #888; border: none; padding: 5px; cursor: pointer;">Logout</button>
            `;
        }
    }
}

function loginDiscord() {
    window.location.href = '/api/auth/discord';
}

function logout() {
    localStorage.removeItem('discord_user');
    location.reload();
}

async function loadProfileStats() {
    const container = document.getElementById('profile-content');
    const storedUser = localStorage.getItem('discord_user');

    if (!storedUser) {
        container.innerHTML = '<p>Please login to see stats.</p>';
        return;
    }

    const user = JSON.parse(storedUser);
    container.innerHTML = 'Loading stats...';

    try {
        // Parallel Fetch: Stats and Achievements
        const [statsRes, achRes] = await Promise.all([
            fetch(`/api/user/${user.username}/stats`),
            fetch(`/api/user/${user.username}/achievements`)
        ]);

        const stats = await statsRes.json();
        const achievements = await achRes.json(); // Returns array of { achievement_id, unlocked_at, game_id } (implied from schema)

        // For display, we might want Game Names.
        // But the API for achievements might only give IDs.
        // We can look up game names from `allGames` if available, or just list IDs.
        // Update: /api/user/:user/achievements returns rows from user_achievements table.
        // Assuming it has game_id.

        let achievementsHtml = '';
        if (achievements.length > 0) {
            achievementsHtml = `
                <div style="width: 100%; margin-top: 20px;">
                    <h3 style="border-bottom: 1px solid #333; padding-bottom: 5px; margin-bottom: 10px; color: #1DCD9F;">Achievements (${achievements.length})</h3>
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(60px, 1fr)); gap: 10px;">
                        ${achievements.map(a => {
                // Find game info if possible
                const game = allGames.find(g => g.id === a.game_id);
                // Find achievement detail if available (complex without extra API calls, simplified here)
                // We'll rely on a tooltip or simple display.
                // Since we don't have full achievement data (images/titles) here without fetching every game's data,
                // we'll show a generic icon or the ID as title.
                // IMPROVEMENT: Fetch full game data cache?
                // For now, simple box.
                return `
                                <div style="background: #222; padding: 5px; border-radius: 5px; text-align: center; font-size: 0.7rem; color: #aaa;" title="${a.game_id}: ${a.achievement_id}">
                                    <div style="font-size: 1.2rem;">🏆</div>
                                    <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${a.achievement_id}</div>
                                </div>
                            `;
            }).join('')}
                    </div>
                </div>
            `;
        } else {
            achievementsHtml = '<div style="margin-top: 20px; color: #555;">No achievements yet.</div>';
        }

        container.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; gap: 10px; margin-bottom: 20px;">
                <img src="https://cdn.discordapp.com/avatars/${user.discord_id}/${user.avatar}.png" style="width: 80px; height: 80px; border-radius: 50%; border: 2px solid #1DCD9F;">
                <h2 style="margin: 0;">${escapeHtml(user.username)}</h2>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; width: 100%;">
                <div style="background: #111; padding: 10px; border-radius: 5px;">
                    <div style="color: #888; font-size: 0.8rem;">Games Played</div>
                    <div style="font-size: 1.2rem; color: #1DCD9F;">${stats.games_played}</div>
                </div>
                <div style="background: #111; padding: 10px; border-radius: 5px;">
                    <div style="color: #888; font-size: 0.8rem;">Total Score</div>
                    <div style="font-size: 1.2rem; color: #1DCD9F;">${stats.total_score}</div>
                </div>
                <div style="background: #111; padding: 10px; border-radius: 5px;">
                    <div style="color: #888; font-size: 0.8rem;">Avg Score</div>
                    <div style="font-size: 1.2rem; color: #1DCD9F;">${stats.average_score}</div>
                </div>
                <div style="background: #111; padding: 10px; border-radius: 5px;">
                    <div style="color: #888; font-size: 0.8rem;">Best Score</div>
                    <div style="font-size: 1.2rem; color: #1DCD9F;">${stats.best_score}</div>
                </div>
            </div>

            ${achievementsHtml}
        `;
    } catch (err) {
        console.error("Stats Error", err);
        container.innerHTML = '<p style="color: red;">Failed to load stats.</p>';
    }
}

function escapeHtml(text) {
    if (!text) return "";
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

let allGames = [];

async function loadGames() {
    const listContainer = document.getElementById('game-lists');

    try {
        const res = await fetch('/api/games');
        allGames = await res.json();

        listContainer.innerHTML = ''; // Clear loading

        if (allGames.length === 0) {
            listContainer.innerHTML = '<div style="text-align:center; margin-top:50px;">No games found. Add some to src/games/!</div>';
            return;
        }

        renderGames(allGames);
    } catch (err) {
        console.error("Failed to load games", err);
        listContainer.innerHTML = '<div style="color:red; text-align:center;">Error loading games. Setup required.</div>';
    }
}

function renderGames(games) {
    const listContainer = document.getElementById('game-lists');
    listContainer.innerHTML = '';

    // Group by Genre
    const genres = {};
    games.forEach(game => {
        const g = game.genre || 'Uncategorized';
        if (!genres[g]) genres[g] = [];
        genres[g].push(game);
    });

    // Render Rows
    for (const [genre, genreGames] of Object.entries(genres)) {
        const section = document.createElement('div');
        section.className = 'category-section';

        const title = document.createElement('h2');
        title.className = 'category-title';
        title.innerText = genre;
        section.appendChild(title);

        const row = document.createElement('div');
        row.className = 'game-row';

        genreGames.forEach(game => {
            const card = document.createElement('a');
            card.className = 'game-card';
            card.href = `Game.html?id=${game.id}`;

            // Check if image exists (handled by server path usually)
            const imgHtml = game.image ?
                `<img src="${game.image}" class="game-image" alt="${game.name}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : '';

            const fallbackHtml = `<div class="game-image" style="${game.image ? 'display:none' : ''}">${game.name}</div>`;

            // Mobile Badge logic
            const isMobile = game.settings && (game.settings.phone === true || game.settings.phone === "true");
            const mobileIcon = isMobile ? '<img src="../assets/imgs/const.png" class="pixel-icon" title="Mobile Friendly" alt="Mobile">' : '';

            card.innerHTML = `
                ${imgHtml}
                ${fallbackHtml}
                <div class="game-info">
                    <div class="game-title">${mobileIcon} ${game.name}</div>
                    <div class="game-genre">${game.genre}</div>
                </div>
            `;
            row.appendChild(card);
        });

        section.appendChild(row);
        listContainer.appendChild(section);
    }
}

function filterGames(query) {
    const lowerQ = query.toLowerCase();
    const filtered = allGames.filter(g =>
        g.name.toLowerCase().includes(lowerQ) ||
        g.genre.toLowerCase().includes(lowerQ)
    );
    renderGames(filtered);
}
