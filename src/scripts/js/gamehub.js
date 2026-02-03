const apiBase = ''; // Relative path for same-origin

document.addEventListener('DOMContentLoaded', async () => {
    // Check for file protocol
    if (window.location.protocol === 'file:') {
        alert("[WARNING] CRITICAL: You are opening this file directly!\n\nPlease access the site via the server:\nhttp://localhost:8000/src/html/GameHub.html");
        document.body.innerHTML = '<h1 style="color:red; padding: 20px;">Please open http://localhost:8000</h1>';
        return;
    }

    loadGames();

    // Auth Check - Handle session token from OAuth callback
    const params = new URLSearchParams(window.location.search);
    const sessionToken = params.get('session_token');
    
    if (sessionToken) {
        // Store the session token
        localStorage.setItem('session_token', sessionToken);
        
        // Fetch user data using the session token
        try {
            const res = await fetch('/api/auth/me', {
                headers: { 'Authorization': `Bearer ${sessionToken}` }
            });
            if (res.ok) {
                const user = await res.json();
                localStorage.setItem('discord_user', JSON.stringify(user));
            } else {
                // Invalid token
                localStorage.removeItem('session_token');
            }
        } catch (err) {
            console.error("Failed to fetch user data:", err);
        }
        
        // Clean URL
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    loadGames();
    initUserHeader();

    document.getElementById('game-search').addEventListener('input', (e) => {
        filterGames(e.target.value);
    });
});

// --- Auth Helper Functions ---

function getSessionToken() {
    return localStorage.getItem('session_token');
}

function getAuthHeaders() {
    const token = getSessionToken();
    if (token) {
        return { 'Authorization': `Bearer ${token}` };
    }
    return {};
}

function isLoggedIn() {
    return !!getSessionToken() && !!localStorage.getItem('discord_user');
}

async function logout() {
    const token = getSessionToken();
    if (token) {
        try {
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}` 
                }
            });
        } catch (err) {
            console.error("Logout error:", err);
        }
    }
    localStorage.removeItem('session_token');
    localStorage.removeItem('discord_user');
    location.reload();
}

// --- User Header ---

function initUserHeader() {
    const container = document.getElementById('user-header');
    const storedUser = localStorage.getItem('discord_user');

    if (storedUser && getSessionToken()) {
        const user = JSON.parse(storedUser);
        const avatarUrl = user.discord_id && user.avatar && user.avatar !== '0'
            ? `https://cdn.discordapp.com/avatars/${user.discord_id}/${user.avatar}.png`
            : '../assets/imgs/const.png';

        container.innerHTML = `
            <a href="Profile.html" style="display: flex; align-items: center; gap: 10px; text-decoration: none; color: #fff; padding: 8px 15px; background: #222; border-radius: 25px; border: 1px solid #333; transition: border-color 0.2s;">
                <img src="${avatarUrl}" 
                     style="width: 32px; height: 32px; border-radius: 50%; border: 2px solid #1DCD9F;"
                     onerror="this.src='../assets/imgs/const.png'">
                <span style="color: #1DCD9F; font-weight: bold;">${escapeHtml(user.username)}</span>
            </a>
            <button onclick="logout()" style="margin-left: 10px; padding: 8px 12px; background: #333; color: #ff6b6b; border: 1px solid #ff6b6b; border-radius: 15px; cursor: pointer; font-size: 0.8rem;">Logout</button>
        `;
    } else {
        // Clear any stale data
        if (!getSessionToken()) {
            localStorage.removeItem('discord_user');
        }
        
        // Show login button
        container.innerHTML = `
            <button onclick="loginDiscord()" class="pixel-btn" style="display: flex; align-items: center; gap: 8px; padding: 8px 15px; background: #222; border: 1px solid #1DCD9F; border-radius: 25px; color: #1DCD9F; cursor: pointer;">
                <span>Login</span>
            </button>
        `;

        // Check if auth is enabled
        fetch('/api/auth/status')
            .then(res => res.json())
            .then(data => {
                if (!data.enabled) {
                    container.innerHTML = `
                        <span style="color: #555; font-size: 0.9rem;">Auth Disabled</span>
                    `;
                }
            })
            .catch(err => console.log("Auth status check failed"));

        // Dev mode login
        const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        if (isDev) {
            const devBtn = document.createElement('button');
            devBtn.innerText = "Dev Login";
            devBtn.style.cssText = "margin-left: 10px; padding: 8px 15px; background: #333; color: #1DCD9F; border: 1px dashed #1DCD9F; border-radius: 25px; cursor: pointer;";
            devBtn.onclick = async () => {
                try {
                    const res = await fetch('/api/auth/dev-login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username: 'DevUser' })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        localStorage.setItem('session_token', data.session_token);
                        localStorage.setItem('discord_user', JSON.stringify(data.user));
                        location.reload();
                    } else {
                        console.error("Dev login failed");
                    }
                } catch (err) {
                    console.error("Dev login error:", err);
                }
            };
            container.appendChild(devBtn);
        }
    }
}

function loginDiscord() {
    window.location.href = '/api/auth/discord';
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
