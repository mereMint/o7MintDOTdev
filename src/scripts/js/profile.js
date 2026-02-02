// Profile Page JavaScript

let currentUser = null;
let profileData = null;
let allGames = [];

document.addEventListener('DOMContentLoaded', () => {
    // Check for file protocol
    if (window.location.protocol === 'file:') {
        alert("⚠️ Please access the site via the server:\nhttp://localhost:8000/src/html/Profile.html");
        return;
    }

    checkAuth();
    loadGames();
});

function checkAuth() {
    const storedUser = localStorage.getItem('discord_user');
    
    if (storedUser) {
        currentUser = JSON.parse(storedUser);
        document.getElementById('login-prompt').style.display = 'none';
        document.getElementById('profile-view').style.display = 'block';
        loadProfile();
    } else {
        document.getElementById('login-prompt').style.display = 'block';
        document.getElementById('profile-view').style.display = 'none';
        showDevLogin();
    }
}

function showDevLogin() {
    const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isDev) {
        const container = document.getElementById('dev-login-container');
        container.innerHTML = `
            <button onclick="devLogin()" class="btn-secondary" style="margin-top: 15px;">
                🔧 Dev Login
            </button>
        `;
    }
    
    // Check if auth is enabled
    fetch('/api/auth/status')
        .then(res => res.json())
        .then(data => {
            if (!data.enabled) {
                const btn = document.getElementById('discord-login-btn');
                if (btn) {
                    btn.style.display = 'none';
                }
            }
        })
        .catch(err => console.log("Auth status check failed"));
}

function devLogin() {
    localStorage.setItem('discord_user', JSON.stringify({
        username: 'DevUser',
        discord_id: '000000000000000000',
        avatar: '0'
    }));
    location.reload();
}

function loginDiscord() {
    window.location.href = '/api/auth/discord';
}

function logout() {
    localStorage.removeItem('discord_user');
    location.reload();
}

async function loadProfile() {
    if (!currentUser) return;

    try {
        const res = await fetch(`/api/user/${currentUser.username}/full-profile?viewer=${currentUser.username}`);
        profileData = await res.json();

        renderProfile();
        loadDecorations();
        
        // Show moderator panel if user is mod/admin/owner
        if (['moderator', 'admin', 'owner'].includes(profileData.role)) {
            loadModeratorPanel();
        }
    } catch (err) {
        console.error("Error loading profile:", err);
    }
}

