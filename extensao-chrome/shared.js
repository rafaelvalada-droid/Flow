globalThis.FlowExtension = Object.freeze({
  defaultUrl: 'https://flow-blue-theta.vercel.app/',
  parseUrl(value) {
    let url;
    try { url = new URL(String(value || '').trim()); }
    catch { throw new Error('Informe um endereço válido do Flow.'); }
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.username || url.password || url.hostname === 'mail.google.com' ||
        (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
      throw new Error('Informe o endereço HTTPS do Flow. HTTP é permitido apenas no teste local.');
    }
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '') + '/';
    return url;
  },
  permissionPattern(url) {
    return `${url.protocol}//${url.hostname}/*`;
  }
});
