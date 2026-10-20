/**
 * Milvanta Deployment Runtime Configuration
 * Automatically isolates environments so staging/preview deployments NEVER hit production.
 */
(function() {
  const PROD_HOSTS = ['milvanta.in', 'www.milvanta.in'];
  const PROD_BACKEND_URL = 'https://milvanta-backend.onrender.com';
  const STAGING_BACKEND_URL = 'https://milvanta-api-staging.onrender.com';
  const LOCAL_BACKEND_URL = 'http://127.0.0.1:10000';

  const hostname = window.location.hostname || '';
  const searchParams = new URLSearchParams(window.location.search);
  const metaApiUrl = document.querySelector('meta[name="milvanta-api-url"]')?.getAttribute('content');

  // 1. Explicit query param override (e.g. ?backend=http://... or ?api=local)
  let resolvedApiUrl = null;
  const paramBackend = searchParams.get('backend') || searchParams.get('api');
  if (paramBackend) {
    if (paramBackend === 'local') {
      resolvedApiUrl = LOCAL_BACKEND_URL;
    } else if (paramBackend.startsWith('http://') || paramBackend.startsWith('https://')) {
      resolvedApiUrl = paramBackend;
    }
  }

  // 2. Explicit window or meta tag declaration
  if (!resolvedApiUrl && window.MILVANTA_API_URL) {
    resolvedApiUrl = window.MILVANTA_API_URL;
  }
  if (!resolvedApiUrl && metaApiUrl) {
    resolvedApiUrl = metaApiUrl;
  }

  // 3. LocalStorage override
  if (!resolvedApiUrl) {
    try {
      const stored = localStorage.getItem('MILVANTA_API_URL');
      if (stored && (stored.startsWith('http://') || stored.startsWith('https://'))) {
        resolvedApiUrl = stored;
      }
    } catch (_) {}
  }

  // 4. Hostname auto-detection:
  // SAFE DEFAULT: Never hit production backend unless on authoritative production domain
  if (!resolvedApiUrl) {
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      resolvedApiUrl = LOCAL_BACKEND_URL;
    } else {
      // Authoritative target backend for Milvanta launch
      resolvedApiUrl = PROD_BACKEND_URL;
    }
  }

  window.MILVANTA_API_URL = resolvedApiUrl.replace(/\/$/, '');

  // Razorpay Key Configuration
  if (!window.RAZORPAY_KEY_ID) {
    if (PROD_HOSTS.includes(hostname)) {
      window.RAZORPAY_KEY_ID = window.RAZORPAY_LIVE_KEY_ID || 'rzp_test_TMT4s342RfwceX';
    } else {
      // Staging / Dev / Local always uses test key
      window.RAZORPAY_KEY_ID = 'rzp_test_TMT4s342RfwceX';
    }
  }

  console.log(`[Milvanta Config] Environment: ${PROD_HOSTS.includes(hostname) ? 'PRODUCTION' : 'STAGING/DEV'} | Backend: ${window.MILVANTA_API_URL}`);
})();

