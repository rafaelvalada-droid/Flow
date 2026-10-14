import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, relative, extname, sep, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POST as geminiPost } from './api/gemini.mjs';
import { POST as gmailReviewPost } from './api/gmail-review.mjs';
import { GET as authConfigGet } from './api/auth-config.mjs';
import { POST as googleTokenPost } from './api/google-token.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const contentTypes = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8','.zip':'application/zip'};
// Os mesmos cabeçalhos de segurança da Vercel (vercel.json), para que os testes locais rodem sob a política real.
const security = Object.fromEntries((JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8')).headers || []).find(rule => rule.source === '/(.*)')?.headers.map(({key, value}) => [key.toLowerCase(), value]) || []);
// Pastas que existem só no repositório; nunca são servidas, nem com // ou ./ no caminho.
const hidden = new Set(['api','docs','extensao-chrome','tests','supabase','scripts','gmail-addon','node_modules']);
// Só aceita o próprio computador como Host, o que bloqueia DNS rebinding contra a porta local.
const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;
const send = (res, status, headers = {}, body = '') => { res.writeHead(status, {...security, ...headers}); res.end(body); };

const server = createServer(async (req, res) => {
  try {
    if (!localHost.test(req.headers.host || '')) {send(res, 403, {'content-type':'text/plain; charset=utf-8'}, 'Host não permitido.');return;}
    const route = (req.url || '/').split('?')[0];
    if (route === '/api/auth-config') {
      if (req.method !== 'GET') {send(res, 405);return;}
      const result=authConfigGet();
      send(res, result.status, Object.fromEntries(result.headers), await result.text());return;
    }
    if (['/api/gemini','/api/gmail-review','/api/google-token'].includes(route)) {
      if (req.method !== 'POST') {send(res, 405, {'content-type':'application/json'}, JSON.stringify({error:'Método não permitido.'}));return;}
      const parts=[];
      for await(const part of req){ parts.push(part); if (parts.reduce((n,p)=>n+p.length,0)>30_000){send(res, 413);return;} }
      const request=new Request(`http://localhost:${port}${req.url}`,{method:'POST',headers:{'content-type':req.headers['content-type']||'application/json','x-flow-access-token':req.headers['x-flow-access-token']||'',authorization:req.headers.authorization||''},body:Buffer.concat(parts)});
      const handlers={'/api/gemini':geminiPost,'/api/gmail-review':gmailReviewPost,'/api/google-token':googleTokenPost};
      const result=await handlers[route](request);
      send(res, result.status, Object.fromEntries(result.headers), await result.text());return;
    }
    let pathname;
    try { pathname=decodeURIComponent(route); } catch { send(res, 400);return; }
    if (pathname.includes('\0')||pathname.includes('\\')) {send(res, 400);return;}
    const filename=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    // Decide pelo caminho real dentro do projeto: //.git/config e /./docs/x caem nas mesmas regras.
    const rel=relative(root,filename),segments=rel.split(sep);
    if(!rel||rel.startsWith('..')||isAbsolute(rel)||segments.some(segment=>segment.startsWith('.'))||hidden.has(segments[0].toLowerCase())){send(res, 404, {'content-type':'text/plain; charset=utf-8'}, 'Não encontrado');return;}
    const details=await stat(filename).catch(()=>null);
    if(!details?.isFile()){send(res, 404, {'content-type':'text/plain; charset=utf-8'}, 'Não encontrado');return;}
    const body=await readFile(filename);
    send(res, 200, {'content-type':contentTypes[extname(filename)]||'application/octet-stream','cache-control':'no-store'}, body);
  } catch(err){send(res, 500, {'content-type':'application/json'}, JSON.stringify({error:'Erro interno no servidor local.'}));}
});
server.listen(port,'127.0.0.1',()=>console.log(`UlbraFlow disponível em http://localhost:${port}`));
