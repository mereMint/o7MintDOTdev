let offset = 0;
const limit = 10;
let isLoading = false;
let allLoaded = false;
let currentUser = null;

// Helper function to get session token
function getSessionToken() {
    return localStorage.getItem('session_token');
}

// Helper function to get auth headers
function getAuthHeaders() {
    const token = getSessionToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

// Check authentication on load
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    loadPosts();

    // Character Counter
    const contentInput = document.getElementById('content');
    const charCount = document.getElementById('char-count');

    if (contentInput) {
        contentInput.addEventListener('input', () => {
            const currentLength = contentInput.value.length;
            charCount.innerText = `${currentLength}/255`;

            if (currentLength >= 255) {
                charCount.style.color = '#ff4444'; // Red warning
            } else {
                charCount.style.color = '#888';
            }
        });
    }
});

function checkAuth() {
    const storedUser = localStorage.getItem('discord_user');
    const sessionToken = getSessionToken();
    
    // Require both user data and session token
    if (storedUser && sessionToken) {
        currentUser = JSON.parse(storedUser);
        
        // Show post form, hide login message
        document.getElementById('post-form').style.display = 'flex';
        document.getElementById('login-required').style.display = 'none';
        
        // Set user info
        const avatarUrl = currentUser.discord_id && currentUser.avatar && currentUser.avatar !== '0'
            ? `https://cdn.discordapp.com/avatars/${currentUser.discord_id}/${currentUser.avatar}.png`
            : '../assets/imgs/const.png';
        
        document.getElementById('current-user-avatar').src = avatarUrl;
        document.getElementById('current-user-avatar').onerror = function() {
            this.src = '../assets/imgs/const.png';
        };
        document.getElementById('current-user-name').textContent = currentUser.username;
    } else {
        // Clear any stale data if session is missing
        if (!sessionToken) {
            localStorage.removeItem('discord_user');
        }
        currentUser = null;
        // Show login message, hide post form
        document.getElementById('post-form').style.display = 'none';
        document.getElementById('login-required').style.display = 'block';
    }
}

async function loadPosts() {
    if (isLoading || allLoaded) return;
    isLoading = true;
    document.getElementById('loading').style.display = 'block';

    try {
        const res = await fetch(`/api/posts?limit=${limit}&offset=${offset}`);
        const posts = await res.json();

        if (posts.length < limit) {
            allLoaded = true;
        }

        const feed = document.getElementById('feed');
        posts.forEach(post => {
            const el = document.createElement('div');
            el.className = 'post';
            
            // Get avatar URL
            const avatarUrl = post.discord_id && post.avatar
                ? `https://cdn.discordapp.com/avatars/${post.discord_id}/${post.avatar}.png`
                : '../assets/imgs/const.png';
            
            el.innerHTML = `
                <div class="post-header">
                    <div class="post-user">
                        <img src="${avatarUrl}" alt="Avatar" class="post-avatar" onerror="this.src='../assets/imgs/const.png'">
                        <span class="post-username">${escapeHtml(post.username)}</span>
                    </div>
                    <span class="post-time">${new Date(post.created_at).toLocaleString()}</span>
                </div>
                <div class="post-content">${escapeHtml(post.content)}</div>
            `;
            feed.appendChild(el);
        });

        offset += posts.length;
    } catch (err) {
        console.error("Failed to load posts", err);
    } finally {
        isLoading = false;
        document.getElementById('loading').style.display = 'none';
    }
}

async function submitPost() {
    if (!currentUser || !getSessionToken()) {
        alert("You must be logged in to post!");
        return;
    }

    const content = document.getElementById('content').value;

    if (!content.trim()) return alert("Content cannot be empty!");

    try {
        const res = await fetch('/api/post', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ 
                content: content
                // Note: username is now taken from the session on the server side
            })
        });

        const result = await res.json();

        if (res.ok) {
            document.getElementById('content').value = '';
            document.getElementById('char-count').innerText = '0/255'; // Reset counter
            // Reset feed to show new post
            document.getElementById('feed').innerHTML = '';
            offset = 0;
            allLoaded = false;
            loadPosts();
        } else {
            if (res.status === 401) {
                // Session expired, clear auth
                localStorage.removeItem('session_token');
                localStorage.removeItem('discord_user');
                alert('Your session has expired. Please log in again.');
                location.reload();
            } else {
                alert('Error: ' + result.error);
            }
        }
    } catch (err) {
        alert("Failed to submit post.");
    }
}

// Infinite Scroll
window.addEventListener('scroll', () => {
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 100) {
        loadPosts();
    }
});

// Utility to prevent XSS
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
