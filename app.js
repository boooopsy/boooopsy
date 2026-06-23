// Utilities
function getUTCString() {
    const d = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    return `${pad(d.getUTCDate())}${pad(d.getUTCMonth() + 1)}${d.getUTCFullYear()}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

// Parses chronological dates directly from sequential filenames (postDDMMYYYYHHMM.json)
function getFilenameDate(filename) {
    const match = filename.match(/post(\d{2})(\d{2})(\d{4})(\d{2})(\d{2})\.json/);
    if (!match) return new Date(0);
    const [_, day, month, year, hour, minute] = match;
    return new Date(Date.UTC(year, parseInt(month) - 1, day, hour, minute));
}

function formatDisplayDate(utcDateStr) {
    const d = new Date(utcDateStr);
    return `${d.getUTCDate()} ${d.toLocaleString('default', { month: 'short' })}, ${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')} UTC`;
}

function formatListDate(utcDateStr) {
    const d = new Date(utcDateStr);
    return `${d.getUTCDate()} ${d.toLocaleString('default', { month: 'short' })}, ${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')}`;
}

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag]));
}

// State
let isAdmin = false;
let githubPAT = sessionStorage.getItem('github_pat');
let loadedPosts = [];
let currentViewMode = localStorage.getItem('viewMode') || 'expanded';
let searchResultsIndex = -1;
let currentSearchResults = [];

let editingPostId = null;
let editingPostSha = null;
let editingPostPath = null;
let editingPostMeta = null;

function showFeedMessage(message) {
    const feed = document.getElementById('feed');
    const loadingSpinner = document.getElementById('loading-spinner');
    if (loadingSpinner) loadingSpinner.classList.add('hidden');
    if (feed) feed.insertAdjacentHTML('beforeend', `<p class="feed-message">${message}</p>`);
}

async function unlockAdminWithToken(token) {
    if (!token) return false;
    const cleanToken = token.trim(); 
    try {
        const res = await fetch('https://api.github.com/user', {
            headers: { 'Authorization': `token ${cleanToken}`, 'Accept': 'application/vnd.github+json' }
        });
        if (!res.ok) return false;
        
        const profile = await res.json();
        if (profile.login.toLowerCase() !== CONFIG.ADMIN_GITHUB_HANDLE.toLowerCase()) return false;

        githubPAT = cleanToken;
        sessionStorage.setItem('github_pat', cleanToken);
        isAdmin = true;
        document.getElementById('admin-fab').classList.remove('hidden');
        document.getElementById('logout-btn').classList.remove('hidden');
        renderPostManager();
        return true;
    } catch (error) {
        console.error('Auth failed:', error);
        return false;
    }
}

// Startup
document.addEventListener('DOMContentLoaded', async () => {
    document.addEventListener('keydown', async (e) => {
        if (!e.ctrlKey || !e.shiftKey || e.key.toLowerCase() !== 'a') return;
        e.preventDefault();
        const token = githubPAT || prompt("ADMIN: Enter your GitHub PAT:");
        const unlocked = await unlockAdminWithToken(token);
        if (unlocked) document.getElementById('admin-modal')?.classList.remove('hidden');
    });

    document.getElementById('tag-search-input').addEventListener('input', () => {
        handleSearch();
    });

    const viewCheckbox = document.getElementById('view-toggle-checkbox');
    if (currentViewMode === 'list') { viewCheckbox.checked = true; }
    viewCheckbox.addEventListener('change', (e) => {
        toggleView(e.target.checked ? 'list' : 'expanded');
    });

    const themeCheckbox = document.getElementById('theme-toggle-checkbox');
    if (localStorage.getItem('theme') === 'dark') { 
        document.body.setAttribute('data-theme', 'dark'); 
        themeCheckbox.checked = true; 
    }
    themeCheckbox.addEventListener('change', (e) => {
        if(e.target.checked) {
            document.body.setAttribute('data-theme', 'dark'); 
            localStorage.setItem('theme', 'dark');
        } else {
            document.body.removeAttribute('data-theme'); 
            localStorage.setItem('theme', 'light');
        }
    });

    toggleView(currentViewMode, false);

    document.getElementById('logout-btn').addEventListener('click', () => { 
        sessionStorage.removeItem('github_pat'); 
        window.location.reload(); 
    });
    
    // Auto-login admin if PAT is preserved in session
    if (githubPAT) {
        await unlockAdminWithToken(githubPAT.trim());
    }

    loadFeed();
});