function renderProfile() {
    // Avatar
    const avatarUrl = currentUser.discord_id && currentUser.avatar && currentUser.avatar !== '0'
        ? `https://cdn.discordapp.com/avatars/${currentUser.discord_id}/${currentUser.avatar}.png`
        : '../assets/imgs/const.png';
    document.getElementById('profile-avatar').src = avatarUrl;
    document.getElementById('profile-avatar').onerror = function() {
        this.src = '../assets/imgs/const.png';
    };

    // Decoration
    if (profileData.decoration) {
        loadDecorationOverlay(profileData.decoration);
    }

    // Username and Role
    document.getElementById('profile-username').textContent = profileData.username;
    const roleEl = document.getElementById('profile-role');
    roleEl.textContent = profileData.role || 'user';
    roleEl.className = `role-badge ${profileData.role || 'user'}`;

    // Bio
    document.getElementById('profile-bio').textContent = profileData.bio || 'No bio set';

    // Last Online
    if (profileData.last_online) {
        const lastOnline = new Date(profileData.last_online);
        document.getElementById('last-online').textContent = `Last online: ${lastOnline.toLocaleDateString()} ${lastOnline.toLocaleTimeString()}`;
    }

    // Stats
    document.getElementById('stat-games').textContent = profileData.games_played || 0;
    document.getElementById('stat-score').textContent = formatNumber(profileData.total_score || 0);
    document.getElementById('stat-achievements').textContent = profileData.total_achievements || 0;
    document.getElementById('stat-points').textContent = formatNumber(profileData.points || 0);
    document.getElementById('stat-posts').textContent = profileData.posts_count || 0;
    document.getElementById('stat-articles').textContent = profileData.articles_count || 0;

    // Favorite Game
    const favGameSection = document.getElementById('favorite-game-content');
    if (profileData.favorite_game) {
        favGameSection.innerHTML = `
            <a href="Game.html?id=${profileData.favorite_game.id}" class="favorite-game-card">
                <img src="${profileData.favorite_game.image}" alt="${escapeHtml(profileData.favorite_game.name)}" 
                     onerror="this.src='../assets/imgs/const.png'">
                <span class="game-name">${escapeHtml(profileData.favorite_game.name)}</span>
            </a>
        `;
    } else {
        favGameSection.innerHTML = '<p class="muted">No favorite game set. Go to Settings to choose one!</p>';
    }

    // Achievements
    const achList = document.getElementById('achievements-list');
    if (profileData.achievements && profileData.achievements.length > 0) {
        achList.innerHTML = profileData.achievements.map(ach => {
            const imgSrc = ach.image 
                ? `/src/games/${ach.game_id}/${ach.image}`
                : '../assets/imgs/const.png';
            return `
                <div class="achievement-item unlocked" title="${escapeHtml(ach.game_name)}: ${escapeHtml(ach.description)}">
                    <img src="${imgSrc}" alt="${escapeHtml(ach.title)}" onerror="this.src='../assets/imgs/const.png'">
                    <div class="ach-title">${escapeHtml(ach.title)}</div>
                </div>
            `;
        }).join('');
    } else {
        achList.innerHTML = '<p class="muted">No achievements yet. Play some games to earn them!</p>';
    }

    // Settings - Pre-fill
    document.getElementById('setting-bio').value = profileData.bio || '';
    updateBioCount();

    // Privacy settings
    if (profileData.privacy) {
        document.getElementById('privacy-stats').checked = profileData.privacy.show_stats !== false;
        document.getElementById('privacy-achievements').checked = profileData.privacy.show_achievements !== false;
        document.getElementById('privacy-activity').checked = profileData.privacy.show_activity !== false;
    }

    // Volume
    const vol = localStorage.getItem('global_volume') || 100;
    document.getElementById('setting-volume').value = vol;

    // Discord connection
    document.getElementById('discord-connection').innerHTML = `
        <img src="${avatarUrl}" alt="Avatar" onerror="this.src='../assets/imgs/const.png'">
        <span class="username">${escapeHtml(currentUser.username)}</span>
    `;
}

async function loadDecorations() {
    try {
        const res = await fetch('/api/decorations');
        const decorations = await res.json();

        const container = document.getElementById('decorations-list');
        const inventory = profileData.inventory || [];

        container.innerHTML = decorations.map(deco => {
            const isOwned = deco.id === 'none' || inventory.includes(deco.id);
            const isEquipped = profileData.decoration === deco.id || (deco.id === 'none' && !profileData.decoration);

            return `
                <button onclick="selectDecoration('${deco.id}')" 
                        class="decoration-btn ${isEquipped ? 'equipped' : ''} ${!isOwned ? 'locked' : ''}">
                    ${escapeHtml(deco.name)}
                    ${!isOwned ? `<span class="cost">(${deco.cost}pts)</span>` : ''}
                    ${isEquipped ? ' ✓' : ''}
                </button>
            `;
        }).join('');
    } catch (err) {
        console.error("Error loading decorations:", err);
    }
}

async function loadDecorationOverlay(decoId) {
    try {
        const res = await fetch('/api/decorations');
        const decorations = await res.json();
        const deco = decorations.find(d => d.id === decoId);
        
        if (deco && deco.image) {
            document.getElementById('decoration-overlay').innerHTML = 
                `<img src="${deco.image}" alt="${escapeHtml(deco.name)}" onerror="this.style.display='none'">`;
        }
    } catch (err) {
        console.error("Error loading decoration overlay:", err);
    }
}

