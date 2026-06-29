// --- Application State ---
let state = {
  companies: [],
  selectedCompany: null,
  selectedFileKey: 'all', // default
  questions: [],
  filters: {
    search: '',
    difficulty: 'all'
  },
  sortBy: 'frequency',
  
  // Auth state
  user: null, // { username, token }
  solvedSet: new Set() // Set of solved question links
};

// SVG Circle circumference config: 2 * PI * r (r=34) = ~213.6
const CIRCUMFERENCE = 213.628;

// --- DOM Element References ---
const sidebar = document.getElementById('sidebar');
const menuToggle = document.getElementById('menu-toggle');

// Drawer elements
const drawerOverlay = document.getElementById('drawer-overlay');
const profileDrawer = document.getElementById('profile-drawer');
const closeDrawerBtn = document.getElementById('close-drawer-btn');
const drawerUsernameDisplay = document.getElementById('drawer-username-display');
const themeToggle = document.getElementById('theme-toggle');
const moonIcon = document.querySelector('.moon-icon');
const sunIcon = document.querySelector('.sun-icon');

const companySearch = document.getElementById('company-search');
const companyList = document.getElementById('company-list');
const companyCount = document.getElementById('company-count');

const activeCompanyName = document.getElementById('active-company-name');
const progressText = document.getElementById('progress-text');
const progressPercent = document.getElementById('progress-percent');
const progressBar = document.querySelector('.progress-bar');

const questionSearch = document.getElementById('question-search');
const difficultyFilters = document.getElementById('difficulty-filters');
const sortSelect = document.getElementById('sort-select');
const questionsList = document.getElementById('questions-list');
const resetGlobalBtn = document.getElementById('reset-global-btn');

// --- Auth DOM Elements ---
const authOverlay = document.getElementById('auth-overlay');
const authErrorBox = document.getElementById('auth-error-box');
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const forgotForm = document.getElementById('forgot-form');

const toForgotBtn = document.getElementById('to-forgot-btn');
const toSignupBtn = document.getElementById('to-signup-btn');
const toLoginBtns = document.querySelectorAll('.to-login-btn');

const userProfile = document.getElementById('user-profile');
const profileUsername = document.getElementById('profile-username');
const logoutBtn = document.getElementById('logout-btn');

// --- Helper: Robust CSV Parser ---
function parseCSV(text) {
  const lines = [];
  let row = [""];
  let insideQuote = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuote && nextChar === '"') {
        // Escaped double quote
        row[row.length - 1] += '"';
        i++;
      } else {
        // Toggle quote state
        insideQuote = !insideQuote;
      }
    } else if (char === ',' && !insideQuote) {
      row.push("");
    } else if ((char === '\r' || char === '\n') && !insideQuote) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      lines.push(row);
      row = [""];
    } else {
      row[row.length - 1] += char;
    }
  }
  if (row.length > 1 || row[0] !== "") {
    lines.push(row);
  }
  return lines;
}

// --- Helper: Format Acceptance Rate ---
function formatAcceptance(rateStr) {
  if (!rateStr) return '0.0%';
  const val = parseFloat(rateStr);
  if (isNaN(val)) return rateStr;
  if (val <= 1.0) {
    return (val * 100).toFixed(1) + '%';
  }
  return val.toFixed(1) + '%';
}

// --- Helper: Format Frequency ---
function formatFrequency(freqStr) {
  if (!freqStr) return 0;
  const val = parseFloat(freqStr);
  return isNaN(val) ? 0 : val;
}

// --- API Request Wrapper ---
async function apiRequest(url, method = 'GET', body = null) {
  const headers = {
    'Content-Type': 'application/json'
  };
  if (state.user && state.user.token) {
    headers['Authorization'] = `Bearer ${state.user.token}`;
  }

  const config = {
    method,
    headers
  };
  if (body) {
    config.body = JSON.stringify(body);
  }

  const response = await fetch(url, config);
  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401) {
      handleLogoutLocal();
    }
    throw new Error(data.error || 'API Request failed');
  }
  return data;
}

