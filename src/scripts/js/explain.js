// Explain-TM Wiki JavaScript

const API_BASE = '/api/explain';

// =============================================
// Custom Syntax Parser
// =============================================

function parseExplainSyntax(content) {
    let html = escapeHtml(content);
    
    // Headings: # H1, ## H2, ### H3, #### H4
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    
    // Bold: **text** or __text__
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    
    // Italic: *text* or _text_
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    html = html.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>');
    
    // Colored text: {color:red}text{/color}
    html = html.replace(/\{color:(red|green|blue|yellow|purple|orange)\}(.+?)\{\/color\}/g, 
        '<span class="text-$1">$2</span>');
    
    // Inline code: `code`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Code blocks: ```code```
    html = html.replace(/```([\s\S]+?)```/g, '<pre><code>$1</code></pre>');
    
    // LaTeX inline: $formula$
    html = html.replace(/\$([^$\n]+)\$/g, '<span class="latex-inline">$1</span>');
    
    // LaTeX block: $$formula$$
    html = html.replace(/\$\$([\s\S]+?)\$\$/g, '<div class="latex-block">$1</div>');
    
    // Links: [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    
    // Images: ![alt](url)
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');
    
    // Blockquotes: > text
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
    // Merge consecutive blockquotes
    html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');
    
    // Unordered lists: - item or * item
    html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    
    // Ordered lists: 1. item
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    
    // Horizontal rule: ---
    html = html.replace(/^---$/gm, '<hr>');
    
    // Paragraphs: double newline
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';
    
    // Clean up empty paragraphs and fix nesting
    html = html.replace(/<p>\s*<\/p>/g, '');
    html = html.replace(/<p>(<h[1-4]>)/g, '$1');
    html = html.replace(/(<\/h[1-4]>)<\/p>/g, '$1');
    html = html.replace(/<p>(<ul>)/g, '$1');
    html = html.replace(/(<\/ul>)<\/p>/g, '$1');
    html = html.replace(/<p>(<blockquote>)/g, '$1');
    html = html.replace(/(<\/blockquote>)<\/p>/g, '$1');
    html = html.replace(/<p>(<pre>)/g, '$1');
    html = html.replace(/(<\/pre>)<\/p>/g, '$1');
    html = html.replace(/<p>(<hr>)<\/p>/g, '$1');
    html = html.replace(/<p>(<div class="latex-block">)/g, '$1');
    html = html.replace(/(<\/div>)<\/p>/g, '$1');
    
    return html;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getPreview(content, maxLength = 200) {
    // Strip syntax and get plain text preview
    let text = content
        .replace(/[#*_`$]/g, '')
        .replace(/\{color:\w+\}/g, '')
        .replace(/\{\/color\}/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
        .replace(/\n+/g, ' ')
        .trim();
    
    if (text.length > maxLength) {
        text = text.substring(0, maxLength) + '...';
    }
    return text;
}

// =============================================
// API Functions
// =============================================

async function fetchCategories() {
    try {
        const res = await fetch(`${API_BASE}/categories`);
        return await res.json();
    } catch (err) {
        console.error('Error fetching categories:', err);
        return [];
    }
}

async function fetchArticles(options = {}) {
    const params = new URLSearchParams();
    if (options.category) params.set('category', options.category);
    if (options.search) params.set('search', options.search);
    if (options.sort) params.set('sort', options.sort);
    if (options.limit) params.set('limit', options.limit);
    if (options.offset) params.set('offset', options.offset);
    
    try {
        const res = await fetch(`${API_BASE}/articles?${params}`);
        return await res.json();
    } catch (err) {
        console.error('Error fetching articles:', err);
        return { articles: [], total: 0 };
    }
}

async function fetchTrending(limit = 10) {
    try {
        const res = await fetch(`${API_BASE}/articles/trending?limit=${limit}`);
        return await res.json();
    } catch (err) {
        console.error('Error fetching trending:', err);
        return [];
    }
}

async function fetchArticle(slug) {
    try {
        const res = await fetch(`${API_BASE}/article/${slug}`);
        if (!res.ok) return null;
        return await res.json();
    } catch (err) {
        console.error('Error fetching article:', err);
        return null;
    }
}

async function createArticle(data) {
    try {
        const res = await fetch(`${API_BASE}/article`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return await res.json();
    } catch (err) {
        console.error('Error creating article:', err);
        return { error: 'Network error' };
    }
}

async function submitEdit(slug, data) {
    try {
        const res = await fetch(`${API_BASE}/article/${slug}/edit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return await res.json();
    } catch (err) {
        console.error('Error submitting edit:', err);
        return { error: 'Network error' };
    }
}

// =============================================
// UI Rendering Functions
// =============================================

function renderCategoryTabs(categories, activeId = null, onClick) {
    const container = document.getElementById('category-tabs');
    if (!container) return;
    
    container.innerHTML = `
        <button class="category-tab ${!activeId ? 'active' : ''}" data-id="">All</button>
        ${categories.map(cat => `
            <button class="category-tab ${activeId == cat.id ? 'active' : ''}" 
                    data-id="${cat.id}" 
                    style="--cat-color: ${cat.color}">
                ${cat.name}
            </button>
        `).join('')}
    `;
    
    container.querySelectorAll('.category-tab').forEach(btn => {
        btn.addEventListener('click', () => onClick(btn.dataset.id || null));
    });
}

function renderArticleCard(article) {
    const preview = getPreview(article.content);
    const date = new Date(article.created_at).toLocaleDateString();
    
    return `
        <div class="article-card" onclick="viewArticle('${article.slug}')">
            <span class="category-badge" style="background: ${article.category_color || '#333'}; color: #000;">
                ${article.category_name || 'Uncategorized'}
            </span>
            <h3>${escapeHtml(article.title)}</h3>
            <p class="preview">${escapeHtml(preview)}</p>
            <div class="meta">
                <span>By ${escapeHtml(article.author)}</span>
                <span>${article.views} views • ${date}</span>
            </div>
        </div>
    `;
}

function renderArticlesGrid(articles) {
    const container = document.getElementById('articles-grid');
    if (!container) return;
    
    if (articles.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <h3>No articles found</h3>
                <p>Be the first to create one!</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = articles.map(renderArticleCard).join('');
}

function renderTrendingSection(articles) {
    const container = document.getElementById('trending-articles');
    if (!container) return;
    
    if (articles.length === 0) {
        container.innerHTML = '<p class="empty-state">No trending articles yet</p>';
        return;
    }
    
    container.innerHTML = articles.slice(0, 5).map(renderArticleCard).join('');
}

function renderArticleView(article) {
    const container = document.getElementById('article-view');
    if (!container) return;
    
    const date = new Date(article.created_at).toLocaleDateString();
    const updated = new Date(article.updated_at).toLocaleDateString();
    
    container.innerHTML = `
        <div class="article-header">
            <span class="category-badge" style="background: ${article.category_color || '#333'}; color: #000;">
                ${article.category_name || 'Uncategorized'}
            </span>
            <h1>${escapeHtml(article.title)}</h1>
            <div class="article-meta">
                <span>By ${escapeHtml(article.author)}</span>
                <span>Created: ${date}</span>
                ${date !== updated ? `<span>Updated: ${updated}</span>` : ''}
                <span>${article.views} views</span>
            </div>
        </div>
        <div class="article-content">
            ${parseExplainSyntax(article.content)}
        </div>
        <div class="article-actions">
            <a href="Explain-TM.html" class="btn btn-secondary">← Back to Wiki</a>
            <button class="btn btn-primary" onclick="showEditForm()">Suggest Edit</button>
        </div>
    `;
}

function renderCategorySelect(categories, selectedId = null) {
    const select = document.getElementById('category-select');
    if (!select) return;
    
    select.innerHTML = `
        <option value="">Select a category...</option>
        ${categories.map(cat => `
            <option value="${cat.id}" ${selectedId == cat.id ? 'selected' : ''}>
                ${cat.name}
            </option>
        `).join('')}
    `;
}

function showMessage(message, type = 'success') {
    const container = document.getElementById('status-message');
    if (!container) return;
    
    container.className = `status-message ${type}`;
    container.textContent = message;
    container.style.display = 'block';
    
    if (type === 'success') {
        setTimeout(() => {
            container.style.display = 'none';
        }, 5000);
    }
}

// =============================================
// Page Navigation
// =============================================

function viewArticle(slug) {
    window.location.href = `Explain-TM-Article.html?slug=${slug}`;
}

function showCreateForm() {
    window.location.href = 'Explain-TM-Create.html';
}

function showEditForm() {
    const slug = new URLSearchParams(window.location.search).get('slug');
    if (slug) {
        window.location.href = `Explain-TM-Edit.html?slug=${slug}`;
    }
}

// =============================================
// Page Initialization
// =============================================

// Main wiki page
async function initWikiHome() {
    const categories = await fetchCategories();
    let currentCategory = null;
    let currentSearch = '';
    
    async function loadArticles() {
        const gridContainer = document.getElementById('articles-grid');
        if (gridContainer) {
            gridContainer.innerHTML = '<div class="loading" style="grid-column: 1 / -1;">Loading articles...</div>';
        }
        
        const data = await fetchArticles({
            category: currentCategory,
            search: currentSearch,
            limit: 20
        });
        renderArticlesGrid(data.articles);
    }
    
    // Render category tabs
    renderCategoryTabs(categories, currentCategory, async (catId) => {
        currentCategory = catId;
        await loadArticles();
        // Update active state
        document.querySelectorAll('.category-tab').forEach(btn => {
            btn.classList.toggle('active', (btn.dataset.id || null) === catId);
        });
    });
    
    // Search handler
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    
    if (searchBtn) {
        searchBtn.addEventListener('click', async () => {
            currentSearch = searchInput?.value || '';
            await loadArticles();
        });
    }
    
    if (searchInput) {
        searchInput.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter') {
                currentSearch = searchInput.value;
                await loadArticles();
            }
        });
    }
    
    // Load trending
    const trending = await fetchTrending(5);
    renderTrendingSection(trending);
    
    // Load all articles
    await loadArticles();
}

// Article view page
async function initArticleView() {
    const slug = new URLSearchParams(window.location.search).get('slug');
    
    if (!slug) {
        document.getElementById('article-view').innerHTML = `
            <div class="empty-state">
                <h3>Article not found</h3>
                <a href="Explain-TM.html" class="btn btn-primary">Back to Wiki</a>
            </div>
        `;
        return;
    }
    
    const article = await fetchArticle(slug);
    
    if (!article) {
        document.getElementById('article-view').innerHTML = `
            <div class="empty-state">
                <h3>Article not found</h3>
                <p>This article may have been removed or is pending review.</p>
                <a href="Explain-TM.html" class="btn btn-primary">Back to Wiki</a>
            </div>
        `;
        return;
    }
    
    // Update page title
    document.title = `${article.title} - Explain-TM`;
    
    renderArticleView(article);
}

// Create article page
async function initCreatePage() {
    const categories = await fetchCategories();
    renderCategorySelect(categories);
    
    const form = document.getElementById('article-form');
    if (!form) return;
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const title = document.getElementById('title-input').value;
        const content = document.getElementById('content-input').value;
        const category_id = document.getElementById('category-select').value || null;
        const author = document.getElementById('author-input').value || 'Anonymous';
        
        const result = await createArticle({ title, content, category_id, author });
        
        if (result.error) {
            showMessage(result.error, 'error');
        } else {
            showMessage('Article submitted for review! It will appear once approved.', 'success');
            form.reset();
        }
    });
    
    // Live preview
    const contentInput = document.getElementById('content-input');
    const previewContainer = document.getElementById('preview-container');
    
    if (contentInput && previewContainer) {
        contentInput.addEventListener('input', () => {
            previewContainer.innerHTML = parseExplainSyntax(contentInput.value);
        });
    }
}

// Edit article page
async function initEditPage() {
    const slug = new URLSearchParams(window.location.search).get('slug');
    
    if (!slug) {
        window.location.href = 'Explain-TM.html';
        return;
    }
    
    const article = await fetchArticle(slug);
    
    if (!article) {
        showMessage('Article not found', 'error');
        return;
    }
    
    // Pre-fill form
    document.getElementById('article-title').textContent = article.title;
    document.getElementById('content-input').value = article.content;
    
    const form = document.getElementById('edit-form');
    if (!form) return;
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const content = document.getElementById('content-input').value;
        const editor = document.getElementById('editor-input').value || 'Anonymous';
        const edit_summary = document.getElementById('summary-input').value;
        
        const result = await submitEdit(slug, { content, editor, edit_summary });
        
        if (result.error) {
            showMessage(result.error, 'error');
        } else {
            showMessage('Edit submitted for review! Changes will appear once approved.', 'success');
        }
    });
    
    // Live preview
    const contentInput = document.getElementById('content-input');
    const previewContainer = document.getElementById('preview-container');
    
    if (contentInput && previewContainer) {
        previewContainer.innerHTML = parseExplainSyntax(contentInput.value);
        contentInput.addEventListener('input', () => {
            previewContainer.innerHTML = parseExplainSyntax(contentInput.value);
        });
    }
}
