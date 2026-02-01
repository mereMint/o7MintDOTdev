let offset = 0;
const limit = 10;
let isLoading = false;
let allLoaded = false;

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
            el.innerHTML = `
                <div class="post-header">
                    <span class="post-username">${escapeHtml(post.username)}</span>
                    <span>${new Date(post.created_at).toLocaleString()}</span>
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
    const username = document.getElementById('username').value;
    const content = document.getElementById('content').value;

    if (!content.trim()) return alert("Content cannot be empty!");

    try {
        const res = await fetch('/api/post', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, content })
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
            alert('Error: ' + result.error);
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

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
    loadPosts();

    // Character Counter
    const contentInput = document.getElementById('content');
    const charCount = document.getElementById('char-count');

    contentInput.addEventListener('input', () => {
        const currentLength = contentInput.value.length;
        charCount.innerText = `${currentLength}/255`;

        if (currentLength >= 255) {
            charCount.style.color = '#ff4444'; // Red warning
        } else {
            charCount.style.color = '#888';
        }
    });
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