// GitHub API
async function pushToGitHub(filePath, contentStr, message, sha = null, isBase64 = false) {
    if (!githubPAT) return alert("Missing GitHub Token.");
    const contentEncoded = isBase64 ? contentStr : btoa(unescape(encodeURIComponent(contentStr)));
    const body = { message: message, content: contentEncoded };
    if (sha) body.sha = sha;

    const res = await fetch(`https://api.github.com/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/contents/${filePath}`, {
        method: 'PUT',
        headers: { 'Authorization': `token ${githubPAT}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return res.json();
}

async function fetchFromGitHub(filePath) {
    const res = await fetch(`https://api.github.com/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/contents/${filePath}`);
    if (!res.ok) return null;
    return res.json();
}

async function deleteFromGitHub(filePath, sha, message) {
    if (!githubPAT) return;
    const body = { message: message, sha: sha };
    const res = await fetch(`https://api.github.com/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/contents/${filePath}`, {
        method: 'DELETE',
        headers: { 'Authorization': `token ${githubPAT}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return res.json();
}

// Feed view
window.toggleView = function(mode, save = true) {
    currentViewMode = mode;
    if (save) localStorage.setItem('viewMode', mode);

    const feed = document.getElementById('feed');
    if (feed) {
        if (mode === 'expanded') {
            feed.classList.remove('list-view');
        } else {
            feed.classList.add('list-view');
        }
    }
}

// Handles scrolling via timeline ONLY (does not expand cards)
window.scrollToPost = function(e, id) {
    if (e) e.preventDefault();
    
    const target = document.getElementById(id);
    if (!target) return;

    const targetY = target.getBoundingClientRect().top + window.scrollY - 40; 
    const startY = window.scrollY;
    const distance = targetY - startY;
    const duration = 800; 
    let start = null;

    function easeOutBack(t) {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }

    function step(timestamp) {
        if (!start) start = timestamp;
        let progress = (timestamp - start) / duration;
        if (progress > 1) progress = 1;
        
        window.scrollTo(0, startY + distance * easeOutBack(progress));
        
        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            history.replaceState(null, null, `#${id}`); 
        }
    }
    
    window.requestAnimationFrame(step);
}

// Handles clicking an individual card in List View to expand/collapse it
window.handleCardClick = function(e, id) {
    if (currentViewMode !== 'list') return; 
    
    e.preventDefault();
    const card = document.getElementById(id);
    if (card) {
        card.classList.toggle('is-expanded');
    }
}

// Helper to compile and mount individual post cards cleanly
window.renderSinglePostCard = function(post, tempLikes, feed, observer) {
    const totalLikes = (post.likes ? post.likes.length : 0) + (tempLikes ? tempLikes.filter(l => l.post_id === post.id).length : 0);

    const card = document.createElement('article');
    card.className = 'blog-card';
    card.id = post.id;

    let titleHTML = post.title ? `<h2>${escapeHTML(post.title)}</h2>` : '';
    
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = post.content || '';
    const rawText = tempDiv.textContent || tempDiv.innerText || '';
    const previewText = rawText.length > 150 ? rawText.substring(0, 150) + '...' : rawText;
    
    const postImages = tempDiv.querySelectorAll('img');
    let previewImagesHTML = '';
    if (postImages.length > 0) {
        previewImagesHTML += `<img src="${escapeHTML(postImages[0].src)}" />`;
        if (postImages.length > 1) {
            previewImagesHTML += `<img src="${escapeHTML(postImages[1].src)}" />`;
        }
    }

    let tagsHTML = '';
    if (post.tags && post.tags.length > 0) {
        tagsHTML = `<div class="blog-tags">` + 
            post.tags.map(t => `<span>${escapeHTML(t)}</span>`).join('') + 
            `</div>`;
    }

    card.innerHTML = `
        <a href="#${post.id}" class="card-inner" onclick="handleCardClick(event, '${post.id}')">
            <div class="expanded-only">
                <div class="blog-meta">${formatDisplayDate(post.timestamp)}</div>
                ${titleHTML}
            </div>
            <div class="list-view-header">
                ${titleHTML}
                <div class="blog-meta">${formatDisplayDate(post.timestamp)}</div>
            </div>
            <div class="list-view-preview">
                <div class="list-preview-text">${escapeHTML(previewText)}</div>
                ${previewImagesHTML ? `<div class="list-preview-images">${previewImagesHTML}</div>` : ''}
            </div>
        </a>
        ${tagsHTML}
        <div class="blog-content">${post.content}</div>
        <div class="card-actions">
            <button class="action-btn" onclick="toggleLike('${post.id}')">❤️ <span class="like-count">${totalLikes}</span></button>
            <button class="action-btn" onclick="sharePost('${post.id}')">🔗 Share</button>
        </div>
    `;
    feed.appendChild(card);
    observer.observe(card);
}

// Feed content
async function loadFeed() {
    try {
        clearSearchHighlighting();
        
        const feed = document.getElementById('feed');
        if (feed) feed.innerHTML = '<div id="loading-spinner">Loading logs from UTC...</div>';

        const res = await fetch(`https://api.github.com/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/contents/posts`);
        const loadingSpinner = document.getElementById('loading-spinner');

        if (!res.ok) {
            if (loadingSpinner) loadingSpinner.classList.add('hidden');
            if (feed) feed.innerHTML = '';
            return showFeedMessage("No posts found. Publish your first post from admin mode.");
        }
        
        const files = await res.json();
        const jsonFiles = files.filter(file => file.name.endsWith('.json'));
        
        // Sort filenames chronologically using meta-dates before downloading text bodies
        jsonFiles.sort((a, b) => getFilenameDate(b.name) - getFilenameDate(a.name));
        
        if (loadingSpinner) loadingSpinner.classList.add('hidden');
        if (jsonFiles.length === 0) {
            if (feed) feed.innerHTML = '';
            return showFeedMessage("No posts yet.");
        }

        if (feed) feed.innerHTML = ''; // Explicitly clear target frame to break duplication bugs
        const timeline = document.getElementById('timeline');
        if (timeline) timeline.innerHTML = ''; 
        loadedPosts = []; 

        // Generate entire breadcrumb layout immediately with zero download lag
        const groupedTimelineData = {};
        jsonFiles.forEach(file => {
            const date = getFilenameDate(file.name);
            const monthYear = date.toLocaleString('default', { month: 'short', year: 'numeric' });
            const dayStr = `${date.getUTCDate()} ${date.toLocaleString('default', { month: 'short' })}`;
            const id = file.name.replace('.json', ''); 
            
            if (!groupedTimelineData[monthYear]) groupedTimelineData[monthYear] = {};
            if (!groupedTimelineData[monthYear][dayStr]) groupedTimelineData[monthYear][dayStr] = [];
            
            groupedTimelineData[monthYear][dayStr].push({ id, date });
        });

        for (const [monthYear, days] of Object.entries(groupedTimelineData)) {
            if (timeline) {
                timeline.insertAdjacentHTML('beforeend', `
                    <div style="color: var(--accent); font-weight: bold; font-size: 0.9rem; position: relative; margin-top: 15px;">
                        ${monthYear}
                    </div>`);
            }
                
            for (const [dayStr, itemsInDay] of Object.entries(days)) {
                if (timeline) {
                    if (itemsInDay.length === 1) {
                        const item = itemsInDay[0];
                        timeline.insertAdjacentHTML('beforeend', `
                            <a href="#${item.id}" class="timeline-link" data-id="${item.id}" onclick="scrollToPost(event, '${item.id}')" style="color: var(--text-muted); text-decoration: none; font-size: 0.85rem; position: relative; display: block; transition: all 0.2s; margin-top: 10px;">
                                <span class="timeline-dot" style="position: absolute; left: -1.75rem; top: 4px; width: 8px; height: 8px; border-radius: 50%; background: var(--border); transition: all 0.2s;"></span>
                                ${dayStr}
                            </a>`);
                    } else {
                        timeline.insertAdjacentHTML('beforeend', `
                            <div style="color: var(--text); font-size: 0.85rem; position: relative; margin-top: 10px; font-weight: 500;">
                                <span style="position: absolute; left: -1.75rem; top: 4px; width: 8px; height: 8px; border-radius: 50%; background: var(--border);"></span>
                                ${dayStr}
                            </div>`);
                            
                        itemsInDay.forEach(item => {
                            const timeStr = `${item.date.getUTCHours().toString().padStart(2, '0')}:${item.date.getUTCMinutes().toString().padStart(2, '0')} UTC`;
                            timeline.insertAdjacentHTML('beforeend', `
                                <a href="#${item.id}" class="timeline-link" data-id="${item.id}" onclick="scrollToPost(event, '${item.id}')" style="color: var(--text-muted); text-decoration: none; font-size: 0.8rem; position: relative; display: block; transition: all 0.2s; margin-top: 8px; padding-left: 10px;">
                                    <span class="timeline-dot" style="position: absolute; left: -0.8rem; top: 5px; width: 6px; height: 6px; border-radius: 50%; background: var(--border); transition: all 0.2s;"></span>
                                    ${timeStr}
                                </a>`);
                        });
                    }
                }
            }
        }

        let currentActiveId = null;
        const observer = new IntersectionObserver((entries) => {
            let activeEntry = null;
            entries.forEach(entry => { if (entry.isIntersecting) activeEntry = entry; });

            if (activeEntry && currentActiveId !== activeEntry.target.id) {
                currentActiveId = activeEntry.target.id;
                
                document.querySelectorAll('.timeline-link').forEach(link => {
                    link.style.color = 'var(--text-muted)';
                    link.style.fontWeight = 'normal';
                    const dot = link.querySelector('.timeline-dot');
                    if (dot) { dot.style.background = 'var(--border)'; dot.style.boxShadow = 'none'; }
                });
                
                const activeLink = document.querySelector(`.timeline-link[data-id="${currentActiveId}"]`);
                if (activeLink) {
                    activeLink.style.color = 'var(--accent)';
                    activeLink.style.fontWeight = 'bold';
                    const dot = activeLink.querySelector('.timeline-dot');
                    if (dot) { dot.style.background = 'var(--accent)'; dot.style.boxShadow = '0 0 0 3px var(--focus)'; }
                    
                    const timelineContainer = document.querySelector('.timeline-container');
                    if (timelineContainer) {
                        const linkOffset = activeLink.offsetTop;
                        const containerHalfHeight = timelineContainer.clientHeight / 2;
                        timelineContainer.scrollTo({ top: linkOffset - containerHalfHeight, behavior: 'smooth' });
                    }
                }
            }
        }, { rootMargin: '-20% 0px -60% 0px' });

        const { data: tempLikes } = await supabaseClient.from('temp_likes').select('post_id, user_handle');

        // LAZY STREAMING LOOP: Loads post 1 instantly, then progressive-loads the rest
        for (let i = 0; i < jsonFiles.length; i++) {
            const file = jsonFiles[i];
            const rawRes = await fetch(file.download_url);
            const post = await rawRes.json();
            const populatedPost = { sha: file.sha, path: file.path, ...post };
            
            loadedPosts.push(populatedPost);
            renderSinglePostCard(populatedPost, tempLikes, feed, observer);

            if (i === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        if(isAdmin) renderPostManager(); 
    } catch (error) {
        console.error('Feed loading failed:', error);
        showFeedMessage("Error loading feed.");
    }
}

// Upgraded Infinite Click Mechanism without page refreshes or restrictions
window.toggleLike = async function(postId) {
    const card = document.getElementById(postId);
    if (card) {
        const countEl = card.querySelector('.like-count');
        if (countEl) {
            countEl.textContent = parseInt(countEl.textContent) + 1;
        }
    }
    await supabaseClient.from('temp_likes').insert([{ post_id: postId, user_handle: 'anon_' + Date.now() }]);
}

function sharePost(id) {
    const url = `${window.location.href.split('#')[0]}#${id}`;
    if (navigator.share) { navigator.share({ title: 'The Daily Thread', url: url }); } 
    else { navigator.clipboard.writeText(url); alert('Link copied!'); }
}

// Search
window.handleSearch = function() {
    const input = document.getElementById('tag-search-input').value.trim().toLowerCase();
    const statusLine = document.getElementById('search-status-line');
    const navButtons = document.getElementById('search-nav-buttons');
    const countText = document.getElementById('results-count-text');

    clearSearchHighlighting();
    if (statusLine) statusLine.classList.add('hidden');
    if (navButtons) navButtons.classList.add('hidden');
    currentSearchResults = [];
    searchResultsIndex = -1;

    if (!input) {
        return; 
    }

    currentSearchResults = loadedPosts.filter(p => p.tags && p.tags.some(t => t.toLowerCase().includes(input)));
    const totalFound = currentSearchResults.length;

    if (statusLine) statusLine.classList.remove('hidden');
    
    if (totalFound === 0) {
        if (countText) countText.textContent = `0 found for '${escapeHTML(input)}'`;
    } else {
        searchResultsIndex = 0; 
        updateSearchNavigationUI();
        highlightAndScrollToSearchResult(); 
    }
}

window.navigateSearchResult = function(direction) {
    if (currentSearchResults.length <= 1) return;

    searchResultsIndex += direction;
    if (searchResultsIndex < 0) searchResultsIndex = currentSearchResults.length - 1; 
    if (searchResultsIndex >= currentSearchResults.length) searchResultsIndex = 0; 

    clearSearchHighlighting(); 
    updateSearchNavigationUI();
    highlightAndScrollToSearchResult();
}

function updateSearchNavigationUI() {
    const input = document.getElementById('tag-search-input').value.trim().toLowerCase();
    const navButtons = document.getElementById('search-nav-buttons');
    const countText = document.getElementById('results-count-text');
    const totalFound = currentSearchResults.length;

    if (countText) countText.textContent = `${searchResultsIndex + 1} of ${totalFound} found for '${escapeHTML(input)}'`;
    
    if (totalFound > 1) {
        if (navButtons) navButtons.classList.remove('hidden');
    } else {
        if (navButtons) navButtons.classList.add('hidden');
    }
}

function highlightAndScrollToSearchResult() {
    const matchingPost = currentSearchResults[searchResultsIndex];
    if (!matchingPost) return;

    const card = document.getElementById(matchingPost.id);
    if (!card) return;

    if (currentViewMode === 'list') {
        card.classList.add('is-expanded');
    }

    card.classList.add('search-highlight');
    scrollToPost(null, matchingPost.id);
}

function clearSearchHighlighting() {
    document.querySelectorAll('.blog-card.search-highlight').forEach(c => c.classList.remove('search-highlight'));
}

// Admin editor
const adminModal = document.getElementById('admin-modal');
document.getElementById('admin-fab')?.addEventListener('click', () => { if(isAdmin) adminModal.classList.remove('hidden'); });
document.getElementById('close-modal')?.addEventListener('click', () => adminModal.classList.add('hidden'));

document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
        document.querySelectorAll('.tab, .tab-content').forEach(el => el.classList.remove('active', 'hidden'));
        document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
        e.target.classList.add('active');
        document.getElementById(e.target.dataset.target).classList.remove('hidden');
    });
});

let activeImage = null;
const editorDiv = document.getElementById('editor');
const imageTools = document.getElementById('image-tools');
let savedEditorRange = null;

function rememberEditorSelection() {
    const selection = window.getSelection();
    if (!selection.rangeCount || !editorDiv.contains(selection.anchorNode)) return;
    savedEditorRange = selection.getRangeAt(0).cloneRange();
}

function insertNodeAtEditorSelection(node) {
    if (!editorDiv) return;
    editorDiv.focus();

    const selection = window.getSelection();
    const currentRange = selection.rangeCount && editorDiv.contains(selection.anchorNode)
        ? selection.getRangeAt(0)
        : null;
    const range = savedEditorRange && editorDiv.contains(savedEditorRange.commonAncestorContainer)
        ? savedEditorRange
        : currentRange;

    if (!range) {
        editorDiv.appendChild(node);
        editorDiv.appendChild(document.createTextNode(' '));
        return;
    }

    selection.removeAllRanges();
    selection.addRange(range);
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    savedEditorRange = range.cloneRange();
}

if (editorDiv) {
    ['keyup', 'mouseup', 'input', 'focus'].forEach(eventName => {
        editorDiv.addEventListener(eventName, rememberEditorSelection);
    });

    editorDiv.addEventListener('click', (e) => {
        if (e.target.tagName === 'IMG') {
            if (activeImage) activeImage.classList.remove('editor-selected-img');
            activeImage = e.target;
            activeImage.classList.add('editor-selected-img');
            if (imageTools) imageTools.classList.remove('hidden');
        } else {
            if (activeImage) activeImage.classList.remove('editor-selected-img');
            activeImage = null;
            if (imageTools) imageTools.classList.add('hidden');
        }
    });
}

window.modifySelectedImage = function(action) {
    if (!activeImage) return;
    
    if (action === 'wrap-left') {
        activeImage.classList.remove('wrap-right', 'center-img');
        activeImage.classList.add('wrap-left');
    } else if (action === 'wrap-right') {
        activeImage.classList.remove('wrap-left', 'center-img');
        activeImage.classList.add('wrap-right');
    } else if (action === 'center') {
        activeImage.classList.remove('wrap-left', 'wrap-right');
        activeImage.classList.add('center-img');
        activeImage.style.width = ''; 
    } 
    else if (action === 'shrink' || action === 'grow') {
        let currentWidth = activeImage.style.width ? parseInt(activeImage.style.width) : activeImage.clientWidth;
        if(!activeImage.style.width && editorDiv) {
             const parentWidth = editorDiv.clientWidth;
             currentWidth = Math.round((currentWidth / parentWidth) * 100);
        }
        
        let newWidth = action === 'shrink' ? currentWidth - 10 : currentWidth + 10;
        if (newWidth < 10) newWidth = 10;
        if (newWidth > 100) newWidth = 100;
        
        activeImage.style.width = `${newWidth}%`;
        activeImage.style.height = 'auto'; 
    }
};

document.getElementById('image-upload')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const uploadMarker = document.createElement('span');
    uploadMarker.dataset.uploadingImage = 'true';
    uploadMarker.textContent = ' [Uploading Image...] ';
    insertNodeAtEditorSelection(uploadMarker);
    
    const reader = new FileReader();
    reader.onerror = () => {
        uploadMarker.textContent = ' [Upload Failed] ';
    };
    reader.onload = event => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = async () => {
            try {
                const canvas = document.createElement('canvas');
                const maxW = 1000;
                let [w, h] = [img.width, img.height];
                if (w > maxW) { h = Math.round((h * maxW) / w); w = maxW; }
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                
                const base64Raw = canvas.toDataURL('image/webp', 0.8).split(',')[1];
                const imgName = `img${getUTCString()}.webp`;
                
                console.log("Initiating image upload to GitHub...");
                const res = await pushToGitHub(`images/${imgName}`, base64Raw, 'Upload Image via CMS', null, true);
                
                if (res.content) {
                    const uploadedImg = document.createElement('img');
                    uploadedImg.src = res.content.download_url;
                    uploadedImg.className = 'center-img';
                    uploadedImg.alt = 'Log Image';
                    uploadMarker.replaceWith(uploadedImg);
                } else if (res.message) {
                    alert(`GitHub Error uploading image: ${res.message}`);
                    uploadMarker.textContent = ' [Upload Failed] ';
                }
            } catch (error) {
                console.error("Critical Image Upload Process Error:", error);
                alert("Critical error during image upload. Check the browser console (F12) for details.");
                uploadMarker.textContent = ' [Upload Failed] ';
            }
        };
    };
    reader.readAsDataURL(file);
    e.target.value = '';
});

