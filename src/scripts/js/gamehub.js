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
                    <img src="https://cdn.discordapp.com/avatars/${user.discord_id}/${user.avatar}.png" 
                         style="width: 32px; height: 32px; border-radius: 50%;"
                         onerror="this.src='../assets/imgs/const.png'">
                    <span>${escapeHtml(user.username)}</span>
                </div>
                <button onclick="logout()" style="width: 100%; background: #333; color: #888; border: none; padding: 5px; cursor: pointer;">Logout</button>
            `;
        }
    } else {
        // Not logged in. Check for Localhost/Dev environment
        const loginBtn = document.getElementById('login-btn');
        const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

        // Check if server has auth enabled
        fetch('/api/auth/status')
            .then(res => res.json())
            .then(data => {
                if (!data.enabled && loginBtn) {
                    loginBtn.style.display = 'none';
                    if (authSection && !document.getElementById('auth-disabled-msg')) {
                        const msg = document.createElement('div');
                        msg.id = 'auth-disabled-msg';
                        msg.innerText = "Discord Auth Disabled";
                        msg.style.color = "#777";
                        msg.style.fontSize = "0.8rem";
                        msg.style.marginBottom = "10px";
                        msg.style.textAlign = "center";
                        authSection.insertBefore(msg, loginBtn);
                    }
                }
            })
            .catch(err => console.log("Auth status check failed", err));

        if (isDev && authSection) {
            // Avoid duplicates
            if (!document.getElementById('dev-login-btn')) {
                const devBtn = document.createElement('button');
                devBtn.id = 'dev-login-btn';
                devBtn.innerText = "Dev Login";
                devBtn.style.marginTop = "10px";
                devBtn.style.width = "100%";
                devBtn.style.background = "#444";
                devBtn.style.color = "#1DCD9F";
                devBtn.style.border = "1px dashed #1DCD9F";
                devBtn.style.padding = "5px";
                devBtn.style.cursor = "pointer";
                devBtn.onclick = () => {
                    localStorage.setItem('discord_user', JSON.stringify({
                        username: 'DevUser',
                        discord_id: '000000000000000000', // Fake ID
                        avatar: '0' // triggers fallback
                    }));
                    location.reload();
                };
                authSection.appendChild(devBtn);
            }
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
        // Parallel Fetch: Stats and Profile (with full achievement data including images)
        const [statsRes, profileRes, decorationsRes] = await Promise.all([
            fetch(`/api/user/${user.username}/stats`),
            fetch(`/api/user/${user.username}/profile`),
            fetch(`/api/decorations`)
        ]);

        const stats = await statsRes.json();
        const profile = await profileRes.json();
        const decorations = await decorationsRes.json();
        const achievements = profile.achievements || [];

        // Build decoration overlay HTML
        let decorationOverlay = '';
        if (stats.decoration) {
            const deco = decorations.find(d => d.id === stats.decoration);
            if (deco && deco.image) {
                decorationOverlay = `<img src="${deco.image}" class="profile-decoration" style="position: absolute; top: -10px; left: -10px; width: 100px; height: 100px; pointer-events: none;" onerror="this.style.display='none'">`;
            }
        }

        // Build achievements HTML with images
        let achievementsHtml = '';
        if (achievements.length > 0) {
            achievementsHtml = `
                <div style="width: 100%; margin-top: 20px;">
                    <h3 style="border-bottom: 1px solid #333; padding-bottom: 5px; margin-bottom: 10px; color: #1DCD9F;">Achievements (${achievements.length})</h3>
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(70px, 1fr)); gap: 10px;">
                        ${achievements.map(a => {
                            const imgSrc = a.image ? `/src/games/${a.game_id}/${a.image}` : '../assets/imgs/const.png';
                            return `
                                <div style="background: #222; padding: 8px; border-radius: 5px; text-align: center; font-size: 0.65rem; color: #aaa; border: 1px solid #1DCD9F;" title="${a.game_name}: ${a.title}\n${a.description}\n+${a.points} points">
                                    <img src="${imgSrc}" style="width: 40px; height: 40px; border-radius: 5px; object-fit: cover;" onerror="this.src='../assets/imgs/const.png'">
                                    <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 4px;">${escapeHtml(a.title)}</div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        } else {
            achievementsHtml = '<div style="margin-top: 20px; color: #555;">No achievements yet.</div>';
        }

        // Build decoration selector
        const ownedDecos = profile.inventory || [];
        let decorationSelectorHtml = `
            <div style="width: 100%; margin-top: 20px;">
                <h3 style="border-bottom: 1px solid #333; padding-bottom: 5px; margin-bottom: 10px; color: #1DCD9F;">Profile Decoration</h3>
                <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                    ${decorations.map(d => {
                        const isOwned = d.id === 'none' || ownedDecos.includes(d.id);
                        const isEquipped = stats.decoration === d.id || (d.id === 'none' && !stats.decoration);
                        const borderColor = isEquipped ? '#1DCD9F' : (isOwned ? '#444' : '#333');
                        return `
                            <button onclick="selectDecoration('${d.id}')" style="background: #222; border: 2px solid ${borderColor}; padding: 5px 10px; border-radius: 5px; cursor: pointer; color: #ccc; font-size: 0.75rem; opacity: ${isOwned ? '1' : '0.6'};">
                                ${d.name}
                                ${!isOwned ? `<span style="color: #FFD700;">(${d.cost}pts)</span>` : ''}
                                ${isEquipped ? ' ✓' : ''}
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        `;

        // Bio section
        const bioHtml = `
            <div style="width: 100%; margin-top: 15px;">
                <div style="color: #888; font-size: 0.8rem; margin-bottom: 5px;">Bio</div>
                <div style="background: #111; padding: 10px; border-radius: 5px; color: #ccc; font-size: 0.9rem; min-height: 40px;">
                    ${profile.bio ? escapeHtml(profile.bio) : '<span style="color: #555;">No bio set</span>'}
                    <button onclick="editBio()" style="float: right; background: #333; border: none; color: #888; padding: 2px 8px; cursor: pointer; border-radius: 3px;">Edit</button>
                </div>
            </div>
        `;

        container.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; gap: 10px; margin-bottom: 20px;">
                <div style="position: relative; display: inline-block;">
                    ${decorationOverlay}
                    <img src="https://cdn.discordapp.com/avatars/${user.discord_id}/${user.avatar}.png" 
                         style="width: 80px; height: 80px; border-radius: 50%; border: 2px solid #1DCD9F;"
                         onerror="this.src='../assets/imgs/const.png'">
                </div>
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
                    <div style="color: #888; font-size: 0.8rem;">Points</div>
                    <div style="font-size: 1.2rem; color: #FFD700;">${stats.points || 0}</div>
                </div>
                <div style="background: #111; padding: 10px; border-radius: 5px;">
                    <div style="color: #888; font-size: 0.8rem;">Best Score</div>
                    <div style="font-size: 1.2rem; color: #1DCD9F;">${stats.best_score}</div>
                </div>
                <div style="background: #111; padding: 10px; border-radius: 5px;">
                    <div style="color: #888; font-size: 0.8rem;">Avg Score</div>
                    <div style="font-size: 1.2rem; color: #1DCD9F;">${stats.average_score}</div>
                </div>
                <div style="background: #111; padding: 10px; border-radius: 5px;">
                    <div style="color: #888; font-size: 0.8rem;">Achievements</div>
                    <div style="font-size: 1.2rem; color: #1DCD9F;">${stats.total_achievements || 0}</div>
                </div>
            </div>

            ${bioHtml}
            ${decorationSelectorHtml}
            ${achievementsHtml}
        `;
    } catch (err) {
        console.error("Stats Error", err);
        container.innerHTML = '<p style="color: red;">Failed to load stats.</p>';
    }
}

// Select and purchase decoration
async function selectDecoration(decoId) {
    const storedUser = localStorage.getItem('discord_user');
    if (!storedUser) return;
    
    const user = JSON.parse(storedUser);
    
    try {
        const res = await fetch(`/api/user/${user.username}/decoration`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decoration_id: decoId })
        });
        
        const data = await res.json();
        if (data.success) {
            loadProfileStats(); // Refresh
        } else {
            alert(data.error || 'Failed to set decoration');
        }
    } catch (err) {
        console.error("Decoration Error:", err);
    }
}

// Edit bio
async function editBio() {
    const storedUser = localStorage.getItem('discord_user');
    if (!storedUser) return;
    
    const user = JSON.parse(storedUser);
    const newBio = prompt("Enter your bio (max 500 chars):", "");
    
    if (newBio === null) return; // Cancelled
    
    try {
        const res = await fetch(`/api/user/${user.username}/profile`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bio: newBio })
        });
        
        const data = await res.json();
        if (data.success) {
            loadProfileStats(); // Refresh
        } else {
            alert(data.error || 'Failed to update bio');
        }
    } catch (err) {
        console.error("Bio Error:", err);
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
