import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { POST as geminiPost } from './api/gemini.mjs';
import { POST as gmailReviewPost } from './api/gmail-review.mjs';
import { GET as authConfigGet } from './api/auth-config.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const contentTypes = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};

const server = createServer(async (req, res) => {
  try {
    if (req.url?.split('?')[0] === '/api/auth-config') {
      if (req.method !== 'GET') {res.writeHead(405);res.end();return;}
      const result=authConfigGet();
      res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.text());return;
    }
    if (['/api/gemini','/api/gmail-review'].includes(req.url?.split('?')[0])) {
      if (req.method !== 'POST') {res.writeHead(405, {'content-type':'application/json'});res.end(JSON.stringify({error:'Método não permitido.'}));return;}
      const parts=[];
      for await(const part of req){ parts.push(part); if (parts.reduce((n,p)=>n+p.length,0)>30_000){res.writeHead(413);res.end();return;} }
      const request=new Request(`http://localhost:${port}${req.url}`,{method:'POST',headers:{'content-type':req.headers['content-type']||'application/json','x-flow-access-token':req.headers['x-flow-access-token']||'',authorization:req.headers.authorization||''},body:Buffer.concat(parts)});
      const result=await (req.url.split('?')[0]==='/api/gmail-review'?gmailReviewPost:geminiPost)(request);
      res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.text());return;
    }
    const pathname=decodeURIComponent((req.url || '/').split('?')[0]);
    if (pathname.includes('\0')||pathname.includes('\\')) throw new Error('Caminho inválido');
    let pathnameSafe = pathname==='/'?'/index.html':pathname;
    const filename=resolve(root,'.'+pathnameSafe);
    if(filename!==root && !filename.startsWith(root+sep)){res.writeHead(403);res.end();return;}
    if(pathnameSafe.startsWith('/api/')||pathnameSafe.startsWith('/docs/')||pathnameSafe.startsWith('/extensao-chrome/')||pathnameSafe.startsWith('/.')){res.writeHead(404);res.end();return;}
    const details=await stat(filename).catch(()=>null);
    if(!details?.isFile()){res.writeHead(404);res.end('Não encontrado');return;}
    const body=await readFile(filename);
    res.writeHead(200,{'content-type':contentTypes[extname(filename)]||'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(body);
  } catch(err){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'Erro interno no servidor local.'}));}
});
server.listen(port,'127.0.0.1',()=>console.log(`Ulbraflow disponível em http://localhost:${port}`));
