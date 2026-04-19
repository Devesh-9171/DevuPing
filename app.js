const state = {
  user: null,
  googleClientId: '',
  loading: false,
  googleReady: false,
};

const elements = {
  heroSection: document.getElementById('heroSection'),
  dashboardSection: document.getElementById('dashboardSection'),
  homeStartButton: document.getElementById('homeStartButton'),
  dashStartButton: document.getElementById('dashStartButton'),
  homeUrlInput: document.getElementById('homeUrlInput'),
  dashUrlInput: document.getElementById('dashUrlInput'),
  homeIntervalSelect: document.getElementById('homeIntervalSelect'),
  dashIntervalSelect: document.getElementById('dashIntervalSelect'),
  profileName: document.getElementById('profileName'),
  profileEmail: document.getElementById('profileEmail'),
  profilePicture: document.getElementById('profilePicture'),
  jobsList: document.getElementById('jobsList'),
  jobCount: document.getElementById('jobCount'),
  logoutButton: document.getElementById('logoutButton'),
  toast: document.getElementById('toast'),
};

window.onGoogleScriptLoad = () => {
  state.googleReady = true;
  if (state.googleClientId) {
    initGoogleOneTap();
  }
};

function setLoading(isLoading) {
  state.loading = isLoading;
  elements.homeStartButton.disabled = isLoading;
  elements.dashStartButton.disabled = isLoading;
}

function showToast(message, duration = 4000) {
  elements.toast.textContent = message;
  elements.toast.classList.remove('hidden');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, duration);
}

async function fetchConfig() {
  try {
    const res = await fetch('/config', { credentials: 'include' });
    if (!res.ok) {
      throw new Error('Unable to load config');
    }
    const data = await res.json();
    state.googleClientId = data.googleClientId;
    if (!state.googleClientId) {
      showToast('Google Client ID is not configured. Please add it to the backend.', 8000);
    }
    if (state.googleReady) {
      initGoogleOneTap();
    }
  } catch (error) {
    console.error(error);
    showToast('Unable to load application settings.');
  }
}

function initGoogleOneTap() {
  if (!window.google || !state.googleClientId) {
    return;
  }
  if (window.googleOneTapInitialized) {
    return;
  }

  google.accounts.id.initialize({
    client_id: state.googleClientId,
    callback: handleCredentialResponse,
    auto_select: false,
    cancel_on_tap_outside: false,
  });
  window.googleOneTapInitialized = true;
}

function requestLogin() {
  if (!state.googleClientId) {
    showToast('Google login is not configured.');
    return;
  }
  if (!window.google) {
    showToast('Google identity script has not loaded yet.');
    return;
  }
  initGoogleOneTap();
  google.accounts.id.prompt();
}

async function handleCredentialResponse(response) {
  if (!response || !response.credential) {
    showToast('Google authentication failed.');
    return;
  }
  setLoading(true);
  try {
    const res = await fetch('/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ token: response.credential }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || 'Authentication failed');
    }
    state.user = body.user;
    renderApp();
    await loadJobs();
    showToast('Signed in successfully. Welcome back!');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Login failed');
  } finally {
    setLoading(false);
  }
}

async function fetchCurrentUser() {
  try {
    const res = await fetch('/me', { credentials: 'include' });
    if (!res.ok) {
      state.user = null;
      renderApp();
      return;
    }
    const body = await res.json();
    state.user = body;
    renderApp();
    await loadJobs();
  } catch (error) {
    console.error(error);
    state.user = null;
    renderApp();
  }
}

function renderApp() {
  const loggedIn = Boolean(state.user);
  elements.dashboardSection.classList.toggle('hidden', !loggedIn);
  elements.logoutButton.classList.toggle('hidden', !loggedIn);

  if (loggedIn) {
    elements.heroSection.querySelector('.hero-copy h2').textContent = 'Welcome back, keep your services awake with DevuPing.';
    elements.profileName.textContent = state.user.name;
    elements.profileEmail.textContent = state.user.email;
    elements.profilePicture.src = state.user.picture || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(state.user.name) + '&background=2563eb&color=ffffff';
  } else {
    elements.heroSection.querySelector('.hero-copy h2').textContent = 'Keep your backend awake with automated pings.';
  }
}

