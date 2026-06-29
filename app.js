// --- Application State ---
let state = {
  companies: [],
  selectedCompany: null,
  selectedFileKey: 'thirty_days', // default
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

// --- Timeframe Mapping & Configurations ---
const TIMEFRAME_LABELS = {
  thirty_days: '30 Days',
  three_months: '3 Months',
  six_months: '6 Months',
  more_than_six_months: '6+ Months',
  all: 'All Time'
};

const TIMEFRAME_ORDER = ['thirty_days', 'three_months', 'six_months', 'more_than_six_months', 'all'];

// Helper to get first available timeframe based on sorted order
function getFirstAvailableTimeframe(company) {
  for (const key of TIMEFRAME_ORDER) {
    if (company.files[key]) {
      return key;
    }
  }
  return Object.keys(company.files)[0];
}

// SVG Circle circumference config: 2 * PI * r (r=34) = ~213.6
const CIRCUMFERENCE = 213.628;

// --- DOM Element References ---
const sidebar = document.getElementById('sidebar');
const menuToggle = document.getElementById('menu-toggle');
const themeToggle = document.getElementById('theme-toggle');
const moonIcon = document.querySelector('.moon-icon');
const sunIcon = document.querySelector('.sun-icon');

const companySearch = document.getElementById('company-search');
const companyList = document.getElementById('company-list');
const companyCount = document.getElementById('company-count');

const activeCompanyName = document.getElementById('active-company-name');
const timeframeTabs = document.getElementById('timeframe-tabs');
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

async function handleLogout() {
  try {
    await apiRequest('/api/auth/logout', 'POST');
  } catch (err) {
    console.error('Logout request failed:', err);
  }
  
  // Clear state & storage
  state.user = null;
  state.solvedSet.clear();
  localStorage.removeItem('lc_auth_token');
  localStorage.removeItem('lc_username');
  
  // Hide profile
  userProfile.style.display = 'none';
  
  // Reset UI list and display login
  questionsList.innerHTML = `<div class="loading-state">Please log in to begin tracking.</div>`;
  showAuthScreen('login');
}

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
  if (savedTheme === 'light') {
    document.body.classList.remove('dark-theme');
    document.body.classList.add('light-theme');
    moonIcon.style.display = 'none';
    sunIcon.style.display = 'block';
  } else {
    document.body.classList.add('dark-theme');
    document.body.classList.remove('light-theme');
    moonIcon.style.display = 'block';
    sunIcon.style.display = 'none';
  }
}

themeToggle.addEventListener('click', () => {
  const isDark = document.body.classList.contains('dark-theme');
  if (isDark) {
    document.body.classList.remove('dark-theme');
    document.body.classList.add('light-theme');
    localStorage.setItem('lc_theme', 'light');
    moonIcon.style.display = 'none';
    sunIcon.style.display = 'block';
  } else {
    document.body.classList.add('dark-theme');
    document.body.classList.remove('light-theme');
    localStorage.setItem('lc_theme', 'dark');
    moonIcon.style.display = 'block';
    sunIcon.style.display = 'none';
  }
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
      const savedTimeframe = localStorage.getItem('lc_selected_timeframe');
      const initialTimeframe = (savedTimeframe && initialCompany.files[savedTimeframe]) ? savedTimeframe : getFirstAvailableTimeframe(initialCompany);
      selectCompany(initialCompany, initialTimeframe);
    }
  } catch (error) {
    console.error('Error fetching metadata:', error);
    companyList.innerHTML = `<div class="loading-state" style="color: var(--hard-color)">Failed to load companies list. Please make sure the server.py is running.</div>`;
  }
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
    
    // Count total files/categories available
    const filesCount = Object.keys(company.files).length;
    
    item.innerHTML = `
      <span class="company-name">${company.name}</span>
      <span class="badge">${filesCount}</span>
    `;
    
    item.addEventListener('click', () => {
      if (window.innerWidth <= 1024) {
        sidebar.classList.remove('open');
      }
      const nextTimeframe = company.files[state.selectedFileKey] ? state.selectedFileKey : getFirstAvailableTimeframe(company);
      selectCompany(company, nextTimeframe);
    });
    
    companyList.appendChild(item);
  });
}

companySearch.addEventListener('input', renderCompanyList);

// --- Core Logic: Select Company & Fetch CSV ---
async function selectCompany(company, fileKey) {
  state.selectedCompany = company;
  state.selectedFileKey = fileKey;
  
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
  localStorage.setItem('lc_selected_timeframe', fileKey);
  
  activeCompanyName.textContent = company.name;
  
  // Render timeframe selector tabs
  renderTimeframeTabs(company);
  
  // Load questions CSV
  await loadQuestionsData(company, fileKey);
}

function renderTimeframeTabs(company) {
  timeframeTabs.innerHTML = '';
  
  // Sort the keys based on the desired TIMEFRAME_ORDER
  const sortedKeys = Object.keys(company.files).sort((a, b) => {
    let indexA = TIMEFRAME_ORDER.indexOf(a);
    let indexB = TIMEFRAME_ORDER.indexOf(b);
    if (indexA === -1) indexA = 999;
    if (indexB === -1) indexB = 999;
    return indexA - indexB;
  });

  sortedKeys.forEach(key => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn';
    if (key === state.selectedFileKey) {
      btn.classList.add('active');
    }
    btn.textContent = TIMEFRAME_LABELS[key] || key;
    btn.addEventListener('click', () => {
      selectCompany(company, key);
    });
    timeframeTabs.appendChild(btn);
  });
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
  if (state.questions.length === 0) {
    progressText.textContent = '0 / 0 Solved';
    progressPercent.textContent = '0%';
    progressBar.style.strokeDashoffset = CIRCUMFERENCE;
    return;
  }
  
  let solvedCount = 0;
  state.questions.forEach(q => {
    if (state.solvedSet.has(q.link)) {
      solvedCount++;
    }
  });
  
  const total = state.questions.length;
  const percent = Math.round((solvedCount / total) * 100);
  
  progressText.textContent = `${solvedCount} / ${total} Solved`;
  progressPercent.textContent = `${percent}%`;
  
  const offset = CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE;
  progressBar.style.strokeDashoffset = offset;
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
      <div class="col-frequency freq-container">
        <div class="freq-track" title="Frequency: ${q.frequency.toFixed(1)}%">
          <div class="freq-fill" style="width: ${Math.min(q.frequency, 100)}%"></div>
        </div>
      </div>
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
});
