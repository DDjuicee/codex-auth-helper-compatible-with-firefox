// background.js
// Chrome 使用 Manifest V3 service worker；Firefox 使用同一文件的事件页（background.scripts）。
// Firefox 把扩展发起的请求当成跨站，不会附带 SameSite=Lax 的登录 Cookie。
// 因此 Firefox 优先在 chatgpt.com 页面里发同源请求；没有打开的页面时，再临时开一个后台标签。

const SESSION_URL = 'https://chatgpt.com/api/auth/session';
const CHATGPT_ORIGIN = 'https://chatgpt.com/';

function isChatGPTPage(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'chatgpt.com';
  } catch (error) {
    return false;
  }
}

let inflightSession = null;
let lastSession = null;
let lastSessionAt = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.action !== 'fetch_session') {
    return undefined;
  }

  requestSession()
    .then((sessionData) => {
      sendResponse({ success: true, data: sessionData });
    })
    .catch((error) => {
      console.error('获取 ChatGPT Session 失败:', error);
      sendResponse({
        success: false,
        error: error && error.message ? error.message : 'UNKNOWN'
      });
    });

  return true;
});

function requestSession() {
  if (isFirefox() && lastSession && Date.now() - lastSessionAt < 30000) {
    return Promise.resolve(lastSession);
  }

  if (!inflightSession) {
    inflightSession = fetchChatGPTSession()
      .then((data) => {
        if (isFirefox()) {
          lastSession = data;
          lastSessionAt = Date.now();
        }
        return data;
      })
      .finally(() => {
        inflightSession = null;
      });
  }
  return inflightSession;
}

function isFirefox() {
  return typeof browser !== 'undefined' && typeof browser.runtime.getBrowserInfo === 'function';
}

async function fetchChatGPTSession() {
  if (isFirefox()) {
    const tabResult = await fetchSessionFromOpenTabs();
    if (tabResult.status === 'ok') return tabResult.data;
    if (tabResult.status === 'unauthorized') throw new Error('UNAUTHORIZED');
  }

  try {
    const direct = await fetchSessionDirect();
    if (direct) return direct;
  } catch (error) {
    if (!isFirefox()) throw error;
    console.warn('直接请求会话失败:', error);
  }

  if (isFirefox() && (await hasSessionCookie())) {
    const fromTempTab = await fetchSessionFromTemporaryTab();
    if (fromTempTab) return fromTempTab;
  }

  throw new Error('UNAUTHORIZED');
}

async function fetchSessionDirect() {
  const response = await fetch(SESSION_URL, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache'
    }
  });

  if (response.status === 401 || response.status === 403) {
    return null;
  }

  if (!response.ok) {
    throw new Error('HTTP 异常，状态码: ' + response.status);
  }

  const data = await response.json();
  if (!data || !data.accessToken) {
    return null;
  }

  return data;
}

async function fetchSessionFromOpenTabs() {
  const tabs = pickTabs(await browser.tabs.query({ url: 'https://chatgpt.com/*' }));
  if (!tabs.length) return { status: 'none' };

  let sawUnauthorized = false;
  for (const tab of tabs) {
    try {
      const data = await runInTabWhenReady(tab.id);
      if (data) return { status: 'ok', data };
      sawUnauthorized = true;
    } catch (error) {
      console.warn('从标签页读取会话失败:', error);
    }
  }

  if (sawUnauthorized) return { status: 'unauthorized' };
  return { status: 'failed' };
}

function pickTabs(tabs) {
  return (tabs || [])
    .filter((tab) => tab && tab.id != null)
    .sort((a, b) => Number(b.active) - Number(a.active))
    .slice(0, 3);
}

async function hasSessionCookie() {
  try {
    const cookies = await browser.cookies.getAll({ url: CHATGPT_ORIGIN });
    return cookies.some((cookie) => cookie.name && cookie.name.includes('session-token'));
  } catch (error) {
    console.warn('读取 Cookie 失败:', error);
    return false;
  }
}

async function fetchSessionFromTemporaryTab() {
  let tabId = null;
  try {
    const tab = await browser.tabs.create({
      url: CHATGPT_ORIGIN,
      active: false
    });
    tabId = tab.id;
    await waitForChatGPTDocument(tabId);
    return await runInTabWhenReady(tabId);
  } catch (error) {
    console.warn('临时页面读取会话失败:', error);
    return null;
  } finally {
    if (tabId != null) {
      try {
        await browser.tabs.remove(tabId);
      } catch (error) {
        console.warn('关闭临时标签页失败:', error);
      }
    }
  }
}

function waitForChatGPTDocument(tabId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('TIMEOUT')), 20000);

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      browser.tabs.onUpdated.removeListener(onUpdated);
      if (error) reject(error);
      else resolve();
    }

    function consider(tab, status) {
      if (!tab) return;
      const url = tab.url || '';
      if (isChatGPTPage(url)) {
        finish(null);
        return;
      }
      if (/^(about:neterror|chrome-error:|moz-error:)/.test(url)) {
        finish(new Error('NAVIGATION'));
        return;
      }
      if (status === 'complete' && url && !url.startsWith('about:')) {
        finish(new Error('REDIRECT'));
      }
    }

    function onUpdated(updatedId, info, tab) {
      if (updatedId !== tabId) return;
      if (info.status !== 'loading' && info.status !== 'complete') return;
      consider(Object.assign({}, tab, { url: (tab && tab.url) || info.url || '' }), info.status);
    }

    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.get(tabId).then((tab) => consider(tab, tab && tab.status)).catch(finish);
  });
}

async function runInTabWhenReady(tabId) {
  let lastError = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const results = await browser.scripting.executeScript({
        target: { tabId },
        func: fetchSessionInPage
      });
      const result = results && results[0] ? results[0].result : null;
      if (result && result.data && result.data.accessToken) return result.data;
      if (result && result.error === 'UNAUTHORIZED') return null;
      lastError = new Error((result && result.error) || '页面尚未就绪');
    } catch (error) {
      lastError = error;
    }

    await delay(400);
  }

  throw lastError || new Error('页面尚未就绪');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 注入到 chatgpt.com 页面中执行。必须自包含，不能引用外层变量。
async function fetchSessionInPage() {
  const response = await fetch('/api/auth/session', {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache'
    }
  });

  if (response.status === 401) {
    return { error: 'UNAUTHORIZED' };
  }

  if (!response.ok) {
    return { error: 'HTTP ' + response.status };
  }

  const data = await response.json();
  if (!data || !data.accessToken) {
    return { error: 'UNAUTHORIZED' };
  }

  return { data };
}
