# Revisão do UlbraFlow — 13 de outubro de 2026

Revisão de segurança, gargalos e confiabilidade em cinco frentes: autenticação/nuvem/funções, interface (`app.js`), integrações Gmail (extensão, complemento e leitura da Entrada), regras de domínio (tarefas, foco, Agenda, relatórios) e desempenho. Os achados mais graves foram conferidos diretamente no código; os de desempenho foram medidos no Chromium com dados sintéticos e serviços Supabase/Gmail/Gemini simulados. Não foram usados e-mails reais nem credenciais de produção.

## Medições

Cenário sintético: 8 tarefas e 30 conversas por dia útil, Agenda conectada.

| Medida | Valor |
| --- | ---: |
| Crescimento do workspace com Gmail | ≈ 0,78 MB por mês |
| Tempo até o limite de 2 MB da nuvem | ≈ 2,5 meses (≈ 6 meses sem Gmail) |
| Parte do workspace ocupada por análises Gmail (3 meses) | 59 % |
| Envios completos ao digitar 96 caracteres (workspace de 0,8 MB) | 21 envios, 16,4 MB |
| Envios completos ao analisar 25 e-mails | 25 envios, 19,5 MB |
| Custo por tecla na descrição (0,8 MB / 2,3 MB / 4,6 MB) | 11 / 20 / 61 ms |
| Mesma medida com CPU 4× mais lenta (2,3 MB) | 102 ms |
| Abertura sem novidades no Gmail | 27 chamadas, 25 conversas completas, Entrada em 2,9 s |
| Logo do cabeçalho | 384 × 384 px, 120 KB, exibido a 32 px |

## Achados

### Segurança

| Gravidade | Achado | Onde |
| --- | --- | --- |
| Alta | XSS armazenado: nome de área/projeto, `focusCycles`, alertas e minutos de foco entravam no HTML sem escape; um backup importado ou um nome de área executava código com acesso à sessão e ao token Gmail. Reproduzido. | `app.js` (`pageHead`, Foco, Alertas) |
| Alta | A rota do Gemini aceitava qualquer sessão Supabase, sem lista de contas nem cota; com cadastro por e-mail ativo, terceiros poderiam consumir a chave. | `api/gmail-review.mjs` |
| Média | Desconectar Gmail/Agenda não apagava nem revogava o token Google; não havia CSP nem bloqueio de enquadramento. | `cloud.js`, `vercel.json` |
| Baixa | O hash do token do complemento funcionava como a própria credencial; tokens vencidos não eram apagados. | `gmail-addon/Code.gs`, `supabase/gmail-addon.sql` |
| Baixa | Servidor local servia `//.git/config`, `//.env.example` e `//docs/…` (conferido). | `server.mjs` |
| Baixa | A Vercel publicava testes, documentação, SQL e uma função auxiliar sem rota. | `vercel.json`, `api/project-plan.mjs` |

### Perda de dados e confiabilidade

| Gravidade | Achado |
| --- | --- |
| Alta | Análises do Gmail nunca eram apagadas; o workspace atingiria 2 MB e todo salvamento falharia com a mensagem enganosa "Verifique a conexão". |
| Alta | Importar um backup malformado salvava os dados antes de validar; o app deixava de abrir em todos os dispositivos. Reproduzido. |
| Alta | Capturas pelo complemento do celular incrementavam a revisão; a aba da extensão entrava em conflito e "Carregar nuvem" escondia a captura numa cópia de segurança. |
| Média | Duas abas em modo nuvem sempre geravam conflito. Reproduzido. |
| Média | Cópias `.backup:` nunca eram apagadas; com a cota do navegador cheia, a alteração não ia nem para o cache nem para a nuvem. |
| Média | Tarefa cujo evento foi apagado não voltava à Agenda; o erro interrompia a sincronização de todas as tarefas seguintes. |
| Média | Eventos órfãos após restaurar backup; arquivamento podia esconder resposta nova; capturas duplicadas entre extensão, Entrada e complemento; conflito falso após salvamento lento. |
| Baixa | Dados malformados impediam a abertura; cronômetro antigo migrado como meses de trabalho; importação de outro navegador perdia projetos; e-mails ISO-8859-1 com acentos quebrados; contagem dupla em fusos com mudança de horário à meia-noite. |

### Testes

Os testes de navegador `test:app` e `test:extension` estavam quebrados desde que a esteira passou a abrir com o filtro "Hoje". Não havia `npm test` nem execução automática antes do deploy; a escrita na Agenda não tinha testes.

## O que já estava bem feito

- RLS com escrita apenas por função `security definer`, `search_path` vazio e revisão atômica.
- Login PKCE correto; renovação Google confere a identidade; segredo do cliente só no servidor.
- Extensão aceita mensagens apenas de si mesma, insere textos com `textContent` em shadow DOM e pede permissões mínimas.
- CSV protegido contra fórmulas; cronômetro de foco preciso e sem redesenhar a tela a cada segundo; jsPDF e fontes carregados só ao gerar PDF.
- A Agenda nunca altera eventos que não pertencem ao UlbraFlow.

## Correções entregues

### Segurança

