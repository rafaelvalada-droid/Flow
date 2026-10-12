const form = document.getElementById('connection-form');
const input = document.getElementById('flow-url');
const status = document.getElementById('status');
const save = document.getElementById('save');

chrome.storage.local.get('flowUrl').then(saved => { input.value = saved.flowUrl || FlowExtension.defaultUrl; });

form.addEventListener('submit', async event => {
  event.preventDefault();
  let url;
  try { url = FlowExtension.parseUrl(input.value); }
  catch (error) { status.textContent = error.message;return; }
  save.disabled = true;
  try {
    const granted = await chrome.permissions.request({origins: [FlowExtension.permissionPattern(url)]});
    if (!granted) throw new Error('O endereço precisa ser autorizado para acessar suas listas.');
    await chrome.storage.local.set({flowUrl: url.href});
    status.textContent = 'Conexão salva. Abra uma conversa no Gmail e clique em Incluir no Uflow.';
  } catch (error) { status.textContent = error.message || 'Não foi possível salvar a conexão.'; }
  finally { save.disabled = false; }
});