async function selectDecoration(decoId) {
    if (!currentUser) return;

    try {
        const res = await fetch(`/api/user/${currentUser.username}/decoration`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decoration_id: decoId })
        });

        const data = await res.json();
        if (data.success) {
            loadProfile(); // Refresh
        } else {
            alert(data.error || 'Failed to set decoration');
        }
    } catch (err) {
        console.error("Decoration Error:", err);
    }
}

async function loadGames() {
    try {
        const res = await fetch('/api/games');
        allGames = await res.json();
        
        // Populate favorite game select
        const select = document.getElementById('setting-favorite-game');
        select.innerHTML = '<option value="">Select a game...</option>' +
            allGames.map(g => `<option value="${g.id}" ${profileData?.favorite_game?.id === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('');
    } catch (err) {
        console.error("Error loading games:", err);
    }
}

// Settings Modal
function showSettings() {
    document.getElementById('settings-modal').style.display = 'flex';
    
    // Update favorite game select with current selection
    if (profileData?.favorite_game) {
        document.getElementById('setting-favorite-game').value = profileData.favorite_game.id;
    }
}

function hideSettings() {
    document.getElementById('settings-modal').style.display = 'none';
}

async function saveSettings() {
    if (!currentUser) return;

    const bio = document.getElementById('setting-bio').value;
    const favoriteGame = document.getElementById('setting-favorite-game').value;
    const privacy = {
        show_stats: document.getElementById('privacy-stats').checked,
        show_achievements: document.getElementById('privacy-achievements').checked,
        show_activity: document.getElementById('privacy-activity').checked
    };
    const volume = document.getElementById('setting-volume').value;

    // Save volume locally
    localStorage.setItem('global_volume', volume);

    try {
        const res = await fetch(`/api/user/${currentUser.username}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                bio: bio,
                favorite_game: favoriteGame || null,
                privacy_settings: privacy
            })
        });

        const data = await res.json();
        if (data.success) {
            hideSettings();
            loadProfile(); // Refresh
        } else {
            alert(data.error || 'Failed to save settings');
        }
    } catch (err) {
        console.error("Save Settings Error:", err);
        alert("Failed to save settings");
    }
}

function updateBioCount() {
    const bio = document.getElementById('setting-bio');
    const count = document.getElementById('bio-char-count');
    count.textContent = `${bio.value.length}/500`;
}

document.getElementById('setting-bio')?.addEventListener('input', updateBioCount);

// Friends Modal
function showFriends() {
    document.getElementById('friends-modal').style.display = 'flex';
    loadFriends();
    loadFriendRequests();
}

function hideFriends() {
    document.getElementById('friends-modal').style.display = 'none';
}

