/**
 * Milvanta Deployment Runtime Configuration
 * Automatically isolates environments so staging/preview deployments NEVER hit production.
 * Prevents arbitrary query-string backend injection and unauthorized token redirection.
 */
(function(root) {
  const PROD_HOSTS = ['milvanta.in', 'www.milvanta.in'];
  const PROD_BACKEND_URL = 'https://milvanta-backend.onrender.com';
  const STAGING_BACKEND_URL = 'https://milvanta-api-staging.onrender.com';
  const LOCAL_BACKEND_URL = 'http://127.0.0.1:10000';

  function resolveMilvantaConfig(env) {
    const hostname = (env.hostname || '').toLowerCase();
    const search = env.search || '';
    const searchParams = new URLSearchParams(search);
    const metaApiUrl = env.metaApiUrl || null;
    const windowApiUrl = env.windowApiUrl || null;
    const isProd = PROD_HOSTS.includes(hostname);
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';

    let resolvedApiUrl = null;

    if (isProd) {
      // PRODUCTION SECURITY RULE:
      // Always and unconditionally use the authoritative production backend.
      // NEVER allow query parameters (?backend=), localStorage, or external meta tags
      // to redirect API calls or expose bearer tokens in production!
      resolvedApiUrl = PROD_BACKEND_URL;
    } else if (isLocalhost) {
      // Local development environment:
      // Allow local query overrides strictly restricted to loopback interfaces
      const paramBackend = searchParams.get('backend') || searchParams.get('api');
      if (paramBackend) {
        if (paramBackend === 'local') {
          resolvedApiUrl = LOCAL_BACKEND_URL;
        } else if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(paramBackend)) {
          resolvedApiUrl = paramBackend;
        }
      }

      // Check window / meta overrides if still null
      if (!resolvedApiUrl && windowApiUrl && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(windowApiUrl)) {
        resolvedApiUrl = windowApiUrl;
      }
      if (!resolvedApiUrl && metaApiUrl && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(metaApiUrl)) {
        resolvedApiUrl = metaApiUrl;
      }

      // Stored local override
      if (!resolvedApiUrl && env.storedApiUrl && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(env.storedApiUrl)) {
        resolvedApiUrl = env.storedApiUrl;
      }

      // Default for localhost
      if (!resolvedApiUrl) {
        resolvedApiUrl = LOCAL_BACKEND_URL;
      }
    } else {
      // Staging / Preview environments (e.g. workers.dev, pages.dev)
      resolvedApiUrl = STAGING_BACKEND_URL;
    }

    // Razorpay Key Configuration
    let resolvedKeyId = null;
    if (isProd) {
      // In production, load public key ID from environment / window without fallback to test key
      resolvedKeyId = env.liveKeyId || env.keyId || null;
    } else {
      // In staging / dev / local, default to test key
      resolvedKeyId = env.keyId || 'rzp_test_TMT4s342RfwceX';
    }

    return {
      apiUrl: resolvedApiUrl.replace(/\/$/, ''),
      keyId: resolvedKeyId,
      isProduction: isProd,
      isLocalhost
    };
  }

  // Execute in browser context if window is available
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname || '';
    const isProd = PROD_HOSTS.includes(hostname.toLowerCase());
    if (isProd) {
      try {
        localStorage.removeItem('MILVANTA_API_URL');
      } catch (_) {}
    }

    let storedApiUrl = null;
    if (!isProd) {
      try {
        storedApiUrl = localStorage.getItem('MILVANTA_API_URL');
      } catch (_) {}
    }

    const metaApiUrl = document.querySelector('meta[name="milvanta-api-url"]')?.getAttribute('content');
    const config = resolveMilvantaConfig({
      hostname,
      search: window.location.search,
      metaApiUrl,
      windowApiUrl: window.MILVANTA_API_URL,
      storedApiUrl,
      liveKeyId: window.RAZORPAY_LIVE_KEY_ID,
      keyId: window.RAZORPAY_KEY_ID
    });

    window.MILVANTA_API_URL = config.apiUrl;
    window.MILVANTA_IS_PRODUCTION = config.isProduction;
    window.RAZORPAY_KEY_ID = config.keyId;

    console.log(`[Milvanta Config] Environment: ${config.isProduction ? 'PRODUCTION' : (config.isLocalhost ? 'LOCAL' : 'STAGING')} | Backend: ${window.MILVANTA_API_URL}`);
  }

  // Export for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { resolveMilvantaConfig, PROD_HOSTS, PROD_BACKEND_URL, STAGING_BACKEND_URL, LOCAL_BACKEND_URL };
  } else if (root) {
    root.resolveMilvantaConfig = resolveMilvantaConfig;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
