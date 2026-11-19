// Frontend configuration.
// API_URL is the backend's origin, e.g. 'https://api.example.com'.
// Leave it empty when the backend serves these pages (same origin, the default).
window.APP_CONFIG = {
  API_URL: '',
};
window.API_ROOT = String(window.APP_CONFIG.API_URL || '').replace(/\/+$/, '') + '/api';
// Served by the backend: clean addresses work (/admin#/audit?page=5). On another static host, use the file names.
window.PAGE = (name) => (window.APP_CONFIG.API_URL ? `${name}.html` : name);
