const CONFIG = {
    SUPABASE_URL: 'https://YOUR_PROJECT_ID.supabase.co',
    SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',
    GITHUB_OWNER: 'your-github-username',
    GITHUB_REPO: 'your-repo-name',
    ADMIN_GITHUB_HANDLE: 'your-github-username' // Only this user gets Admin rights
};

const supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);