async function loadFriends() {
    if (!currentUser) return;

    try {
        const res = await fetch(`/api/user/${currentUser.username}/friends`);
        const friends = await res.json();

        const container = document.getElementById('friends-list');
        if (friends.length === 0) {
            container.innerHTML = '<p class="muted">No friends yet. Search for users to add friends!</p>';
            return;
        }

        container.innerHTML = friends.map(friend => {
            const avatarUrl = friend.discord_id && friend.avatar
                ? `https://cdn.discordapp.com/avatars/${friend.discord_id}/${friend.avatar}.png`
                : '../assets/imgs/const.png';
            
            const lastOnline = new Date(friend.last_online);
            const isOnline = (Date.now() - lastOnline.getTime()) < 5 * 60 * 1000; // 5 min

            return `
                <div class="friend-item">
                    <img src="${avatarUrl}" alt="${escapeHtml(friend.friend_username)}" onerror="this.src='../assets/imgs/const.png'">
                    <span class="friend-name">${escapeHtml(friend.friend_username)}</span>
                    <span class="friend-status ${isOnline ? 'online' : ''}">${isOnline ? 'Online' : 'Offline'}</span>
                    <button onclick="removeFriend('${friend.friend_username}')" class="btn-secondary btn-small">Remove</button>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error("Error loading friends:", err);
    }
}

async function loadFriendRequests() {
    if (!currentUser) return;

    try {
        const res = await fetch(`/api/user/${currentUser.username}/friend-requests`);
        const data = await res.json();

        const container = document.getElementById('friend-requests');
        
        if (data.incoming.length === 0 && data.outgoing.length === 0) {
            container.innerHTML = '<p class="muted">No pending requests</p>';
            return;
        }

        let html = '';
        
        data.incoming.forEach(req => {
            const avatarUrl = req.discord_id && req.avatar
                ? `https://cdn.discordapp.com/avatars/${req.discord_id}/${req.avatar}.png`
                : '../assets/imgs/const.png';
            html += `
                <div class="friend-item">
                    <img src="${avatarUrl}" alt="${escapeHtml(req.from_user)}" onerror="this.src='../assets/imgs/const.png'">
                    <span class="friend-name">${escapeHtml(req.from_user)}</span>
                    <button onclick="acceptFriend('${req.from_user}')" class="btn-primary btn-small">Accept</button>
                    <button onclick="declineFriend('${req.from_user}')" class="btn-secondary btn-small">Decline</button>
                </div>
            `;
        });

        data.outgoing.forEach(req => {
            const avatarUrl = req.discord_id && req.avatar
                ? `https://cdn.discordapp.com/avatars/${req.discord_id}/${req.avatar}.png`
                : '../assets/imgs/const.png';
            html += `
                <div class="friend-item">
                    <img src="${avatarUrl}" alt="${escapeHtml(req.to_user)}" onerror="this.src='../assets/imgs/const.png'">
                    <span class="friend-name">${escapeHtml(req.to_user)}</span>
                    <span class="friend-status">Pending</span>
                    <button onclick="cancelFriendRequest('${req.to_user}')" class="btn-secondary btn-small">Cancel</button>
                </div>
            `;
        });

        container.innerHTML = html;
    } catch (err) {
        console.error("Error loading friend requests:", err);
    }
}

async function searchUsers() {
    const query = document.getElementById('user-search').value.trim();
    if (query.length < 2) {
        alert("Please enter at least 2 characters");
        return;
    }

    try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
        const users = await res.json();

        const container = document.getElementById('search-results');
        if (users.length === 0) {
            container.innerHTML = '<p class="muted">No users found</p>';
            return;
        }

        container.innerHTML = users
            .filter(u => u.username !== currentUser.username)
            .map(user => {
                const avatarUrl = user.discord_id && user.avatar
                    ? `https://cdn.discordapp.com/avatars/${user.discord_id}/${user.avatar}.png`
                    : '../assets/imgs/const.png';
                return `
                    <div class="user-result">
                        <img src="${avatarUrl}" alt="${escapeHtml(user.username)}" onerror="this.src='../assets/imgs/const.png'">
                        <span class="user-name">${escapeHtml(user.username)}</span>
                        <span class="role-badge ${user.role || 'user'}">${user.role || 'user'}</span>
                        <button onclick="sendFriendRequest('${user.username}')" class="btn-primary btn-small">Add Friend</button>
                    </div>
                `;
            }).join('');
    } catch (err) {
        console.error("Search Error:", err);
    }
}

async function sendFriendRequest(toUser) {
    if (!currentUser) return;

    try {
        const res = await fetch('/api/friends/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from_user: currentUser.username,
                to_user: toUser
            })
        });

        const data = await res.json();
        if (data.success) {
            loadFriendRequests();
            document.getElementById('search-results').innerHTML = '<p class="muted">Friend request sent!</p>';
        } else {
            alert(data.error || 'Failed to send request');
        }
    } catch (err) {
        console.error("Friend Request Error:", err);
    }
}

async function acceptFriend(fromUser) {
    if (!currentUser) return;

    try {
        await fetch('/api/friends/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from_user: fromUser,
                to_user: currentUser.username
            })
        });
        loadFriends();
        loadFriendRequests();
    } catch (err) {
        console.error("Accept Friend Error:", err);
    }
}

