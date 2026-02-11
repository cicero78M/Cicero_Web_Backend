import axios from 'axios';

function buildAuthPreview(token) {
  if (!token) {
    return null;
  }
  if (token.length <= 20) {
    return token;
  }
  return `${token.slice(0, 12)}...${token.slice(-4)}`;
}

export function createProtectedApiClient({ baseURL, logger = console }) {
  const state = {
    token: null
  };

  const http = axios.create({
    baseURL,
    withCredentials: true
  });

  http.interceptors.request.use(config => {
    if (!config.headers) {
      config.headers = {};
    }

    if (state.token) {
      config.headers.Authorization = `Bearer ${state.token}`;
    }

    logger.info('[API CLIENT] Outgoing request', {
      method: config.method?.toUpperCase() || 'GET',
      url: `${config.baseURL || ''}${config.url || ''}`,
      withCredentials: config.withCredentials === true,
      authorizationAttached: Boolean(config.headers.Authorization),
      authorizationPreview: buildAuthPreview(config.headers.Authorization || null)
    });

    return config;
  });

  async function userLogin(credentials) {
    const response = await http.post('/api/auth/user-login', credentials);
    const token = response?.data?.token;
    if (!token) {
      throw new Error('Token login tidak ditemukan pada response /api/auth/user-login');
    }
    state.token = token;
    return response.data;
  }

  async function getUserById(userId) {
    return http.get(`/api/users/${userId}`);
  }

  async function createLinkReport(payload) {
    return http.post('/api/link-reports', payload);
  }

  async function createLinkReportKhusus(payload) {
    return http.post('/api/link-reports-khusus', payload);
  }

  return {
    userLogin,
    getUserById,
    createLinkReport,
    createLinkReportKhusus,
    getToken: () => state.token
  };
}
