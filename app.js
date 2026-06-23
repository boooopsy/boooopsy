// ====== UTILS & TIMEZONES ======
function getUTCString() {
    const d = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    return `${pad(d.getUTCDate())}${pad(d.getUTCMonth() + 1)}${d.getUTCFullYear()}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

function formatDisplayDate(utcDateStr) {
    const d = new Date(utcDateStr);
    return `${d.getUTCDate()} ${d.toLocaleString('default', { month: 'short' })}, ${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')} UTC`;
}

// ====== GLOBAL STATE ======
let currentUser = null;
let isAdmin = false;
let githubPAT = sessionStorage.getItem('github_pat');
let loadedPosts = [];

function showFeedMessage(message) {
    const feed = document.getElementById('feed');
    const loadingSpinner = document.getElementById('loading-spinner');

    if (loadingSpinner) loadingSpinner.classList.add('hidden');
    feed.insertAdjacentHTML('beforeend', `<p class="feed-message">${message}</p>`);
}

// ====== AUTHENTICATION ======
document.addEventListener('DOMContentLoaded', async () => {
    // Reveal Admin Login Shortcut (Ctrl+Shift+A)
    document.addEventListener('keydown', (e) => { if (e.ctrlKey && e.shiftKey && e.key === 'A') document.getElementById('login-gh-btn').classList.remove('hidden'); });

    // Auth Listeners
    document.getElementById('login-x-btn').addEventListener('click', () => supabase.auth.signInWithOAuth({ provider: 'twitter' }));
    document.getElementById('login-gh-btn').addEventListener('click', () => supabase.auth.signInWithOAuth({ provider: 'github' }));
    document.getElementById('logout-btn').addEventListener('click', async () => { await supabase.auth.signOut(); sessionStorage.removeItem('github_pat'); window.location.reload(); });
    
    // Theme logic
    const themeBtn = document.getElementById('theme-toggle');
    if(localStorage.getItem('theme') === 'dark') { document.body.setAttribute('data-theme', 'dark'); themeBtn.textContent = '☀️'; }
    themeBtn.addEventListener('click', () => {
        if(document.body.getAttribute('data-theme') === 'dark') { document.body.removeAttribute('data-theme'); localStorage.setItem('theme', 'light'); themeBtn.textContent = '🌙'; }
        else { document.body.setAttribute('data-theme', 'dark'); localStorage.setItem('theme', 'dark'); themeBtn.textContent = '☀️'; }
    });

    try {
        const { data: { session } } = await supabase.auth.getSession();
        currentUser = session?.user;

        if (currentUser) {
            document.getElementById('logout-btn').classList.remove('hidden');
            document.getElementById('login-x-btn').classList.add('hidden');

            if (currentUser.app_metadata.provider === 'github' && currentUser.user_metadata.user_name === CONFIG.ADMIN_GITHUB_HANDLE) {
                isAdmin = true;
                document.getElementById('admin-fab').classList.remove('hidden');
                if (!githubPAT) {
                    githubPAT = prompt("ADMIN: Enter your GitHub Personal Access Token (PAT) for Repo Write Access:");
                    if (githubPAT) sessionStorage.setItem('github_pat', githubPAT);
                }
                fetchPendingComments();
            }
        }
    } catch (error) {
        console.error('Supabase auth failed:', error);
    } finally {
        loadFeed();
    }
});

// ====== GITHUB API INTERFACE ======
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

// ====== CONTENT GENERATION & FEED ======
async function loadFeed() {
    try {
        // In a real static site, you'd fetch an index.json manifest. For this client-side CMS, we fetch the repo tree.
        const res = await fetch(`https://api.github.com/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/contents/posts`);
        document.getElementById('loading-spinner').classList.add('hidden');

        if (!res.ok) {
            showFeedMessage("No posts folder was found yet. Create /posts in your GitHub repo, then publish your first post from admin mode.");
            return;
        }

        const files = await res.json();

        // Sort descending by name (postDDMMYYYYHHMM)
        files.sort((a, b) => b.name.localeCompare(a.name));

        // Fetch active temp likes from Supabase
        const { data: tempLikes } = await supabase.from('temp_likes').select('post_id, user_handle');

        const feed = document.getElementById('feed');
        let renderedPosts = 0;

        for (const file of files) {
            if (!file.name.endsWith('.json')) continue;

            const rawRes = await fetch(file.download_url);
            const post = await rawRes.json();
            loadedPosts.push({ sha: file.sha, path: file.path, ...post }); // Keep ref for editing

            // Merge baked likes + temp likes
            const postTempLikes = tempLikes ? tempLikes.filter(l => l.post_id === post.id).map(l => l.user_handle) : [];
            const allLikes = [...new Set([...(post.likes || []), ...postTempLikes])];

            const card = document.createElement('article');
            card.className = 'blog-card';
            card.id = post.id;

            // Generate Likers Tooltip
            let likersHTML = allLikes.length > 0
                ? `<div class="likers-tooltip">` + allLikes.map(h => `<a href="https://x.com/${h}" target="_blank">@${h}</a>`).join('') + `</div>`
                : '';

            // Generate Comments
            let commentsHTML = '';
            if (post.comments && post.comments.length > 0) {
                commentsHTML = `<div class="comments-section" id="comments-${post.id}">`;
                post.comments.forEach((c, index) => {
                    const hiddenClass = index > 0 ? 'comment-hidden' : '';
                    commentsHTML += `
                        <div class="comment ${hiddenClass}">
                            <img src="${c.user_avatar || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png'}" />
                            <div class="comment-body">
                                <div class="comment-meta"><a href="https://x.com/${c.user_handle}" target="_blank">@${c.user_handle}</a> &bull; ${formatDisplayDate(c.timestamp)}</div>
                                <div class="comment-text">${c.text}</div>
                            </div>
                        </div>`;
                });
                if (post.comments.length > 1) {
                    commentsHTML += `<button class="expand-comments" onclick="document.getElementById('comments-${post.id}').classList.toggle('expanded')">Read ${post.comments.length - 1} more comments...</button>`;
                }
                commentsHTML += `</div>`;
            }

            // Add logic for users to leave a comment
            const commentInputHTML = currentUser && currentUser.app_metadata.provider === 'twitter'
                ? `<div style="margin-top:1rem; display:flex; gap:10px;">
                    <input type="text" id="input-${post.id}" placeholder="Write a reply..." style="flex:1; padding:8px; border-radius:6px; border:1px solid var(--border);">
                    <button onclick="submitTempComment('${post.id}')" class="auth-btn x-btn">Reply</button>
                   </div>`
                : `<p style="font-size:0.8rem; color:var(--text-muted);">Log in with X to comment.</p>`;

            card.innerHTML = `
                <div class="blog-meta">${formatDisplayDate(post.timestamp)}</div>
                <div class="blog-content">${post.content}</div>
                <div class="card-actions">
                    <button class="action-btn" onclick="toggleLike('${post.id}')">❤️ ${allLikes.length} ${likersHTML}</button>
                    <button class="action-btn" onclick="sharePost('${post.id}')">🔗 Share</button>
                </div>
                ${commentsHTML}
                ${commentInputHTML}
            `;
            feed.appendChild(card);
            renderedPosts++;
        }

        if (renderedPosts === 0) {
            showFeedMessage("No posts yet. Use admin mode to bake your first post to the repository.");
        }
    } catch (error) {
        console.error('Feed loading failed:', error);
        showFeedMessage("The feed could not be loaded. Check your GitHub repo name, /posts folder, and browser console.");
    }
}

// ====== USER INTERACTIONS ======
async function toggleLike(postId) {
    if (!currentUser || currentUser.app_metadata.provider !== 'twitter') return alert("Please log in with X to like posts.");
    const handle = currentUser.user_metadata.user_name;
    
    // We only write to Supabase. Baking happens later.
    await supabase.from('temp_likes').insert([{ post_id: postId, user_handle: handle }]);
    location.reload(); // Simple refresh to show updated state
}

async function submitTempComment(postId) {
    const text = document.getElementById(`input-${postId}`).value;
    if (!text) return;
    
    await supabase.from('temp_comments').insert([{
        post_id: postId,
        user_handle: currentUser.user_metadata.user_name,
        user_avatar: currentUser.user_metadata.avatar_url,
        comment_text: text,
        created_at: new Date().toISOString()
    }]);
    
    alert("Comment submitted for Admin review!");
    document.getElementById(`input-${postId}`).value = '';
}

function sharePost(id) {
    const url = `${window.location.href.split('#')[0]}#${id}`;
    if (navigator.share) { navigator.share({ title: 'The Daily Thread', url: url }); } 
    else { navigator.clipboard.writeText(url); alert('Link copied!'); }
}

// ====== ADMIN CMS CONTROLS ======
const adminModal = document.getElementById('admin-modal');
document.getElementById('admin-fab')?.addEventListener('click', () => adminModal.classList.remove('hidden'));
document.getElementById('close-modal')?.addEventListener('click', () => adminModal.classList.add('hidden'));

// Modal Tabs
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
        document.querySelectorAll('.tab, .tab-content').forEach(el => el.classList.remove('active', 'hidden'));
        document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
        e.target.classList.add('active');
        document.getElementById(e.target.dataset.target).classList.remove('hidden');
    });
});