// --- Auth UI Management ---
function showAuthScreen(screen) {
  // Hide all forms
  loginForm.style.display = 'none';
  signupForm.style.display = 'none';
  forgotForm.style.display = 'none';
  
  // Clear error box
  authErrorBox.style.display = 'none';
  authErrorBox.textContent = '';
  
  // Show target form
  if (screen === 'login') {
    loginForm.style.display = 'block';
    document.getElementById('auth-subtitle').textContent = 'Log in to sync your progress across devices';
  } else if (screen === 'signup') {
    signupForm.style.display = 'block';
    document.getElementById('auth-subtitle').textContent = 'Create an account to start tracking';
  } else if (screen === 'forgot') {
    forgotForm.style.display = 'block';
    document.getElementById('auth-subtitle').textContent = 'Reset password using your registered phone number';
  }
  
  authOverlay.style.display = 'flex';
}

function hideAuthOverlay() {
  authOverlay.style.display = 'none';
}

function showError(message) {
  authErrorBox.textContent = message;
  authErrorBox.style.display = 'block';
}

// --- Auth Operations ---
async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  
  try {
    const data = await apiRequest('/api/auth/login', 'POST', { username, password });
    loginUser(data.username, data.token);
  } catch (err) {
    showError(err.message);
  }
}

async function handleSignUp(e) {
  e.preventDefault();
  const username = document.getElementById('signup-username').value.trim();
  const password = document.getElementById('signup-password').value;
  const phone = document.getElementById('signup-phone').value.trim();
  
  try {
    const data = await apiRequest('/api/auth/signup', 'POST', { username, password, phone });
    loginUser(data.username, data.token);
  } catch (err) {
    showError(err.message);
  }
}

async function handleReset(e) {
  e.preventDefault();
  const username = document.getElementById('forgot-username').value.trim();
  const phone = document.getElementById('forgot-phone').value.trim();
  const new_password = document.getElementById('forgot-new-password').value;
  
  try {
    const data = await apiRequest('/api/auth/reset', 'POST', { username, phone, new_password });
    alert(data.message);
    showAuthScreen('login');
  } catch (err) {
    showError(err.message);
  }
}

function loginUser(username, token) {
  state.user = { username, token };
  localStorage.setItem('lc_auth_token', token);
  localStorage.setItem('lc_username', username);
  
  // Show user profile in sidebar
  profileUsername.textContent = username;
  userProfile.style.display = 'flex';
  
  hideAuthOverlay();
  
  // Load user data
  syncUserProgress().then(() => {
    fetchMetadata();
  });
}

function handleLogoutLocal() {
  state.user = null;
  state.solvedSet.clear();
  localStorage.removeItem('lc_auth_token');
  localStorage.removeItem('lc_username');
  
  // Hide profile
  userProfile.style.display = 'none';
  
  // Close drawer if open
  closeDrawer();
  
  // Reset UI list and display login
  questionsList.innerHTML = `<div class="loading-state">Please log in to begin tracking.</div>`;
  showAuthScreen('login');
}

async function handleLogout() {
  try {
    await apiRequest('/api/auth/logout', 'POST');
  } catch (err) {
    console.error('Logout request failed:', err);
  }
  handleLogoutLocal();
}

// --- Settings Drawer UI Control ---
function openDrawer() {
  if (state.user) {
    drawerUsernameDisplay.textContent = state.user.username;
  }
  drawerOverlay.classList.add('open');
  profileDrawer.classList.add('open');
}

function closeDrawer() {
  drawerOverlay.classList.remove('open');
  profileDrawer.classList.remove('open');
}

userProfile.addEventListener('click', openDrawer);
closeDrawerBtn.addEventListener('click', closeDrawer);
drawerOverlay.addEventListener('click', closeDrawer);

async function syncUserProgress() {
  try {
    const data = await apiRequest('/api/progress');
    state.solvedSet = new Set(data.solved);
  } catch (err) {
    console.error('Failed to sync progress:', err);
  }
}