function formatDate(timestamp) {
  if (!timestamp) return 'Never';
  return new Date(timestamp).toLocaleString();
}

function buildJobCard(job) {
  const container = document.createElement('div');
  container.className = 'job-item';

  const urlLabel = document.createElement('div');
  urlLabel.className = 'job-meta';
  urlLabel.innerHTML = `<strong>${job.url}</strong><span>${job.interval / 60} min interval</span>`;

  const statusText = document.createElement('span');
  statusText.className = 'job-status';
  statusText.textContent = job.status === 'running' ? 'running' : 'stopped';

  const pingInfo = document.createElement('p');
  pingInfo.className = 'job-log';
  pingInfo.textContent = `Last ping: ${formatDate(job.lastPing)}`;

  const logs = document.createElement('div');
  logs.className = 'job-log';
  logs.innerHTML = `<strong>Recent logs:</strong> ${job.logs
    .map((entry) => `${new Date(entry.time).toLocaleTimeString()} → ${entry.status}`)
    .join(' · ') || 'No pings yet.'}`;

  const actions = document.createElement('div');
  actions.className = 'job-actions';
  const stopButton = document.createElement('button');
  stopButton.className = 'ghost-button';
  stopButton.textContent = job.status === 'running' ? 'Stop ping' : 'Stopped';
  stopButton.disabled = job.status !== 'running';
  stopButton.addEventListener('click', async () => {
    await stopJob(job._id);
  });
  actions.appendChild(stopButton);

  container.append(urlLabel, statusText, pingInfo, logs, actions);
  return container;
}

async function loadJobs() {
  try {
    const res = await fetch('/jobs', { credentials: 'include' });
    if (!res.ok) {
      throw new Error('Unable to fetch jobs');
    }
    const body = await res.json();
    const jobs = body.jobs || [];
    elements.jobsList.innerHTML = '';
    if (jobs.length === 0) {
      elements.jobsList.innerHTML = '<p>No active jobs yet. Start a ping to keep your server alive.</p>';
    } else {
      jobs.forEach((job) => elements.jobsList.appendChild(buildJobCard(job)));
    }
    elements.jobCount.textContent = `${jobs.length} job${jobs.length === 1 ? '' : 's'}`;
  } catch (error) {
    console.error(error);
    elements.jobsList.innerHTML = '<p>Could not load job list.</p>';
  }
}

async function startJob(url, interval) {
  if (!url || !interval) {
    showToast('URL and interval are required.');
    return;
  }
  if (!state.user) {
    requestLogin();
    return;
  }
  setLoading(true);
  try {
    const res = await fetch('/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ url, interval: Number(interval) }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || 'Unable to start the ping job.');
    }
    showToast('Ping job started successfully.');
    await loadJobs();
  } catch (error) {
    console.error(error);
    if (error.message.includes('Authentication')) {
      requestLogin();
    } else {
      showToast(error.message);
    }
  } finally {
    setLoading(false);
  }
}

async function stopJob(jobId) {
  try {
    const res = await fetch('/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ jobId }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || 'Unable to stop job');
    }
    showToast('Ping job stopped.');
    await loadJobs();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Failed to stop job');
  }
}

async function logout() {
  try {
    const res = await fetch('/logout', {
      method: 'POST',
      credentials: 'include',
    });
    if (res.ok) {
      state.user = null;
      renderApp();
      showToast('Logged out successfully.');
    }
  } catch (error) {
    console.error(error);
    showToast('Unable to log out.');
  }
}

elements.homeStartButton.addEventListener('click', () => {
  const url = elements.homeUrlInput.value.trim();
  const interval = elements.homeIntervalSelect.value;
  if (!state.user) {
    requestLogin();
    return;
  }
  startJob(url, interval);
});

elements.dashStartButton.addEventListener('click', () => {
  const url = elements.dashUrlInput.value.trim();
  const interval = elements.dashIntervalSelect.value;
  startJob(url, interval);
});

elements.logoutButton.addEventListener('click', logout);

window.addEventListener('DOMContentLoaded', async () => {
  await fetchConfig();
  await fetchCurrentUser();
});