// Image Compression & GitHub Upload
document.getElementById('image-upload')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // 1. Compress Image via Canvas
    const reader = new FileReader();
    reader.onload = event => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = async () => {
            const canvas = document.createElement('canvas');
            const maxW = 800;
            let [w, h] = [img.width, img.height];
            if (w > maxW) { h = Math.round((h * maxW) / w); w = maxW; }
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            
            // Get Base64 without the prefix
            const base64Full = canvas.toDataURL('image/webp', 0.8);
            const base64Raw = base64Full.split(',')[1];
            
            // 2. Push immediately to GitHub Images Folder
            const imgName = `img${getUTCString()}.webp`;
            document.getElementById('editor').innerHTML += `<p><em>Uploading image...</em></p>`;
            
            const res = await pushToGitHub(`images/${imgName}`, base64Raw, 'Upload Image via CMS', null, true);
            
            // 3. Insert raw.githubusercontent link to Editor
            if (res.content) {
                const imgUrl = res.content.download_url;
                document.execCommand('insertHTML', false, `<img src="${imgUrl}" alt="Log Image" />`);
            }
        };
    };
    reader.readAsDataURL(file);
});

// Publish Post
document.getElementById('publish-btn')?.addEventListener('click', async () => {
    const editorHtml = document.getElementById('editor').innerHTML;
    if (!editorHtml) return;

    const timeStampId = getUTCString();
    const postData = {
        id: `post${timeStampId}`,
        timestamp: new Date().toISOString(),
        content: editorHtml,
        likes: [],
        comments: []
    };

    const fileName = `posts/post${timeStampId}.json`;
    await pushToGitHub(fileName, JSON.stringify(postData, null, 2), `New Post: ${timeStampId}`);
    
    alert("Post baked to GitHub successfully!");
    location.reload();
});