// Post management
function renderPostManager() {
    const list = document.getElementById('post-manager-list');
    if (!list) return;
    if (loadedPosts.length === 0) { list.innerHTML = "<p>No posts available to edit.</p>"; return; }
    
    list.innerHTML = loadedPosts.map(p => {
        const title = p.title || p.id;
        return `
            <div class="manager-item">
                <div style="flex:1; min-width:0;">
                    <strong>${escapeHTML(title)}</strong>
                    <div class="manager-item-meta">${formatDisplayDate(p.timestamp)} &bull; ❤️ ${p.likes?.length || 0}</div>
                </div>
                <div class="manager-actions">
                    <button class="secondary-btn manager-edit-btn" onclick="loadPostIntoEditor('${p.id}')">Edit Post</button>
                    <button class="manager-delete-btn" type="button" title="Delete post" onclick="requestPostDeleteFromManager('${p.id}')"><span class="glyphicon glyphicon-trash" aria-hidden="true"></span></button>
                </div>
            </div>
        `;
    }).join('');
}

window.loadPostIntoEditor = function(id) {
    const post = loadedPosts.find(p => p.id === id);
    if(!post) return;
    
    editingPostId = post.id;
    editingPostSha = post.sha;
    editingPostPath = post.path;
    editingPostMeta = { likes: post.likes || [], timestamp: post.timestamp, title: post.title || '', tags: post.tags || [] }; 
    
    document.getElementById('post-title-input').value = editingPostMeta.title;
    document.getElementById('post-tags-input').value = editingPostMeta.tags.join(', ');
    if (editorDiv) editorDiv.innerHTML = post.content;

    document.getElementById('publish-btn').textContent = "Update Repository";
    document.getElementById('cancel-edit-btn').classList.remove('hidden');
    document.getElementById('delete-post-btn').classList.remove('hidden'); 
    
    document.querySelector('[data-target="write-tab"]').click();
};

