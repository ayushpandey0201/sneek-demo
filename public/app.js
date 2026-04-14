const TERMINAL_STATUSES = ['authenticated', 'expired', 'rejected'];

const state = {
  sessionId: null,
  pollTimer: null,
  session: null,
  bootstrap: null,
  postmanExample: null,
  pollGeneration: 0,
};

const coreGates = {
  mobileToken: 'Mobile token',
  decrypt: 'Decrypt QR',
  hmac: 'HMAC verify',
  kid: 'KID verify',
  sessionTtl: 'TTL verify',
  replay: 'Replay check',
  callbackSignature: 'Callback signature',
};

const crossGates = {
  clientSessionMatch: 'Session cross-check',
  clientPayloadMatch: 'Payload digest match',
  clientBlobMatch: 'Blob digest match',
  clientVerificationSummary: 'Cross-verify summary',
};

const allGateLabels = { ...coreGates, ...crossGates };

const elements = {
  loginButton: document.getElementById('loginButton'),
  newSessionButton: document.getElementById('newSessionButton'),
  clientIdLabel: document.getElementById('clientIdLabel'),
  kidLabel: document.getElementById('kidLabel'),
  scanApiLabel: document.getElementById('scanApiLabel'),
  qrWrap: document.getElementById('qrWrap'),
  sessionMeta: document.getElementById('sessionMeta'),
  hmacValue: document.getElementById('hmacValue'),
  encryptedBlobValue: document.getElementById('encryptedBlobValue'),
  payloadPreview: document.getElementById('payloadPreview'),
  postmanUrl: document.getElementById('postmanUrl'),
  postmanBody: document.getElementById('postmanBody'),
  resultCard: document.getElementById('resultCard'),
  userProfileCard: document.getElementById('userProfileCard'),
  gateContainer: document.getElementById('gateContainer'),
  gatePassedCount: document.getElementById('gatePassedCount'),
  gateFailedCount: document.getElementById('gateFailedCount'),
  gatePendingCount: document.getElementById('gatePendingCount'),
  timeline: document.getElementById('timeline'),
  sessionStatusPill: document.getElementById('sessionStatusPill'),
  gateTemplate: document.getElementById('gateTemplate'),
  timelineItemTemplate: document.getElementById('timelineItemTemplate'),
};

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function safeFetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

function setCopyHandlers() {
  document.querySelectorAll('[data-copy-target]').forEach((button) => {
    button.addEventListener('click', async () => {
      const targetId = button.getAttribute('data-copy-target');
      const target = document.getElementById(targetId);
      const text = target?.textContent || '';

      if (!text || text === 'Not generated yet' || text === 'Generate a session first.') {
        return;
      }

      try {
        await navigator.clipboard.writeText(text);
        const original = button.textContent;
        button.innerHTML = '<span class="copy-check">&#10003;</span> Copied';
        setTimeout(() => {
          button.textContent = original;
        }, 1400);
      } catch (_err) {
        button.textContent = 'Failed';
        setTimeout(() => {
          button.textContent = 'Copy';
        }, 1400);
      }
    });
  });
}

function renderBootstrap(data) {
  state.bootstrap = data;
  elements.clientIdLabel.textContent = data.demoClient?.clientId || '—';
  elements.kidLabel.textContent = data.demoClient?.kid || '—';
  elements.scanApiLabel.textContent = data.postmanTarget || '—';
  elements.postmanUrl.textContent = data.postmanTarget || '—';
}

function renderQr(session) {
  if (!session?.qrCodeDataUrl) {
    elements.qrWrap.innerHTML = '<p class="empty-state">Generate a session to render the QR code.</p>';
    return;
  }

  const img = document.createElement('img');
  img.src = session.qrCodeDataUrl;
  img.alt = 'Sneek QR code';
  img.className = 'qr-image';
  elements.qrWrap.innerHTML = '';
  elements.qrWrap.appendChild(img);
}

function renderSessionMeta(session) {
  if (!session) {
    elements.sessionMeta.innerHTML = '';
    return;
  }

  const secondsLeft = typeof session.timeLeftMs === 'number' ? Math.ceil(session.timeLeftMs / 1000) : '—';
  elements.sessionMeta.innerHTML = `
    <div class="meta-row"><span>Session ID</span><strong>${escapeHtml(session.sessionId || '')}</strong></div>
    <div class="meta-row"><span>Expires in</span><strong>${escapeHtml(String(secondsLeft))}s</strong></div>
    <div class="meta-row"><span>Status</span><strong>${escapeHtml(session.status || '')}</strong></div>
  `;
}

