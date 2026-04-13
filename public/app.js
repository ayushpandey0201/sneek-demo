const state = {
  sessionId: null,
  pollTimer: null,
  session: null,
  bootstrap: null,
  postmanExample: null,
};

const gateLabels = {
  mobileToken: 'Mobile token',
  decrypt: 'Decrypt QR',
  hmac: 'HMAC verify',
  kid: 'KID verify',
  sessionTtl: 'TTL verify',
  replay: 'Replay check',
  callbackSignature: 'Callback signature',
  clientSessionMatch: 'Client session cross-check',
  clientPayloadMatch: 'Client payload digest',
  clientBlobMatch: 'Client blob digest',
  clientVerificationSummary: 'Client cross-verify summary',
};

const elements = {
  loginButton: document.getElementById('loginButton'),
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
  gateGrid: document.getElementById('gateGrid'),
  timeline: document.getElementById('timeline'),
  sessionStatusPill: document.getElementById('sessionStatusPill'),
  gateTemplate: document.getElementById('gateTemplate'),
  timelineItemTemplate: document.getElementById('timelineItemTemplate'),
};

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
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

      await navigator.clipboard.writeText(text);
      const original = button.textContent;
      button.textContent = 'Copied';
      setTimeout(() => {
        button.textContent = original;
      }, 1200);
    });
  });
}

function renderBootstrap(data) {
  state.bootstrap = data;
  elements.clientIdLabel.textContent = data.demoClient.clientId;
  elements.kidLabel.textContent = data.demoClient.kid;
  elements.scanApiLabel.textContent = data.postmanTarget;
  elements.postmanUrl.textContent = data.postmanTarget;
}

function renderQr(session) {
  if (!session?.qrCodeDataUrl) {
    elements.qrWrap.innerHTML = '<p class="empty-state">Generate a session to render the QR code.</p>';
    return;
  }

  elements.qrWrap.innerHTML = `
    <img src="${session.qrCodeDataUrl}" alt="Sneek QR code" class="qr-image" />
  `;
}

function renderSessionMeta(session) {
  if (!session) {
    elements.sessionMeta.innerHTML = '';
    return;
  }

  const secondsLeft = Math.ceil(session.timeLeftMs / 1000);
  elements.sessionMeta.innerHTML = `
    <div class="meta-row"><span>Session ID</span><strong>${session.sessionId}</strong></div>
    <div class="meta-row"><span>Expires in</span><strong>${secondsLeft}s</strong></div>
    <div class="meta-row"><span>Status</span><strong>${session.status}</strong></div>
  `;
}

function renderPayload(session) {
  if (!session) {
    elements.hmacValue.textContent = 'Not generated yet';
    elements.encryptedBlobValue.textContent = 'Not generated yet';
    elements.payloadPreview.textContent = 'No payload yet';
    return;
  }

  elements.hmacValue.textContent = session.hmac;
  elements.encryptedBlobValue.textContent = session.encryptedBlob;
  elements.payloadPreview.textContent = prettyJson(session.payloadPreview);
}

function renderPostmanExample() {
  if (!state.postmanExample) {
    elements.postmanBody.textContent = 'Generate a session first.';
    return;
  }

  elements.postmanUrl.textContent = state.postmanExample.url;
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
    elements.resultCard.innerHTML = `
      <h3>Authentication Successful</h3>
      <p>Client backend verified the signed callback and issued a frontend session token.</p>
      <code>${session.sessionToken}</code>
    `;
    elements.userProfileCard.classList.remove('hidden');
    elements.userProfileCard.innerHTML = `
      <h3>Returned user profile</h3>
      <div class="user-grid">
        <div><span>User ID</span><strong>${session.userProfile.userId}</strong></div>
        <div><span>Name</span><strong>${session.userProfile.name}</strong></div>
        <div><span>Email</span><strong>${session.userProfile.email}</strong></div>
      </div>
    `;
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

  elements.resultCard.className = 'result-card result-idle';
  elements.resultCard.innerHTML = `
    <h3>Waiting for Sneek scan</h3>
    <p>The frontend is polling and the backend session is still pending.</p>
  `;
  elements.userProfileCard.classList.add('hidden');
  elements.userProfileCard.innerHTML = '';
}

function renderGates(session) {
  elements.gateGrid.innerHTML = '';

  const verification = session?.verification || {};
  Object.entries(gateLabels).forEach(([key, label]) => {
    const node = elements.gateTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('.gate-name').textContent = label;

    const value = verification[key] || 'pending';
    const valueNode = node.querySelector('.gate-value');
    valueNode.textContent = value;
    valueNode.dataset.state = value;

    elements.gateGrid.appendChild(node);
  });
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
}

async function fetchBootstrap() {
  const res = await fetch('/api/demo/bootstrap');
  const data = await res.json();
  renderBootstrap(data);
}

async function createSession() {
  elements.loginButton.disabled = true;
  elements.loginButton.textContent = 'Generating...';

  try {
    const res = await fetch('/api/client/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'spotify_123' }),
    });
    const data = await res.json();

    state.sessionId = data.session.sessionId;
    state.postmanExample = data.postmanExample;
    renderAll(data.session);
    startPolling();
  } catch (error) {
    console.error(error);
  } finally {
    elements.loginButton.disabled = false;
    elements.loginButton.textContent = 'Login with Sneak';
  }
}

async function pollSession() {
  if (!state.sessionId) return;

  const res = await fetch(`/api/client/session/${state.sessionId}`);
  const data = await res.json();
  renderAll(data.session);

  if (['authenticated', 'expired', 'rejected'].includes(data.session.status)) {
    stopPolling();
  }
}

function startPolling() {
  stopPolling();
  state.pollTimer = window.setInterval(pollSession, 1500);
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function init() {
  setCopyHandlers();
  await fetchBootstrap();
  renderAll(null);
  elements.loginButton.addEventListener('click', createSession);
}

init();