// Bind Authentication Forms Event Listeners
loginForm.addEventListener('submit', handleLogin);
signupForm.addEventListener('submit', handleSignUp);
forgotForm.addEventListener('submit', handleReset);
logoutBtn.addEventListener('click', handleLogout);

toForgotBtn.addEventListener('click', (e) => { e.preventDefault(); showAuthScreen('forgot'); });
toSignupBtn.addEventListener('click', (e) => { e.preventDefault(); showAuthScreen('signup'); });
toLoginBtns.forEach(btn => {
  btn.addEventListener('click', (e) => { e.preventDefault(); showAuthScreen('login'); });
});

// --- Core Logic: Theme Toggle ---
function initTheme() {
  const savedTheme = localStorage.getItem('lc_theme') || 'dark';
  const themeModeText = document.getElementById('theme-mode-text');
  if (savedTheme === 'light') {
    document.body.classList.remove('dark-theme');
    document.body.classList.add('light-theme');
    moonIcon.style.display = 'none';
    sunIcon.style.display = 'block';
    if (themeModeText) themeModeText.textContent = 'Light Mode';
  } else {
    document.body.classList.add('dark-theme');
    document.body.classList.remove('light-theme');
    moonIcon.style.display = 'block';
    sunIcon.style.display = 'none';
    if (themeModeText) themeModeText.textContent = 'Dark Mode';
  }
}

themeToggle.addEventListener('click', () => {
  const isDark = document.body.classList.contains('dark-theme');
  const themeModeText = document.getElementById('theme-mode-text');
  if (isDark) {
    document.body.classList.remove('dark-theme');
    document.body.classList.add('light-theme');
    localStorage.setItem('lc_theme', 'light');
    moonIcon.style.display = 'none';
    sunIcon.style.display = 'block';
    if (themeModeText) themeModeText.textContent = 'Light Mode';
  } else {
    document.body.classList.add('dark-theme');
    document.body.classList.remove('light-theme');
    localStorage.setItem('lc_theme', 'dark');
    moonIcon.style.display = 'block';
    sunIcon.style.display = 'none';
    if (themeModeText) themeModeText.textContent = 'Dark Mode';
  }
  // Re-render chart with correct theme colors
  setTimeout(refreshChartTheme, 50);
});

// --- Core Logic: Mobile Sidebar Toggle ---
menuToggle.addEventListener('click', () => {
  sidebar.classList.toggle('open');
});

// Close sidebar on item click for mobile
document.addEventListener('click', (e) => {
  if (window.innerWidth <= 1024 && !sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
    sidebar.classList.remove('open');
  }
});

// --- Core Logic: Fetch metadata ---
async function fetchMetadata() {
  try {
    const response = await fetch('metadata.json');
    if (!response.ok) throw new Error('Failed to fetch metadata');
    const data = await response.json();
    state.companies = data.companies;
    renderCompanyList();
    
    // Restore previous session company if available, else select the first one
    const savedCompany = localStorage.getItem('lc_selected_company');
    const initialCompany = state.companies.find(c => c.name === savedCompany) || state.companies[0];
    
    if (initialCompany) {
      selectCompany(initialCompany);
    }
  } catch (error) {
    console.error('Error fetching metadata:', error);
    companyList.innerHTML = `<div class="loading-state" style="color: var(--hard-color)">Failed to load companies list. Please make sure the server.py is running.</div>`;
  }
}

// --- Colored Avatar Helper ---
const AVATAR_PALETTE = [
  { bg: 'rgba(239,68,68,0.18)',   color: '#EF4444' },
  { bg: 'rgba(249,115,22,0.18)',  color: '#F97316' },
  { bg: 'rgba(234,179,8,0.18)',   color: '#EAB308' },
  { bg: 'rgba(34,197,94,0.18)',   color: '#22C55E' },
  { bg: 'rgba(6,182,212,0.18)',   color: '#06B6D4' },
  { bg: 'rgba(99,102,241,0.18)',  color: '#6366F1' },
  { bg: 'rgba(168,85,247,0.18)',  color: '#A855F7' },
  { bg: 'rgba(236,72,153,0.18)', color: '#EC4899' },
];