function renderPayload(session) {
  if (!session) {
    elements.hmacValue.textContent = 'Not generated yet';
    elements.encryptedBlobValue.textContent = 'Not generated yet';
    elements.payloadPreview.textContent = 'No payload yet';
    return;
  }

  elements.hmacValue.textContent = session.hmac || '';
  elements.encryptedBlobValue.textContent = session.encryptedBlob || '';
  elements.payloadPreview.textContent = session.payloadPreview ? prettyJson(session.payloadPreview) : '';
}

function renderPostmanExample() {
  if (!state.postmanExample) {
    elements.postmanBody.textContent = 'Generate a session first.';
    return;
  }

  elements.postmanUrl.textContent = state.postmanExample.url || '';
  elements.postmanBody.textContent = prettyJson(state.postmanExample.body);
}

function renderResult(session) {
  if (!session) {
    elements.resultCard.className = 'result-card result-idle';
    elements.resultCard.innerHTML = `
      <h3>Waiting for authentication</h3>
      <p>The frontend is polling the client backend for session updates.</p>
    `;
    elements.userProfileCard.classList.add('hidden');
    elements.userProfileCard.innerHTML = '';
    return;
  }

  if (session.status === 'authenticated') {
    elements.resultCard.className = 'result-card result-success';

    const h3 = document.createElement('h3');
    h3.textContent = 'Authentication Successful';
    const p = document.createElement('p');
    p.textContent = 'Client backend verified the signed callback and issued a frontend session token.';
    const code = document.createElement('code');
    code.textContent = session.sessionToken || '';

    elements.resultCard.innerHTML = '';
    elements.resultCard.append(h3, p, code);

    const profile = session.userProfile || {};
    elements.userProfileCard.classList.remove('hidden');
    elements.userProfileCard.innerHTML = '';

    const profileTitle = document.createElement('h3');
    profileTitle.textContent = 'Returned user profile';
    const grid = document.createElement('div');
    grid.className = 'user-grid';

    [
      ['User ID', profile.userId],
      ['Name', profile.name],
      ['Email', profile.email],
    ].forEach(([label, value]) => {
      const div = document.createElement('div');
      const span = document.createElement('span');
      span.textContent = label;
      const strong = document.createElement('strong');
      strong.textContent = value || '—';
      div.append(span, strong);
      grid.appendChild(div);
    });

    elements.userProfileCard.append(profileTitle, grid);
    return;
  }

  if (session.status === 'expired') {
    elements.resultCard.className = 'result-card result-warning';
    elements.resultCard.innerHTML = `
      <h3>Session expired</h3>
      <p>The QR session passed its 60 second TTL before the full flow completed.</p>
    `;
    elements.userProfileCard.classList.add('hidden');
    elements.userProfileCard.innerHTML = '';
    return;
  }

  if (session.status === 'rejected') {
    elements.resultCard.className = 'result-card result-error';
    elements.resultCard.innerHTML = `
      <h3>Authentication rejected</h3>
      <p>At least one verification gate failed. Check the timeline below for the first failing step.</p>
    `;
    elements.userProfileCard.classList.add('hidden');
    elements.userProfileCard.innerHTML = '';
    return;
  }

  elements.resultCard.className = 'result-card result-pending';
  elements.resultCard.innerHTML = `
    <h3>Waiting for Sneek scan</h3>
    <p>The frontend is polling and the backend session is still pending.</p>
  `;
  elements.userProfileCard.classList.add('hidden');
  elements.userProfileCard.innerHTML = '';
}

function buildGateSection(title, iconClass, gates, verification) {
  const section = document.createElement('div');
  section.className = 'gate-section';

  const header = document.createElement('div');
  header.className = 'gate-section-header';

  const icon = document.createElement('div');
  icon.className = `gate-section-icon ${iconClass}`;
  icon.innerHTML = iconClass === 'core' ? '&#9881;' : '&#10003;';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'gate-section-title';
  titleSpan.textContent = title;

  header.append(icon, titleSpan);
  section.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'gate-grid';

  Object.entries(gates).forEach(([key, label]) => {
    const node = elements.gateTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('.gate-name').textContent = label;

    const value = verification[key] || 'pending';
    const valueNode = node.querySelector('.gate-value');
    valueNode.textContent = value;
    valueNode.dataset.state = value;
    node.dataset.gateState = value;

    grid.appendChild(node);
  });

  section.appendChild(grid);
  return section;
}