window.resetEditor = function() {
    editingPostId = null; editingPostSha = null; editingPostPath = null; editingPostMeta = null;
    if (editorDiv) editorDiv.innerHTML = '';
    document.getElementById('post-title-input').value = '';
    document.getElementById('post-tags-input').value = '';

    document.getElementById('publish-btn').textContent = "Bake to Repository";
    document.getElementById('cancel-edit-btn').classList.add('hidden');
    document.getElementById('delete-post-btn').classList.add('hidden'); 
    if (activeImage) activeImage.classList.remove('editor-selected-img');
    activeImage = null;
    if (imageTools) imageTools.classList.add('hidden');
}

document.getElementById('publish-btn')?.addEventListener('click', async () => {
    if (activeImage) activeImage.classList.remove('editor-selected-img');
    
    const titleInput = document.getElementById('post-title-input').value.trim();
    const tagsInput = document.getElementById('post-tags-input').value.trim();
    const editorHtml = editorDiv ? editorDiv.innerHTML : '';
    
    if (!editorHtml.trim() || editorHtml === '<br>') return alert("Post is empty!");

    let finalTitle = titleInput;
    if (!finalTitle) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = editorHtml;
        const textOnly = tempDiv.textContent || tempDiv.innerText || "";
        finalTitle = textOnly.substring(0, 60);
        if (textOnly.length > 60) finalTitle += "...";
    }

    const finalTags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(t => t.length > 0) : [];

    let postData, fileName, message, sha;

    if (editingPostId) {
        postData = {
            id: editingPostId,
            timestamp: editingPostMeta.timestamp, 
            title: finalTitle,
            tags: finalTags,
            content: editorHtml,
            likes: editingPostMeta.likes
        };
        fileName = editingPostPath;
        message = `Update Post: ${editingPostId}`;
        sha = editingPostSha;
    } else {
        const timeStampId = getUTCString();
        postData = {
            id: `post${timeStampId}`,
            timestamp: new Date().toISOString(),
            title: finalTitle,
            tags: finalTags,
            content: editorHtml,
            likes: []
        };
        fileName = `posts/post${timeStampId}.json`;
        message = `New Post: ${timeStampId}`;
        sha = null;
    }

    await pushToGitHub(fileName, JSON.stringify(postData, null, 2), message, sha);
    alert(editingPostId ? "Post updated successfully!" : "Post baked to GitHub successfully!");
    location.reload();
});