function getAvatarStyle(name) {
  const idx = name.charCodeAt(0) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[idx];
}

// --- Core Logic: Render Company List in Sidebar ---
function renderCompanyList() {
  const query = companySearch.value.trim().toLowerCase();
  
  const filtered = state.companies.filter(c => {
    return c.name.toLowerCase().includes(query);
  });
  
  companyCount.textContent = filtered.length;
  
  if (filtered.length === 0) {
    companyList.innerHTML = `<div class="empty-state">No matching companies</div>`;
    return;
  }
  
  companyList.innerHTML = '';
  filtered.forEach(company => {
    const item = document.createElement('button');
    item.className = 'company-item';
    if (state.selectedCompany && state.selectedCompany.name === company.name) {
      item.classList.add('active');
    }
    
    const av = getAvatarStyle(company.name);
    item.innerHTML = `
      <div class="company-letter-avatar" style="background:${av.bg};color:${av.color}">${company.name.charAt(0).toUpperCase()}</div>
      <span class="company-name">${company.name}</span>
    `;
    
    item.addEventListener('click', () => {
      if (window.innerWidth <= 1024) {
        sidebar.classList.remove('open');
      }
      selectCompany(company);
    });
    
    companyList.appendChild(item);
  });
}

companySearch.addEventListener('input', renderCompanyList);

