// Lightweight API client that detects server availability and exposes helpers
// Attaches to window.api

async function pingServer() {
  try {
    const r = await fetch('/api/health', { method: 'GET' });
    return r.ok;
  } catch {
    return false;
  }
}

function toJson(r) {
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function createEntry(entry) {
  const r = await fetch('/api/entries', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(entry),
  });
  return toJson(r);
}

async function listEntries(params = {}) {
  const qs = new URLSearchParams(params);
  const r = await fetch(`/api/entries${qs.toString() ? `?${qs}` : ''}`, { method: 'GET' });
  return toJson(r);
}

async function updateEntry(id, patch) {
  const r = await fetch(`/api/entries?id=${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return toJson(r);
}

async function deleteEntry(id, options = {}) {
  const params = new URLSearchParams();
  if (options.hard) params.set('hard', '1');
  const extra = params.toString();
  const r = await fetch(
    `/api/entries?id=${encodeURIComponent(id)}${extra ? `&${extra}` : ''}`,
    { method: 'DELETE' },
  );
  return toJson(r);
}

async function createIdea(idea) {
  const r = await fetch('/api/ideas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(idea),
  });
  return toJson(r);
}

async function listIdeas(params = {}) {
  const qs = new URLSearchParams(params);
  const r = await fetch(`/api/ideas${qs.toString() ? `?${qs}` : ''}`, { method: 'GET' });
  return toJson(r);
}

async function updateIdea(id, patch) {
  const r = await fetch(`/api/ideas?id=${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return toJson(r);
}

async function deleteIdea(id) {
  const r = await fetch(`/api/ideas?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  return toJson(r);
}

async function notify(payload) {
  const r = await fetch('/api/notify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return toJson(r);
}

async function logAudit(event) {
  const r = await fetch('/api/audit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event || {}),
  });
  return toJson(r);
}

// LinkedIn submissions
async function listLinkedIn(params = {}) {
  const qs = new URLSearchParams(params);
  const r = await fetch(`/api/linkedin${qs.toString() ? `?${qs}` : ''}`, { method: 'GET' });
  return toJson(r);
}
async function createLinkedIn(data) {
  const r = await fetch('/api/linkedin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
  return toJson(r);
}
async function updateLinkedIn(id, patch) {
  const r = await fetch(`/api/linkedin?id=${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return toJson(r);
}
async function deleteLinkedIn(id) {
  const r = await fetch(`/api/linkedin?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  return toJson(r);
}

// Testing frameworks
async function listTestingFrameworks() {
  const r = await fetch('/api/testing-frameworks', { method: 'GET' });
  return toJson(r);
}
async function createTestingFramework(data) {
  const r = await fetch('/api/testing-frameworks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
  return toJson(r);
}
async function updateTestingFramework(id, patch) {
  const r = await fetch(`/api/testing-frameworks?id=${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return toJson(r);
}
async function deleteTestingFramework(id) {
  const r = await fetch(`/api/testing-frameworks?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  return toJson(r);
}

async function getGuidelines() {
  const r = await fetch('/api/guidelines', { method: 'GET' });
  return toJson(r);
}

async function saveGuidelinesRemote(body) {
  const r = await fetch('/api/guidelines', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return toJson(r);
}

async function getCurrentUser() {
  const r = await fetch('/api/user', { method: 'GET' });
  return toJson(r);
}

async function login(credentials) {
  const r = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  return toJson(r);
}

async function acceptInvite(payload) {
  const r = await fetch('/api/auth', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return toJson(r);
}

async function logout() {
  const r = await fetch('/api/auth', { method: 'DELETE' });
  return toJson(r);
}

async function listUsersRemote() {
  const r = await fetch('/api/users', { method: 'GET' });
  return toJson(r);
}

async function createUserRemote(payload) {
  const r = await fetch('/api/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return toJson(r);
}

async function updateUserRemote(id, patch) {
  const r = await fetch(`/api/users?id=${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return toJson(r);
}

async function deleteUserRemote(id) {
  const r = await fetch(`/api/users?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  return toJson(r);
}

(async () => {
  const enabled = await pingServer();
  try {
    if (typeof window !== 'undefined') {
      window.api = Object.freeze({
        enabled,
        listEntries,
        createEntry,
        updateEntry,
        deleteEntry,
        listIdeas,
        createIdea,
        updateIdea,
        deleteIdea,
        listLinkedIn,
        createLinkedIn,
        updateLinkedIn,
        deleteLinkedIn,
        listTestingFrameworks,
        createTestingFramework,
        updateTestingFramework,
        deleteTestingFramework,
        notify,
        logAudit,
        getGuidelines,
        saveGuidelines: saveGuidelinesRemote,
        getCurrentUser,
        login,
        logout,
        acceptInvite,
        listUsers: listUsersRemote,
        createUser: createUserRemote,
        updateUser: updateUserRemote,
        deleteUser: deleteUserRemote,
      });
      try {
        window.dispatchEvent(new CustomEvent('pm-api-ready', { detail: { enabled } }));
      } catch {}
    }
  } catch {
    // noop
  }
})();
