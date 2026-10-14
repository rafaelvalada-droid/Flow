importScripts('shared.js');

let connecting = null;
let connectingUrl = '';

function isGmailSender(sender) {
  try {
    const url = new URL(sender.url);
    return sender.id === chrome.runtime.id && sender.tab?.id != null &&
      sender.frameId === 0 && url.protocol === 'https:' && url.hostname === 'mail.google.com';
  } catch { return false; }
}

async function waitForTab(id) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(id);
    if (tab.status === 'complete') return tab;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('O UlbraFlow demorou para abrir. Confira sua conexão e tente novamente.');
}

async function connect(url) {
  const tabs = await chrome.tabs.query({url: FlowExtension.permissionPattern(url)});
  let tab = tabs.find(item => {
    try {
      const candidate = FlowExtension.parseUrl(item.url);
      return candidate.href === url.href;
    } catch { return false; }
  });
  if (!tab) tab = await chrome.tabs.create({url: url.href, active: false});
  const loaded = await waitForTab(tab.id);
  const actual = FlowExtension.parseUrl(loaded.url);
  if (actual.href !== url.href) throw new Error('O endereço do UlbraFlow redirecionou. Atualize a conexão no ícone da extensão.');
  await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['flow-bridge.js']});
  return tab.id;
}

async function flowTab() {
  const saved = await chrome.storage.local.get('flowUrl');
  const url = FlowExtension.parseUrl(saved.flowUrl || FlowExtension.defaultUrl);
  const allowed = await chrome.permissions.contains({origins: [FlowExtension.permissionPattern(url)]});
  if (!allowed) throw new Error('Autorize o endereço do UlbraFlow pelo ícone da extensão e tente novamente.');
  if (!connecting || connectingUrl !== url.href) {
    connectingUrl = url.href;
    const pending = connect(url);
    connecting = pending;
    pending.finally(() => { if (connecting === pending) connecting = null; }).catch(() => {});
  }
  return connecting;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!['FLOW_LISTS', 'FLOW_SAVE_EMAIL', 'FLOW_OPEN_EMAIL'].includes(message?.type)) return;
  if (!isGmailSender(sender)) {
    sendResponse({ok: false, error: 'A captura precisa ser feita na conversa aberta no Gmail.'});
    return;
  }
  (async () => {
    const tabId = await flowTab();
    const type = message.type === 'FLOW_LISTS' ? 'FLOW_BRIDGE_LISTS' : message.type==='FLOW_OPEN_EMAIL'?'FLOW_BRIDGE_OPEN':'FLOW_BRIDGE_SAVE';
    const result = await chrome.tabs.sendMessage(tabId, {type, data: message.data});
    if (!result) throw new Error('Não foi possível conectar ao UlbraFlow. Atualize a aba do UlbraFlow e tente novamente.');
    if(result.ok&&message.type==='FLOW_OPEN_EMAIL')await chrome.tabs.update(tabId,{active:true});
    return result;
  })().then(sendResponse).catch(error => sendResponse({ok: false, error: error.message || 'Não foi possível acessar o UlbraFlow.'}));
  return true;
});
