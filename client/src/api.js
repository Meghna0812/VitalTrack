// Every call to the backend goes through here, so components never deal with fetch details.

// App.jsx registers a function here. When ANY request comes back 401 (session expired or
// signed out in another tab), the app returns to the sign-in screen in one place.
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(path, options = {}) {
  // The session cookie is sent automatically: the page and the API share one origin (via the Vite proxy).
  const res = await fetch(`/api${path}`, { credentials: 'same-origin', ...options });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
  if (!res.ok) throw Object.assign(new Error(body.error ?? `Request failed (${res.status})`), { status: res.status });
  return body;
}

const json = (method, data) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

export const api = {
  // Account
  authConfig: () => request('/auth/config'),
  me: () => request('/auth/me'),
  register: (data) => request('/auth/register', json('POST', data)),
  login: (data) => request('/auth/login', json('POST', data)),
  googleLogin: (credential) => request('/auth/google', json('POST', { credential })),
  logout: () => request('/auth/logout', { method: 'POST' }),
  logoutAll: () => request('/auth/logout-all', { method: 'POST' }),
  updateProfile: (data) => request('/auth/me', json('PATCH', data)),
  deleteAccount: () => request('/auth/me', { method: 'DELETE' }),

  // People
  listPatients: () => request('/patients'),
  createPatient: (name) => request('/patients', json('POST', { name })),
  deletePatient: (id) => request(`/patients/${id}`, { method: 'DELETE' }),

  // Reports (always for one person)
  uploadReport(patientId, file) {
    const form = new FormData();
    form.append('patientId', patientId);
    form.append('file', file);
    return request('/reports', { method: 'POST', body: form });
  },
  listReports: (patientId) => request(`/reports?patientId=${patientId}`),
  getReport: (id) => request(`/reports/${id}`),
  updateDescription: (id, description) => request(`/reports/${id}`, json('PATCH', { description })),
  deleteReport: (id) => request(`/reports/${id}`, { method: 'DELETE' }),

  // Review
  reviewResult: (id, data) => request(`/results/${id}`, json('PATCH', data)),
  deleteResult: (id) => request(`/results/${id}`, { method: 'DELETE' }),

  biomarkers: () => request('/biomarkers'),
  // `from` ('YYYY-MM-DD') limits trends to a period; leave it out for all-time trends.
  trends: (patientId, from) => request(`/trends?patientId=${patientId}${from ? `&from=${from}` : ''}`),
};