- Títulos de página, ciclos de foco, minutos de foco/pausa, alertas e IDs de modelo recomendados pelo Gemini passam por escape ou conversão de tipo. Importação, startup e mesclagens usam um único `normalizeWorkspace()`, que converte cada campo ao tipo esperado.
- `api/gmail-review.mjs` e `api/google-token.mjs` exigem identidade Google; `FLOW_ALLOWED_EMAILS` restringe e-mails ou domínios. A função `flow_ai_quota_hit` (em `supabase/flow.sql`) aplica cota diária por usuário (`FLOW_AI_DAILY_LIMIT`, padrão 300); enquanto o SQL não for executado, a rota continua funcionando e registra aviso.
- Desconectar a última integração Google, ou sair da conta, apaga os tokens do navegador e revoga a autorização no Google. Um login simples não guarda mais tokens Google; só o consentimento de Gmail/Agenda.
- `vercel.json` envia CSP (`script-src 'self'`), `frame-ancestors 'none'`, `X-Frame-Options`, HSTS, `Referrer-Policy`, `nosniff` e `Permissions-Policy`. O servidor local lê os mesmos cabeçalhos; a página offline não usa mais script inline. Nenhuma violação de CSP nas páginas, PDF, downloads, service worker e compartilhamento.
- O complemento envia a chave bruta para `flow_gmail_capture_v2`, que calcula o hash no SQL e apaga chaves vencidas. A função antiga permanece como transição.
- `server.mjs` valida o caminho resolvido e o cabeçalho `Host`. `.vercelignore` retira testes, documentação, SQL e fontes de extensão/complemento da publicação; `api/project-plan.mjs` virou `api/_project-plan.mjs`.

### Dados e confiabilidade

- Análises do Gmail ganham data; aceitas e ignoradas ficam só com o essencial, pendentes expiram em 30 dias e o mapa é limitado a 500 conversas.
- Importação valida, normaliza e testa a renderização numa cópia; se falhar, o workspace anterior volta e nada é salvo. O startup sempre libera a interface e mostra um painel de recuperação.
- Conflito 409 com outra aba, outro aparelho ou o complemento do celular é mesclado por ID quando não há edição divergente no mesmo campo; a aba atualiza a tela pelo evento `flow:cloud-remote-merged`. Abas compartilham a revisão salva. Um salvamento cuja resposta se perdeu é reconhecido sem conflito.
- Apenas a cópia `.backup:` mais recente é mantida; gravações locais sem espaço não impedem o envio à nuvem. O tempo limite de salvamento cresce com o tamanho do workspace.
- Agenda: atualização por PUT completo, recuperação de eventos cancelados, erro isolado por tarefa (status parcial), limpeza horária de eventos órfãos do próprio usuário, assinatura armazenada como hash e espera exponencial em 429/5xx.
- Gmail: arquivamento só das mensagens revisadas, recusa quando chega mensagem nova; leitura de charset; resultados de análise sempre no workspace atual; extensão grava o ID da conversa e capturas são deduplicadas entre extensão, Entrada e celular.
- `normalize()` não lança exceção com dados malformados; registros inutilizáveis vão para `recovered`. Cronômetro antigo conta no máximo um ciclo. Relatórios montam períodos por data, sem contagem dupla em fusos com mudança de horário à meia-noite.
- "Trazer tarefas deste navegador" preserva projetos, lixeira e áreas arquivadas.

### Desempenho

- Digitação e atualizações em segundo plano gravam em lotes de 350 ms; o envio à nuvem respeita a espera também durante um envio em andamento.
- Entrada carrega metadados do Gmail e baixa o corpo só quando precisa analisar ou responder; reabrir o app não baixa conversas já revisadas.
- Agenda deixa de consultar o Google fora da página Agenda.
- Logo do cabeçalho em 64/128 px (6,6/19,5 KB) no lugar de 120 KB; `assets/`, `vendor/` e `downloads/` com cache de 1 dia; `/api/auth-config` com cache de CDN; verificação de conta e leitura do workspace em paralelo.

### Abertura e testes

- Abertura animada (`opening.css` + `opening.js`, 25 KB): órbita de foco, esteira em miniatura e projeto montado do modelo à entrega, com movimento reduzido respeitado e sem bloquear o carregamento do app.
- `npm test` reúne sintaxe, 137 testes Node e todos os testes de navegador por `scripts/run-browser-tests.py`; GitHub Actions roda tudo, inclusive SQL em PGlite, a cada push e pull request. Testes de navegador antigos foram ajustados ao filtro "Hoje" da esteira.

## Ações pendentes de configuração

1. Supabase → SQL Editor: executar novamente `supabase/flow.sql` (cota de IA) e `supabase/gmail-addon.sql` (função v2 e deduplicação). Ambos podem ser executados mais de uma vez.
2. Supabase → Authentication → Sign In / Providers: desativar cadastro por e-mail e anônimo.
3. Vercel → Environment Variables: definir `FLOW_ALLOWED_EMAILS` (recomendado) e, se quiser, `FLOW_AI_DAILY_LIMIT`; fazer novo deploy.
4. Apps Script: substituir `Code.gs`, publicar nova versão do complemento e, depois que todas as instalações estiverem atualizadas, executar `drop function if exists public.flow_gmail_capture(text,text,jsonb);`.
5. Reinstalar a extensão 1.5 a partir do ZIP em `downloads/`.
6. Se o Supabase passar a usar domínio próprio, incluí-lo em `connect-src` no `vercel.json`.

## Validação

Passaram: verificação sintática; 137 testes Node (regras, catálogo, tempo em vários fusos, nuvem e mesclagem, acesso às rotas, publicação, servidor local, Agenda com Google simulado, Gmail, complemento e assistente); políticas SQL de `flow.sql` e `gmail-addon.sql` em PGlite descartável; 17 testes de navegador sob a CSP de produção, incluindo XSS, importação malformada, cota do navegador, mesclagem entre abas, extensão com adaptador Chrome, PDF, PWA, compartilhamento e a abertura animada.

Não verificados nesta revisão: Supabase, Google e Gemini reais, distribuição do complemento (formato real do ID da conversa e suporte a `BigInt` no Apps Script), atributos reais do DOM do Gmail usados pela extensão e quota de armazenamento do Safari/iOS.
