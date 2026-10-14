# UlbraFlow — Workspace

Classifique cada demanda por área e prazo, organize o trabalho em uma esteira comum e concentre-se em uma tarefa de cada vez.

Acesse **https://flow-blue-theta.vercel.app/**. O repositório está conectado à Vercel; pushes para `main` acionam deployment.

## Uso

- **Entrada:** área e data respondem “para onde?” e “para quando?”.
- **Esteira:** arraste os cartões entre as etapas, use a alça no celular ou escolha a etapa pelo teclado. Setas, Avançar e Mover etapa continuam disponíveis; todas as áreas usam a mesma fila. Aguardando é opcional. O filtro Prazo final abre em **Hoje e atrasadas**: o que vence hoje e o que já venceu e continua aberto; Amanhã, Todas as datas e Escolher data continuam disponíveis.
- **Foco:** ciclos de 25 minutos de trabalho e 5 de descanso, ajustáveis, com uma tarefa ativa. Pausas e ausência após o término do ciclo não contam como trabalho.
- **Áreas:** catálogo de 12 classificações e áreas personalizadas. IDs, vínculos e históricos anteriores são preservados.
- **Agenda:** data de execução separada do prazo. Conexão direta com Google Agenda após ativação; exportação .ics continua disponível.
- **Gmail:** extensão 1.6 com Incluir no UlbraFlow, escolha de área/data e retorno ao e-mail. Terminado o e-mail, **Concluir e voltar ao UlbraFlow** conclui a tarefa, volta para o UlbraFlow e fecha a aba que o UlbraFlow abriu. Atualize o ZIP instalado separadamente do site.
- **Gestão do Tempo:** análise do dia, semana e mês, tempo por área e tarefa, relatório CSV e impressão/PDF. Usa sessões reais; descansos ficam fora.