const deleteModal = document.getElementById('delete-confirm-modal');
let pendingDeletePost = null;

document.getElementById('delete-post-btn')?.addEventListener('click', () => {
    if (!isAdmin || !editingPostId || !editingPostSha || !editingPostPath) return;
    pendingDeletePost = {
        id: editingPostId,
        sha: editingPostSha,
        path: editingPostPath,
        content: editorDiv ? editorDiv.innerHTML : ''
    };
    if (deleteModal) deleteModal.classList.remove('hidden');
});

window.requestPostDeleteFromManager = function(id) {
    const post = loadedPosts.find(p => p.id === id);
    if (!isAdmin || !post) return;
    pendingDeletePost = {
        id: post.id,
        sha: post.sha,
        path: post.path,
        content: post.content || ''
    };
    if (deleteModal) deleteModal.classList.remove('hidden');
}

document.getElementById('confirm-delete-no')?.addEventListener('click', () => {
    pendingDeletePost = null;
    if (deleteModal) deleteModal.classList.add('hidden');
});

document.getElementById('confirm-delete-yes')?.addEventListener('click', async () => {
    if (!pendingDeletePost) return;

    const yesBtn = document.getElementById('confirm-delete-yes');
    const originalText = yesBtn.textContent;
    yesBtn.textContent = "Deleting...";
    yesBtn.disabled = true;

    try {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = pendingDeletePost.content;
        const images = tempDiv.querySelectorAll('img');

        for (const img of images) {
            const src = img.getAttribute('src');
            if (src && src.includes('githubusercontent') && src.includes(CONFIG.GITHUB_REPO)) {
                const urlParts = src.split('/');
                const fileName = urlParts[urlParts.length - 1];
                const imagePath = `images/${fileName}`;

                const fileData = await fetchFromGitHub(imagePath);
                if (fileData && fileData.sha) {
                    await deleteFromGitHub(imagePath, fileData.sha, `Delete orphaned image: ${fileName}`);
                }
            }
        }

        await deleteFromGitHub(pendingDeletePost.path, pendingDeletePost.sha, `Delete post: ${pendingDeletePost.id}`);
        await supabaseClient.from('temp_likes').delete().eq('post_id', pendingDeletePost.id);

        alert("Post and associated images were successfully deleted.");
        location.reload();
    } catch (error) {
        console.error("Deletion failed:", error);
        alert("Failed to delete completely. Check the console for details.");
        yesBtn.textContent = originalText;
        yesBtn.disabled = false;
        if (deleteModal) deleteModal.classList.add('hidden');
    }
});