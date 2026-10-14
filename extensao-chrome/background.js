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

async function configuredUrl() {
  const saved = await chrome.storage.local.get('flowUrl');
  return FlowExtension.parseUrl(saved.flowUrl || FlowExtension.defaultUrl);
}

const allowedUrl = url => chrome.permissions.contains({origins: [FlowExtension.permissionPattern(url)]});

function isFlowTab(tab, url) {
  try { return FlowExtension.parseUrl(tab?.url).href === url.href; } catch { return false; }
}

async function bridgeInto(tab) {
  const loaded = tab.status === 'complete' ? tab : await waitForTab(tab.id);
  if (!isFlowTab(loaded, await configuredUrl())) throw new Error('A aba do UlbraFlow mudou de endereço. Atualize a aba e tente novamente.');
  await chrome.scripting.executeScript({target: {tabId: loaded.id}, files: ['flow-bridge.js']});
  return loaded.id;
}

// Só consulta uma aba do UlbraFlow que já está aberta: abrir o Gmail não cria abas novas.
async function openFlowTab() {
  const url = await configuredUrl();
  if (!await allowedUrl(url)) return null;
  const tab = (await chrome.tabs.query({url: FlowExtension.permissionPattern(url)})).find(item => isFlowTab(item, url));
  return tab ? bridgeInto(tab) : null;
}

async function findEmail(data) {
  const tabId = await openFlowTab();
  if (!tabId) return {ok: true, task: null};
  return await chrome.tabs.sendMessage(tabId, {type: 'FLOW_BRIDGE_FIND', data}) || {ok: true, task: null};
}

// Conclui a tarefa, volta para o UlbraFlow e fecha a aba do e-mail somente quando foi o UlbraFlow que a abriu.
async function completeEmail(data, sender) {
  const url = await configuredUrl();
  const opener = sender.tab.openerTabId != null ? await chrome.tabs.get(sender.tab.openerTabId).catch(() => null) : null;
  const fromFlow = isFlowTab(opener, url) && await allowedUrl(url);
  const tabId = fromFlow ? await bridgeInto(opener) : await flowTab();
  const result = await chrome.tabs.sendMessage(tabId, {type: 'FLOW_BRIDGE_COMPLETE', data});
  if (!result) throw new Error('Não foi possível conectar ao UlbraFlow. Atualize a aba do UlbraFlow e tente novamente.');
  if (!result.ok) return result;
  const flow = await chrome.tabs.update(tabId, {active: true});
  if (flow?.windowId != null) await chrome.windows.update(flow.windowId, {focused: true}).catch(() => {});
  // A aba principal do Gmail (sem o UlbraFlow como origem) não é fechada: o Gmail volta para a caixa de entrada.
  if (fromFlow) setTimeout(() => chrome.tabs.remove(sender.tab.id).catch(() => {}), 150);
  return {...result, closed: fromFlow};
}

async function flowTab() {
  const url = await configuredUrl();
  const allowed = await allowedUrl(url);
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
  if (!['FLOW_LISTS', 'FLOW_SAVE_EMAIL', 'FLOW_OPEN_EMAIL', 'FLOW_FIND_EMAIL', 'FLOW_COMPLETE_EMAIL', 'FLOW_ARCHIVE_EMAIL'].includes(message?.type)) return;
  if (!isGmailSender(sender)) {
    sendResponse({ok: false, error: 'A captura precisa ser feita na conversa aberta no Gmail.'});
    return;
  }
  (async () => {
    if (message.type === 'FLOW_FIND_EMAIL') return findEmail(message.data);
    if (message.type === 'FLOW_COMPLETE_EMAIL') return completeEmail(message.data, sender);
    const tabId = await flowTab();
    const type = message.type === 'FLOW_LISTS' ? 'FLOW_BRIDGE_LISTS' : message.type==='FLOW_OPEN_EMAIL'?'FLOW_BRIDGE_OPEN':message.type==='FLOW_ARCHIVE_EMAIL'?'FLOW_BRIDGE_ARCHIVE':'FLOW_BRIDGE_SAVE';
    const result = await chrome.tabs.sendMessage(tabId, {type, data: message.data});
    if (!result) throw new Error('Não foi possível conectar ao UlbraFlow. Atualize a aba do UlbraFlow e tente novamente.');
    if(result.ok&&message.type==='FLOW_OPEN_EMAIL')await chrome.tabs.update(tabId,{active:true});
    return result;
  })().then(sendResponse).catch(error => sendResponse({ok: false, error: error.message || 'Não foi possível acessar o UlbraFlow.'}));
  return true;
});
