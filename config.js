const CONFIG = {
    SUPABASE_URL: 'https://qrxblzxkmvxqapggnrnz.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_5rzGVy35azTKH1LmrWscew_rOPdoLbN',
    GITHUB_OWNER: 'boooopsy',
    GITHUB_REPO: 'boooopsy',
    ADMIN_GITHUB_HANDLE: 'boooopsy' // Only this user gets Admin rights
};

const supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);