async function declineFriend(fromUser) {
    if (!currentUser) return;

    try {
        await fetch('/api/friends/decline', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user1: fromUser,
                user2: currentUser.username
            })
        });
        loadFriendRequests();
    } catch (err) {
        console.error("Decline Friend Error:", err);
    }
}

async function removeFriend(friendUsername) {
    if (!confirm(`Remove ${friendUsername} as a friend?`)) return;
    
    try {
        await fetch('/api/friends/decline', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user1: currentUser.username,
                user2: friendUsername
            })
        });
        loadFriends();
    } catch (err) {
        console.error("Remove Friend Error:", err);
    }
}

async function cancelFriendRequest(toUser) {
    await removeFriend(toUser);
    loadFriendRequests();
}

// Moderator Panel
async function loadModeratorPanel() {
    document.getElementById('moderator-panel').style.display = 'block';

    try {
        const res = await fetch(`/api/moderator/pending?moderator_username=${currentUser.username}`);
        const data = await res.json();

        const container = document.getElementById('pending-items');
        
        if (data.articles.length === 0 && data.revisions.length === 0) {
            container.innerHTML = '<p class="muted">No pending items to review</p>';
            return;
        }

        let html = '';

        if (data.articles.length > 0) {
            html += '<h3 style="color: #aaa; margin-bottom: 15px;">Pending Articles</h3>';
            data.articles.forEach(article => {
                html += `
                    <div class="pending-item">
                        <h4>${escapeHtml(article.title)}</h4>
                        <p>By ${escapeHtml(article.author)} • ${article.category_name || 'Uncategorized'}</p>
                        <div class="pending-actions">
                            <button onclick="approveArticle(${article.id})" class="btn-primary btn-small">Approve</button>
                            <button onclick="rejectArticle(${article.id})" class="btn-danger btn-small">Reject</button>
                        </div>
                    </div>
                `;
            });
        }

        if (data.revisions.length > 0) {
            html += '<h3 style="color: #aaa; margin: 20px 0 15px;">Pending Edits</h3>';
            data.revisions.forEach(rev => {
                html += `
                    <div class="pending-item">
                        <h4>Edit for: ${escapeHtml(rev.title)}</h4>
                        <p>By ${escapeHtml(rev.editor)} • ${rev.edit_summary || 'No summary'}</p>
                        <div class="pending-actions">
                            <button onclick="approveRevision(${rev.id})" class="btn-primary btn-small">Approve</button>
                            <button onclick="rejectRevision(${rev.id})" class="btn-danger btn-small">Reject</button>
                        </div>
                    </div>
                `;
            });
        }

        container.innerHTML = html;
    } catch (err) {
        console.error("Moderator Panel Error:", err);
        document.getElementById('pending-items').innerHTML = '<p class="muted">Error loading pending items</p>';
    }
}

async function approveArticle(id) {
    try {
        await fetch(`/api/moderator/article/${id}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ moderator_username: currentUser.username })
        });
        loadModeratorPanel();
    } catch (err) {
        console.error("Approve Error:", err);
    }
}

async function rejectArticle(id) {
    try {
        await fetch(`/api/moderator/article/${id}/reject`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ moderator_username: currentUser.username })
        });
        loadModeratorPanel();
    } catch (err) {
        console.error("Reject Error:", err);
    }
}

async function approveRevision(id) {
    try {
        await fetch(`/api/admin/explain/revision/${id}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reviewer: currentUser.username })
        });
        loadModeratorPanel();
    } catch (err) {
        console.error("Approve Revision Error:", err);
    }
}

async function rejectRevision(id) {
    try {
        await fetch(`/api/admin/explain/revision/${id}/reject`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reviewer: currentUser.username })
        });
        loadModeratorPanel();
    } catch (err) {
        console.error("Reject Revision Error:", err);
    }
}

// Utilities
function escapeHtml(text) {
    if (!text) return "";
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

// Close modals on background click
document.getElementById('settings-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'settings-modal') hideSettings();
});

document.getElementById('friends-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'friends-modal') hideFriends();
});

// Handle enter key in search
document.getElementById('user-search')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchUsers();
});