A marca UlbraFlow usa azul forte (#3166DC), azul claro e azul-marinho (#182B49): menu escuro, navegação ativa e botões azuis, fundo azul claro e cartões brancos. O símbolo UF tem U branco, F azul e uma órbita pontilhada sobre um quadrado azul com cantos arredondados. O app abre na Entrada, com carregamento e acesso Google dentro da própria tela; a barra lateral mostra somente o nome UlbraFlow. O mesmo símbolo aparece no PDF e nos ícones de instalação, com um ícone maskable separado para Android. Os cabeçalhos usam a marca azul UlbraFlow; o logo institucional Ulbra S.A. é mantido no PDF. As cores escolhidas para áreas e remetentes são preservadas.

Uma abertura animada aparece uma vez por sessão: “Entre em Fluxo”, com a órbita de foco do símbolo, uma esteira em miniatura e um projeto sendo montado do modelo à entrega. O app carrega por baixo; “Entrar em Fluxo”, Enter ou Esc abrem o workspace. `?abertura=1` força a exibição e `?abertura=0` a omite. Não aparece em testes automatizados, retorno OAuth, compartilhamento ou captura da extensão. Com movimento reduzido no sistema, a composição fica estática. Arquivos: `opening.css` e `opening.js`.

## Google e armazenamento

**[Ativar Google, Supabase e Agenda](docs/ATIVACAO-GOOGLE.md)** contém as etapas de criação do projeto, SQL, provedor OAuth e variáveis da Vercel. Essa configuração externa ainda é necessária para ativar os serviços.

Sem configuração Google, o UlbraFlow continua usando `flow.workspace.v1` neste navegador. Com a configuração válida, exige login Google e salva um workspace privado por usuário no Supabase, com cache local separado por ID. Dados antigos são importados por uma ação explícita na conta; não são atribuídos silenciosamente a quem fizer login.

O SQL em `supabase/flow.sql` implementa RLS e salvamento com revisões. `docs/schema-postgresql-futuro.sql` é uma proposta antiga, não o schema utilizado. Erros deixam alterações pendentes. Quando outra aba, aparelho ou o complemento do celular salvou antes, as alterações são mescladas automaticamente por ID; só alterações divergentes no mesmo campo exigem revisão/carregamento explícito da nuvem. A mensagem de erro distingue limite de 2 MB, sessão expirada e falha de conexão. Com o app aberto, novidades salvas por outro aparelho chegam sozinhas: ao voltar para a aba ou app e a cada minuto com a tela visível, o UlbraFlow consulta só a revisão da nuvem e baixa os dados quando há algo mais novo, juntando com o que ainda não foi enviado. Alterações pendentes de uma sessão anterior são enviadas logo ao abrir. Análises do Gmail e eventos da Agenda divergentes entre aparelhos não travam a sincronização: vale a versão da nuvem. Exporte backups em Dados do UlbraFlow.

A Agenda sincroniza com o calendário principal enquanto o UlbraFlow está aberto. O acesso Google é renovado automaticamente quando as credenciais OAuth do servidor estão configuradas; veja [Renovação Google](docs/RENOVACAO-GOOGLE.md). O prazo final fica na descrição do evento, sem alterar a data de execução. A conexão é opcional e solicita consentimento separado.

## Desenvolvimento

Node.js 24, sem dependências npm nem build.

```bash
npm run dev     # servidor local
npm test        # sintaxe, testes Node e todos os testes de navegador
```

Servidor em `127.0.0.1:3000`; `PORT` é opcional. Variáveis são injetadas no processo; o servidor não lê `.env` automaticamente. O servidor local envia os mesmos cabeçalhos de segurança do `vercel.json`, aceita apenas `localhost`/`127.0.0.1` e não entrega pastas internas.

`npm run test:unit` roda todos os testes Node. `npm run test:browser` sobe um servidor temporário e roda cada `tests/*-smoke.py`; para escolher, passe os nomes: `python3 scripts/run-browser-tests.py app-workflow cloud`. Atalhos: `test:workflow`, `test:cloud`, `test:security`, `test:opening`, `test:gmail-review`, `test:google-refresh`, `test:extension`. `npm run test:sql` valida `supabase/*.sql` em PGlite descartável (defina `FLOW_PGLITE_MODULE`). `npm run package:extension` e `npm run package:addon` geram os ZIPs. O GitHub Actions (`.github/workflows/test.yml`) roda tudo a cada push e pull request.

Python Playwright e Chromium são necessários aos testes de navegador. `FLOW_TEST_URL` permite trocar o endereço local. A política de segurança bloqueia `page.wait_for_function` do Playwright; os testes usam `page.evaluate` em repetição. Os perfis são temporários. Os testes cloud simulam HTTP Supabase/Google; os da extensão simulam Gmail e transporte `chrome.*`. O Chromium gerenciado bloqueia extensões sem compactação; o carregamento nativo precisa do Chrome do usuário. A validação SQL descartável está documentada no guia de ativação.

Módulos: `areas.js` (catálogo), `workflow.js` (tarefas e foco), `cloud.js` (OAuth PKCE, dados e mesclagem), `calendar.js` (Google Agenda), `time-report.js` (análise/exportação), `gmail-review.js` (Entrada Gmail), `opening.js` (abertura), `app.js` (interface).

Digitação e atualizações em segundo plano são gravadas no navegador em lotes de 350 ms; ações do usuário gravam na hora. Ferramentas que leem o `localStorage` do app (como a extensão) devem disparar `window.dispatchEvent(new Event('flow:persist-flush'))` antes de ler.

## Vercel e integrações opcionais

`vercel.json`: framework Other, Build/Install vazios, Output Directory `.`, com `.vercelignore` excluindo testes, documentação, SQL e fontes da extensão/complemento. A interface e downloads são estáticos; `/api/auth-config` entrega apenas a configuração pública do Supabase (com cache de CDN) e `/api/gemini` é a função opcional de IA. Todas as respostas levam Content-Security-Policy (`script-src 'self'`, sem scripts inline), bloqueio de enquadramento, HSTS e Permissions-Policy com microfone apenas para o próprio site.

Gemini requer `GEMINI_API_KEY` e `FLOW_AI_ACCESS_TOKEN` no servidor; a chave não vai ao frontend. A análise da Entrada e dos projetos só aceita contas Google; `FLOW_ALLOWED_EMAILS` (e-mails ou `@dominio`, separados por vírgula) restringe quem pode usá-la e `FLOW_AI_DAILY_LIMIT` define a cota diária por usuário (padrão 300, função `flow_ai_quota_hit` do `supabase/flow.sql`). Desative cadastro por e-mail e anônimo no Supabase. `GEMINI_MODEL` deve ser permitido na conta. Sem credenciais, a rota retorna 503. Alertas ainda gravam preferências sem enviar e-mails.

Leia [a especificação funcional](docs/ESPECIFICACAO.md) e [a extensão](extensao-chrome/README.md).

A Agenda mostra tarefas e compromissos da agenda principal do Google na semana visível. A leitura expande recorrências, respeita o fuso local, pagina resultados e omite cópias das próprias tarefas. Compromissos externos são somente leitura e ficam apenas em memória. Atualiza ao trocar de semana, sincronizar, voltar à aba e a cada minuto enquanto a aba está visível. Não funciona com o UlbraFlow fechado. Cards de áreas usam cores suaves derivadas da cor de cada área.

Nova demanda inclui data e hora de execução separadas do prazo final. Pela Agenda, a data de execução é obrigatória e começa no dia atual ou na semana consultada; ao salvar, a Agenda permanece aberta na semana escolhida. Sem horário, a demanda aparece como dia inteiro.

A esteira oferece Retornar de Em andamento para A fazer, de Aguardando para Em andamento e de Concluídas para Aguardando, preservando a classificação e o histórico de tempo. Conexão da Agenda e instruções do Gmail ficam em controles compactos com detalhes expansíveis.

O relatório de Gestão do Tempo baixa um PDF direto no navegador, sem diálogo de impressão. Cabeçalho com UlbraFlow e Ulbra S.A., fontes incorporadas, indicadores, gráficos e tarefas paginadas. jsPDF 3.0.3 e fontes DejaVu estão incluídos localmente com licenças em vendor/ e assets/fonts/. Dados permanecem no navegador; não são enviados para gerar o PDF.

Ocultar concluídas recolhe a coluna de entregues sem excluir dados; Mostrar concluídas restaura a esteira completa. Os indicadores superiores são compactos. A Agenda mantém conexão e navegação da semana junto do cabeçalho.

Concluídas aparecem como cartões compactos com título e área. Clicar abre os detalhes, incluindo Reabrir tarefa; a coluna acompanha a altura do conteúdo.

A esteira diferencia as etapas por tons suaves de azul, com destaque mais forte em Em andamento. Colunas, cards e marcadores compartilham a cor da etapa; a classificação por área fica preservada.

## Gmail no Android

Complemento Google Workspace preparado em `gmail-addon/`, com pacote `downloads/flow-gmail-addon.zip`. A ativação exige executar `supabase/gmail-addon.sql` e instalar/distribuir o complemento na conta Google. Veja `gmail-addon/README.md`. `npm run test:gmail-addon` valida o código Apps Script com serviços simulados.

## Projetos dentro das áreas

Clique numa área para criar tarefas com a área preenchida e projetos que agrupam tarefas. Os projetos ficam em `initiatives`; `projects` continua representando o catálogo de áreas legado. Cada tarefa pode ter `initiativeId`. Todas seguem na esteira comum.

## Entrada unificada e Gemini

Gmail e registros manuais agora compartilham a Entrada. Ativação de Gmail API, variável GEMINI_API_KEY, consentimento e comportamento: [docs/GMAIL-ENTRADA.md](docs/GMAIL-ENTRADA.md). Testes: `npm run test:gmail-review`.

A análise Gemini consulta os modelos disponíveis quando o configurado retorna 404. Modelos que rejeitam o esquema estruturado usam uma chamada compatível, mantendo a validação da resposta. Erros 400 mostram o parâmetro rejeitado, com credenciais removidas da mensagem.

## Instalar no Android

Abra o UlbraFlow no Chrome normal e escolha menu ⋮ → Adicionar à tela inicial → Instalar. O manifesto define nome, ícones 192/512 e abertura standalone. O service worker guarda apenas a página pública de reconexão; APIs, e-mails e dados da conta não são colocados em cache. `npm run test:pwa` verifica os critérios de instalação do Chrome e o fallback sem conexão. O aplicativo continua exigindo internet para autenticar e sincronizar.

## Compartilhar do Android para o UlbraFlow

O manifesto registra um Web Share Target de texto e links, via POST multipart no service worker. O UlbraFlow precisa estar instalado como aplicativo no Chrome para aparecer na folha de compartilhamento dos apps que oferecem essa ação. O WhatsApp pode oferecer compartilhamento ou apenas copiar/encaminhar dependendo do tipo de mensagem e da versão.

O texto recebido fica temporariamente no IndexedDB do aparelho, associado a um identificador aleatório. Expira após 30 minutos, é removido na próxima leitura/captura ou após salvar/descartar e não vai no URL nem vira tarefa automaticamente. O identificador permanece na sessão durante o login. O usuário revisa título, área e prazo e pode pedir uma sugestão ao Gemini antes de salvar. Esta versão recebe apenas texto e links.

`npm run test:share` exercita o recebimento POST pelo service worker, cancelamento, recarga e salvamento de uma única demanda. O compartilhamento real do Android/WhatsApp requer validação no aparelho.

## Revisão de desempenho e confiabilidade

[Revisão de 13/10/2026](docs/REVISAO-PROJETO-2026-10-13.md) cobre segurança, gargalos e confiabilidade, com as correções e as ações pendentes de configuração. [Revisão de 12/10/2026](docs/REVISAO-PROJETO-2026-10-12.md) documenta as medições, correções e limites anteriores. A leitura Gmail reaproveita conversas pelo histórico da caixa; a classificação inicia durante o carregamento e atualiza os cartões sem substituir a tela inteira. Testes de regressão de desempenho estão em `npm run test:gmail-review`.

A [Base de Projetos](docs/BASE-PROJETOS.md) reúne avaliação Gemini, dez modelos guiados e acompanhamento com marcos, riscos, indicadores e tarefas vinculadas.