// --- Core Logic: Select Company & Fetch CSV ---
async function selectCompany(company) {
  state.selectedCompany = company;
  
  // Highlight active company in sidebar
  document.querySelectorAll('.company-item').forEach(item => {
    const nameEl = item.querySelector('.company-name');
    if (nameEl && nameEl.textContent === company.name) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
  
  // Save selection
  localStorage.setItem('lc_selected_company', company.name);
  
  activeCompanyName.textContent = company.name;
  
  // Load questions CSV (always use the 'all' key, fallback to first available if not found)
  const fileKey = company.files['all'] ? 'all' : Object.keys(company.files)[0];
  state.selectedFileKey = fileKey;
  await loadQuestionsData(company, fileKey);
}

async function loadQuestionsData(company, fileKey) {
  questionsList.innerHTML = `<div class="loading-state">Loading questions data for ${company.name}...</div>`;
  
  const csvFileName = company.files[fileKey];
  const url = `./${encodeURIComponent(company.folder)}/${encodeURIComponent(csvFileName)}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const text = await response.text();
    
    // Parse CSV
    const parsedData = parseCSV(text);
    if (parsedData.length <= 1) {
      questionsList.innerHTML = `<div class="empty-state">No questions found in this file</div>`;
      state.questions = [];
      updateProgress();
      return;
    }
    
    // Map headers to index
    const headers = parsedData[0].map(h => h.trim().toLowerCase());
    const titleIndex = headers.indexOf('title');
    const difficultyIndex = headers.indexOf('difficulty');
    const linkIndex = headers.indexOf('link');
    const frequencyIndex = headers.indexOf('frequency');
    const acceptanceIndex = headers.indexOf('acceptance rate');
    const topicsIndex = headers.indexOf('topics');
    
    const formattedQuestions = [];
    
    for (let i = 1; i < parsedData.length; i++) {
      const row = parsedData[i];
      if (row.length < 2 || !row[titleIndex]) continue;
      
      formattedQuestions.push({
        title: row[titleIndex].trim(),
        difficulty: row[difficultyIndex] ? row[difficultyIndex].trim().toUpperCase() : 'MEDIUM',
        link: row[linkIndex] ? row[linkIndex].trim() : '',
        frequency: row[frequencyIndex] ? formatFrequency(row[frequencyIndex]) : 0,
        acceptance: row[acceptanceIndex] ? formatAcceptance(row[acceptanceIndex]) : '0.0%',
        topics: row[topicsIndex] ? row[topicsIndex].split(',').map(t => t.trim()).filter(Boolean) : [],
        defaultIndex: i
      });
    }
    
    state.questions = formattedQuestions;
    
    // Apply filters and sorting
    filterAndRenderQuestions();
    
    // Update progress circle
    updateProgress();
    
  } catch (error) {
    console.error('Error loading CSV:', error);
    questionsList.innerHTML = `<div class="loading-state" style="color: var(--hard-color)">Error fetching CSV data file: ${csvFileName}. Make sure the file exists.</div>`;
    state.questions = [];
    updateProgress();
  }
}

// --- Core Logic: Update Progress Circular Bar ---
function updateProgress() {
  const heroSolvedNum = document.getElementById('hero-solved-num');
  const heroTotalNum  = document.getElementById('hero-total-num');

  if (state.questions.length === 0) {
    if (heroSolvedNum) heroSolvedNum.textContent = '0';
    if (heroTotalNum)  heroTotalNum.textContent  = '0';
    if (progressText)  progressText.textContent  = '0 / 0 Solved';
    progressPercent.textContent = '0%';
    progressBar.style.strokeDashoffset = CIRCUMFERENCE;
    return;
  }

  let solvedCount = 0;
  state.questions.forEach(q => { if (state.solvedSet.has(q.link)) solvedCount++; });

  const total   = state.questions.length;
  const percent = Math.round((solvedCount / total) * 100);

  if (heroSolvedNum) heroSolvedNum.textContent = solvedCount;
  if (heroTotalNum)  heroTotalNum.textContent  = total;
  if (progressText)  progressText.textContent  = `${solvedCount} / ${total} Solved`;
  progressPercent.textContent = `${percent}%`;

  const offset = CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE;
  progressBar.style.strokeDashoffset = offset;

  // Update analytics
  updateStatCards();
  updateCharts();
}

// --- Core Logic: Search, Filters, and Sorting ---
function filterAndRenderQuestions() {
  const searchQuery = state.filters.search.toLowerCase();
  const diffQuery = state.filters.difficulty.toUpperCase();
  
  let result = state.questions.filter(q => {
    // Search by title or topics
    const matchesSearch = q.title.toLowerCase().includes(searchQuery) || 
                          q.topics.some(t => t.toLowerCase().includes(searchQuery));
    
    // Filter by difficulty
    const matchesDiff = diffQuery === 'ALL' || q.difficulty === diffQuery;
    
    return matchesSearch && matchesDiff;
  });
  
  // Sort items
  if (state.sortBy === 'frequency') {
    result.sort((a, b) => b.frequency - a.frequency);
  } else if (state.sortBy === 'acceptance') {
    result.sort((a, b) => {
      const aVal = parseFloat(a.acceptance);
      const bVal = parseFloat(b.acceptance);
      return bVal - aVal;
    });
  } else if (state.sortBy === 'title') {
    result.sort((a, b) => a.title.localeCompare(b.title));
  } else if (state.sortBy === 'index') {
    result.sort((a, b) => a.defaultIndex - b.defaultIndex);
  }
  
  renderQuestionsList(result);
}

// Bind search and filter events
questionSearch.addEventListener('input', () => {
  state.filters.search = questionSearch.value;
  filterAndRenderQuestions();
});

difficultyFilters.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    difficultyFilters.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    state.filters.difficulty = btn.dataset.difficulty;
    filterAndRenderQuestions();
  });
});

sortSelect.addEventListener('change', () => {
  state.sortBy = sortSelect.value;
  filterAndRenderQuestions();
});

// --- Core Logic: Render Questions List DOM ---
function renderQuestionsList(questions) {
  if (questions.length === 0) {
    questionsList.innerHTML = `<div class="empty-state">No matching questions found</div>`;
    return;
  }
  
  questionsList.innerHTML = '';
  
  questions.forEach((q, idx) => {
    const isCompleted = state.solvedSet.has(q.link);
    
    const row = document.createElement('div');
    row.className = `question-row ${isCompleted ? 'completed' : ''}`;
    
    const topicsHtml = q.topics.length > 0 
      ? `<div class="topics-tags">
          ${q.topics.slice(0, 3).map(topic => `<span class="topic-tag">${topic}</span>`).join('')}
          ${q.topics.length > 3 ? `<span class="topic-tag">+${q.topics.length - 3} more</span>` : ''}
         </div>`
      : '';

    row.innerHTML = `
      <div class="col-num question-index">${idx + 1}</div>
      <div class="col-status checkbox-container">
        <div class="custom-checkbox" aria-label="Mark completed" role="checkbox" aria-checked="${isCompleted}"></div>
      </div>
      <div class="col-title title-container">
        <a href="${q.link}" target="_blank" rel="noopener noreferrer" class="question-link">${q.title}</a>
        ${topicsHtml}
      </div>
      <div class="col-difficulty">
        <span class="diff-badge ${q.difficulty.toLowerCase()}">${q.difficulty.toLowerCase()}</span>
      </div>
      <div class="col-acceptance acceptance-rate">${q.acceptance}</div>
      <div class="col-frequency freq-val">${q.frequency.toFixed(1)}%</div>
    `;
    
    const checkbox = row.querySelector('.custom-checkbox');
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleQuestionCompletion(q, row, checkbox);
    });
    
    questionsList.appendChild(row);
  });
}

async function toggleQuestionCompletion(question, rowElement, checkboxElement) {
  const currentStatus = state.solvedSet.has(question.link);
  const newStatus = !currentStatus;
  
  // Optimistic UI update
  if (newStatus) {
    state.solvedSet.add(question.link);
    rowElement.classList.add('completed');
    checkboxElement.setAttribute('aria-checked', 'true');
  } else {
    state.solvedSet.delete(question.link);
    rowElement.classList.remove('completed');
    checkboxElement.setAttribute('aria-checked', 'false');
  }
  updateProgress();

  // Track solve event for heatmap when marking as solved
  if (newStatus) { trackSolveEvent(); }

  // Send update to server database
  try {
    await apiRequest('/api/progress/toggle', 'POST', { link: question.link, solved: newStatus });
  } catch (err) {
    console.error('Failed to update progress on server:', err);
    // Revert UI on error
    if (newStatus) {
      state.solvedSet.delete(question.link);
      rowElement.classList.remove('completed');
      checkboxElement.setAttribute('aria-checked', 'false');
    } else {
      state.solvedSet.add(question.link);
      rowElement.classList.add('completed');
      checkboxElement.setAttribute('aria-checked', 'true');
    }
    updateProgress();
    alert(`Failed to save progress: ${err.message}. Please check your connection.`);
  }
}

// --- Core Logic: Reset Progress ---
resetGlobalBtn.addEventListener('click', async () => {
  const confirmReset = confirm("Are you sure you want to reset ALL your solved questions progress? This cannot be undone.");
  if (confirmReset) {
    try {
      await apiRequest('/api/progress/reset', 'POST');
      state.solvedSet.clear();
      filterAndRenderQuestions();
      updateProgress();
      alert("All progress has been reset successfully!");
    } catch (err) {
      alert(`Failed to reset progress: ${err.message}`);
    }
  }
});

// --- Initialize App ---
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  
  // Check if session token exists in localStorage
  const savedToken = localStorage.getItem('lc_auth_token');
  const savedUsername = localStorage.getItem('lc_username');
  
  if (savedToken && savedUsername) {
    state.user = { username: savedUsername, token: savedToken };
    profileUsername.textContent = savedUsername;
    userProfile.style.display = 'flex';
    
    // Sync progress first, then load metadata
    syncUserProgress().then(() => {
      fetchMetadata();
    });
  } else {
    // Show login modal immediately
    showAuthScreen('login');
  }

  // Always render heatmap on load (works without login)
  renderHeatmap();
  updateStreaks();
});

// ============================================================
// ANALYTICS MODULE
// ============================================================

// --- Stat Cards ---
function updateStatCards() {
  if (!state.questions || state.questions.length === 0) {
    ['stat-solved-val', 'stat-remaining-val', 'stat-completion-val', 'stat-readiness-val']
      .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = id.includes('val') ? '0' : '0%'; });
    return;
  }

  let solved = 0;
  state.questions.forEach(q => { if (state.solvedSet.has(q.link)) solved++; });

  const total = state.questions.length;
  const remaining = total - solved;
  const percent = total > 0 ? Math.round((solved / total) * 100) : 0;

  // Interview readiness: weighted by difficulty
  const easySolved   = state.questions.filter(q => q.difficulty === 'EASY'   && state.solvedSet.has(q.link)).length;
  const mediumSolved = state.questions.filter(q => q.difficulty === 'MEDIUM' && state.solvedSet.has(q.link)).length;
  const hardSolved   = state.questions.filter(q => q.difficulty === 'HARD'   && state.solvedSet.has(q.link)).length;
  const easyTotal    = state.questions.filter(q => q.difficulty === 'EASY').length;
  const mediumTotal  = state.questions.filter(q => q.difficulty === 'MEDIUM').length;
  const hardTotal    = state.questions.filter(q => q.difficulty === 'HARD').length;

  const easyScore   = easyTotal   > 0 ? (easySolved   / easyTotal)   * 0.20 : 0;
  const mediumScore = mediumTotal > 0 ? (mediumSolved / mediumTotal) * 0.50 : 0;
  const hardScore   = hardTotal   > 0 ? (hardSolved   / hardTotal)   * 0.30 : 0;
  const readiness = Math.round((easyScore + mediumScore + hardScore) * 100);

  animateValue('stat-solved-val',     solved);
  animateValue('stat-remaining-val',  remaining);
  setStatText('stat-completion-val',  percent + '%');
  setStatText('stat-readiness-val',   readiness + '%');
}

function animateValue(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseInt(el.textContent) || 0;
  if (start === target) return;
  const duration = 400;
  const startTime = performance.now();
  function tick(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    el.textContent = Math.round(start + (target - start) * progress);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function setStatText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// --- Difficulty Doughnut Chart ---
let difficultyChart = null;

function updateCharts() {
  if (!state.questions || state.questions.length === 0) return;
  if (typeof Chart === 'undefined') return;

  const easyCount   = state.questions.filter(q => q.difficulty === 'EASY').length;
  const mediumCount = state.questions.filter(q => q.difficulty === 'MEDIUM').length;
  const hardCount   = state.questions.filter(q => q.difficulty === 'HARD').length;

  const ctx = document.getElementById('difficulty-chart');
  if (!ctx) return;

  const isDark = document.body.classList.contains('dark-theme');
  const textColor = isDark ? '#94A3B8' : '#64748B';
  const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

  if (difficultyChart) {
    difficultyChart.data.datasets[0].data = [easyCount, mediumCount, hardCount];
    difficultyChart.options.plugins.legend.labels.color = textColor;
    difficultyChart.update('active');
    return;
  }

  difficultyChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Easy', 'Medium', 'Hard'],
      datasets: [{
        data: [easyCount, mediumCount, hardCount],
        backgroundColor: isDark
          ? ['rgba(34,197,94,0.75)', 'rgba(245,158,11,0.75)', 'rgba(239,68,68,0.75)']
          : ['#DCFCE7', '#FEF3C7', '#FEE2E2'],
        borderColor: ['#22C55E', '#F59E0B', '#EF4444'],
        borderWidth: 2,
        hoverOffset: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '68%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: textColor,
            font: { family: 'Inter', size: 11, weight: '500' },
            padding: 14,
            boxWidth: 10,
            usePointStyle: true,
            pointStyle: 'circle',
          }
        },
        tooltip: {
          backgroundColor: isDark ? '#1E293B' : '#fff',
          titleColor: isDark ? '#F8FAFC' : '#0F172A',
          bodyColor: isDark ? '#94A3B8' : '#64748B',
          borderColor: isDark ? '#334155' : '#E2E8F0',
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: (ctx) => `  ${ctx.label}: ${ctx.raw} problems`
          }
        }
      }
    }
  });
}

// Call updateCharts again after theme changes
function refreshChartTheme() {
  if (difficultyChart) {
    difficultyChart.destroy();
    difficultyChart = null;
    updateCharts();
  }
}

// --- Activity Heatmap ---
function trackSolveEvent() {
  const today = new Date().toISOString().split('T')[0];
  const raw = localStorage.getItem('lc_solve_dates') || '{}';
  const dates = JSON.parse(raw);
  dates[today] = (dates[today] || 0) + 1;
  localStorage.setItem('lc_solve_dates', JSON.stringify(dates));
  renderHeatmap();
  updateStreaks();
}

function renderHeatmap() {
  const container = document.getElementById('heatmap-container');
  if (!container) return;

  const raw = localStorage.getItem('lc_solve_dates') || '{}';
  const dates = JSON.parse(raw);

  const today = new Date();
  // Go back 52 weeks from today
  const start = new Date(today);
  start.setDate(today.getDate() - 363);
  // Align to Sunday
  start.setDate(start.getDate() - start.getDay());

  const weeks = [];
  let current = new Date(start);

  while (current <= today) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const dateStr = current.toISOString().split('T')[0];
      const count = dates[dateStr] || 0;
      let level = 0;
      if (count === 1) level = 1;
      else if (count === 2) level = 2;
      else if (count <= 4) level = 3;
      else if (count > 4) level = 4;
      week.push({ date: dateStr, count, level, future: current > today });
      current.setDate(current.getDate() + 1);
    }
    weeks.push(week);
  }

  let html = '<div class="heatmap-grid">';
  weeks.forEach(week => {
    html += '<div class="heatmap-week">';
    week.forEach(({ date, count, level, future }) => {
      const label = future ? '' : `${date}${count > 0 ? ': ' + count + ' solved' : ''}`;
      const lvl = future ? 0 : level;
      html += `<div class="heatmap-cell" data-level="${lvl}" title="${label}"></div>`;
    });
    html += '</div>';
  });
  html += '</div>';

  container.innerHTML = html;
}

function updateStreaks() {
  const raw = localStorage.getItem('lc_solve_dates') || '{}';
  const dates = Object.keys(JSON.parse(raw)).sort();

  if (dates.length === 0) {
    setStatText('current-streak', '🔥 0 day streak');
    setStatText('longest-streak', '🏆 0 best');
    return;
  }

  let currentStreak = 0;
  let longestStreak = 0;
  let streak = 1;

  // Calculate longest streak
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1]);
    const curr = new Date(dates[i]);
    const diff = (curr - prev) / (1000 * 60 * 60 * 24);
    if (diff === 1) {
      streak++;
    } else {
      longestStreak = Math.max(longestStreak, streak);
      streak = 1;
    }
  }
  longestStreak = Math.max(longestStreak, streak);

  // Calculate current streak (from today backwards)
  const todayStr = new Date().toISOString().split('T')[0];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yestStr = yesterday.toISOString().split('T')[0];

  if (dates.includes(todayStr) || dates.includes(yestStr)) {
    currentStreak = 1;
    let checkDate = new Date(dates.includes(todayStr) ? todayStr : yestStr);
    for (let i = dates.length - 2; i >= 0; i--) {
      const prev = new Date(dates[i]);
      checkDate.setDate(checkDate.getDate() - 1);
      if (dates[i] === checkDate.toISOString().split('T')[0]) {
        currentStreak++;
      } else {
        break;
      }
    }
  }

  setStatText('current-streak', `🔥 ${currentStreak} day${currentStreak !== 1 ? 's' : ''} streak`);
  setStatText('longest-streak', `🏆 ${longestStreak} best`);
}