function renderGates(session) {
  elements.gateContainer.innerHTML = '';

  const verification = session?.verification || {};

  const coreSection = buildGateSection('Core Verification Gates', 'core', coreGates, verification);
  elements.gateContainer.appendChild(coreSection);

  const crossSection = buildGateSection('Cross-Verification Gates', 'cross', crossGates, verification);
  elements.gateContainer.appendChild(crossSection);

  const allValues = Object.keys(allGateLabels).map((k) => verification[k] || 'pending');
  const passed = allValues.filter((v) => v === 'passed').length;
  const failed = allValues.filter((v) => v === 'failed').length;
  const pending = allValues.filter((v) => v === 'pending').length;

  elements.gatePassedCount.textContent = passed;
  elements.gateFailedCount.textContent = failed;
  elements.gatePendingCount.textContent = pending;
}

function renderTimeline(session) {
  elements.timeline.innerHTML = '';

  if (!session?.auditTrail?.length) {
    elements.timeline.innerHTML = '<p class="empty-state">Timeline will appear after a session is created.</p>';
    return;
  }

  session.auditTrail.forEach((entry) => {
    const node = elements.timelineItemTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('.timeline-step').textContent = entry.step;

    const statusNode = node.querySelector('.timeline-status');
    statusNode.textContent = entry.status;
    statusNode.dataset.state = entry.status;

    const dotNode = node.querySelector('.timeline-dot');
    dotNode.dataset.state = entry.status;

    node.querySelector('.timeline-details').textContent = entry.details;
    node.querySelector('.timeline-at').textContent = new Date(entry.at).toLocaleTimeString();
    elements.timeline.appendChild(node);
  });
}

function renderStatusPill(session) {
  const status = session?.status || 'idle';
  elements.sessionStatusPill.textContent = status;
  elements.sessionStatusPill.dataset.state = status;
}

function updateNewSessionButton(session) {
  const isTerminal = session && TERMINAL_STATUSES.includes(session.status);
  if (isTerminal) {
    elements.newSessionButton.classList.remove('hidden');
  } else {
    elements.newSessionButton.classList.add('hidden');
  }
}

function renderAll(session) {
  state.session = session;
  renderQr(session);
  renderSessionMeta(session);
  renderPayload(session);
  renderPostmanExample();
  renderResult(session);
  renderGates(session);
  renderTimeline(session);
  renderStatusPill(session);
  updateNewSessionButton(session);
}

async function fetchBootstrap() {
  try {
    const data = await safeFetchJson('/api/demo/bootstrap');
    renderBootstrap(data);
  } catch (error) {
    console.error('Bootstrap failed:', error);
    elements.scanApiLabel.textContent = 'Unavailable';
  }
}

function resetSession() {
  stopPolling();
  state.sessionId = null;
  state.session = null;
  state.postmanExample = null;
  state.pollGeneration += 1;
  renderAll(null);
  elements.newSessionButton.classList.add('hidden');
}

async function createSession() {
  resetSession();
  elements.loginButton.disabled = true;
  elements.loginButton.textContent = 'Generating...';
  elements.loginButton.classList.add('generating');

  try {
    const data = await safeFetchJson('/api/client/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'spotify_123' }),
    });

    if (!data.session) {
      throw new Error('No session in response');
    }

    state.sessionId = data.session.sessionId;
    state.postmanExample = data.postmanExample;
    renderAll(data.session);
    startPolling();
  } catch (error) {
    console.error('Session creation failed:', error);
    elements.resultCard.className = 'result-card result-error';
    elements.resultCard.innerHTML = `
      <h3>Connection error</h3>
      <p>Could not create session. Check that the server is running and try again.</p>
    `;
  } finally {
    elements.loginButton.disabled = false;
    elements.loginButton.textContent = 'Login with Sneek';
    elements.loginButton.classList.remove('generating');
  }
}

async function pollSession() {
  if (!state.sessionId) return;

  const gen = state.pollGeneration;

  try {
    const data = await safeFetchJson(`/api/client/session/${state.sessionId}`);

    if (gen !== state.pollGeneration) return;
    if (!data.session) return;

    renderAll(data.session);

    if (TERMINAL_STATUSES.includes(data.session.status)) {
      stopPolling();
    }
  } catch (error) {
    console.error('Polling error:', error);
  }
}

function startPolling() {
  stopPolling();
  state.pollTimer = window.setInterval(pollSession, 1500);
}

function stopPolling() {
  if (state.pollTimer != null) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function init() {
  setCopyHandlers();
  await fetchBootstrap();
  renderAll(null);
  elements.loginButton.addEventListener('click', createSession);
  elements.newSessionButton.addEventListener('click', createSession);
}

init();