// Review & Approve Comments
async function fetchPendingComments() {
    const { data, error } = await supabase.from('temp_comments').select('*');
    if (data && data.length > 0) {
        document.getElementById('badge').textContent = data.length;
        document.getElementById('badge').classList.remove('hidden');
        
        const queue = document.getElementById('pending-queue');
        queue.innerHTML = data.map(c => `
            <div class="queue-item" id="queue-${c.id}">
                <p><strong>@${c.user_handle}</strong> on Post: <code>${c.post_id}</code></p>
                <p>"${c.comment_text}"</p>
                <button class="auth-btn gh-btn" onclick="approveComment(${c.id}, '${c.post_id}')">Approve & Bake</button>
                <button class="auth-btn" style="background:red" onclick="rejectComment(${c.id})">Reject</button>
            </div>
        `).join('');
    }
}

// Global functions for inline HTML calls
window.approveComment = async function(commentId, postId) {
    // 1. Fetch temp comment data
    const { data: tempC } = await supabase.from('temp_comments').select('*').eq('id', commentId).single();
    
    // 2. Find the post file in GitHub
    const postObj = loadedPosts.find(p => p.id === postId);
    if (!postObj) return alert("Post data not loaded. Please refresh.");

    // 3. Append comment
    postObj.comments.push({
        user_handle: tempC.user_handle,
        user_avatar: tempC.user_avatar,
        text: tempC.comment_text,
        timestamp: tempC.created_at
    });

    // 4. Update file in GitHub (using the SHA to overwrite)
    const { sha, path, ...cleanPostData } = postObj; // Remove meta before saving
    await pushToGitHub(postObj.path, JSON.stringify(cleanPostData, null, 2), `Approve comment on ${postId}`, postObj.sha);

    // 5. Delete from Supabase
    await supabase.from('temp_comments').delete().eq('id', commentId);
    document.getElementById(`queue-${commentId}`).remove();
    alert("Comment baked into repository.");
}

window.rejectComment = async function(commentId) {
    await supabase.from('temp_comments').delete().eq('id', commentId);
    document.getElementById(`queue-${commentId}`).remove();
}
