# Flow — demandas em fluxo, uma tarefa em foco

Classifique as demandas por **área e data**, conduza todas pela **mesma esteira** e concentre-se em uma tarefa por vez com ciclos de trabalho e descanso.

Aplicativo: https://flow-blue-theta.vercel.app/

Repositório: https://github.com/rafaelvalada-droid/Flow

## Usar o Flow

1. **Entrada:** capture uma demanda. Responda “Para onde vai?” (área) e “Para quando?” (data). Se faltar uma dessas respostas, ela permanece a classificar.
2. **Esteira:** todas as áreas compartilham as etapas A classificar, A fazer, Em andamento, Aguardando e Concluídas. As datas mais próximas aparecem primeiro. Use **Mover etapa** no cartão ou edite a situação no detalhe.
3. **Foco:** escolha uma tarefa e comece um ciclo. O padrão é **25 minutos de foco / 5 de pausa**, ajustável. Uma única tarefa registra tempo de trabalho por vez. O descanso começa ao terminar o foco; o próximo ciclo de trabalho exige sua ação.
4. **Áreas:** escolha uma das 13 classificações definidas abaixo. As áreas não têm esteiras independentes. Áreas personalizadas já criadas são preservadas.

A urgência é calculada pela data: **atrasada, hoje, amanhã ou programada**. A data de execução e o horário opcionais continuam disponíveis no detalhe, separados do prazo e usados pela Agenda.

O novo símbolo mostra caminhos de demandas convergindo para um único ponto de atenção. Está em `assets/flow-mark.png`, no menu e no favicon.

## Classificações da Entrada

- Ubra IA
- Oferta de turmas
- Carga horária docente
- Incidências em folha
- Contratos docentes PJ
- Folha docente
- Plano docente
- Operação lato sensu BreCIA
- Pendências de pagamento PJ
- Ubracis
- Suporte operacional
- CPA Ubrecia
- Capacitação

“Contrato docente PJ” e “contratos docentes PJ” foram reunidos em uma única classificação. As opções também aparecem na caixa do Gmail, lidas da mesma base do Flow.

## Dados e atualização

Os dados ficam no `localStorage` do navegador, sem login ou sincronização entre dispositivos. Use o mesmo perfil e o domínio principal; URLs diferentes da Vercel têm bases diferentes. Exporte backups pelo botão de configurações.

A atualização preserva os projetos/áreas, tarefas, subtarefas, anotações e sessões existentes na chave `flow.workspace.v1`. “Projetos” passa a se chamar “Áreas” na interface; a estrutura dos backups permanece compatível. Demandas antigas sem área válida ou prazo aparecem na Entrada. As 13 classificações solicitadas são acrescentadas também às bases existentes quando o Flow é recarregado. Áreas equivalentes conservam seus IDs e vínculos; a Ouvidoria de exemplo permanece no histórico das tarefas antigas, fora das opções para novas demandas. Áreas personalizadas são preservadas.

Os ciclos usam timestamps persistidos. Reabrir a aba reconcilia o ciclo e encerra o tempo de trabalho no seu prazo, sem contar descanso ou horas de ausência. Um cronômetro da versão antiga mantém o histórico e recebe um ciclo a partir da atualização. O sistema usa a hora do dispositivo.

## Gmail

Abra **Gmail → Baixar extensão para Gmail** no Flow. Extraia o ZIP; em `chrome://extensions`, ative Modo do desenvolvedor e carregue a pasta `flow-gmail` sem compactação. Recarregue o Gmail.

Ao abrir uma conversa, clique em **Incluir no Flow**, ajuste o título, escolha a **área e a data** e salve. A tarefa entra na esteira com assunto, remetente visível e link da conversa. O Flow usa uma aba de apoio no mesmo perfil do Chrome; não lê o corpo do e-mail nem envia mensagens.

A extensão **1.2** precisa ser atualizada separadamente do site: baixe o ZIP novo, substitua os arquivos da pasta instalada, clique em Recarregar no cartão da extensão e recarregue o Gmail. Capturas de extensões antigas sem data continuam compatíveis e ficam a classificar. Leia `extensao-chrome/README.md`.

## Desenvolvimento

Node.js ≥20. HTML/CSS/JavaScript sem dependências; não é necessário instalar pacotes nem gerar build.

```bash
npm run check
npm run dev
```

O servidor local escuta em `127.0.0.1:3000` (`PORT` opcional). `areas.js` contém o catálogo e sua atualização; `workflow.js` contém as regras de classificação e ciclos; `app.js` contém a interface. A extensão está em `extensao-chrome/`.

```bash
npm run test:workflow    # Node: regras e persistência dos ciclos
npm run test:app         # Python Playwright + Chromium, servidor local ativo
npm run test:extension   # Python Playwright + Chromium, Gmail e chrome.* simulados
npm run package:extension
```

Os testes de navegador usam perfis temporários. O Chromium gerenciado na nuvem bloqueia extensões sem compactação; o teste da extensão executa seu código real com transporte Chrome simulado. Ele não valida uma conta real do Gmail nem o carregamento nativo da extensão. O ZIP é determinístico, inclui somente os nove arquivos da extensão e deve ser regenerado após alterações.

## GitHub e Vercel

O repositório já está conectado à Vercel. Commits enviados para `main` acionam o deployment.

`vercel.json` configura **Other**, raiz do repositório, Build Command e Install Command vazios e Output Directory `.`. Isso evita detectar `server.mjs` como backend genérico: a interface e os downloads são estáticos; `/api/gemini` é a função opcional.

## Integrações opcionais

- **Gemini:** configure `GEMINI_API_KEY` e `FLOW_AI_ACCESS_TOKEN` nas variáveis seguras do servidor/Vercel. A chave não vai para o frontend. O token protege a rota pessoal e fica na memória da aba. `GEMINI_MODEL` é opcional; confirme um modelo disponível na sua conta antes de ativar. O servidor não carrega `.env` automaticamente. Sem essas variáveis, a API retorna 503 e o restante funciona.
- **Agenda:** exportação `.ics` para importação manual no Google Agenda; sem sincronização OAuth.
- **Alertas:** salva preferências, mas ainda não envia e-mails automáticos.
- **Banco/login:** não implementados. A modelagem PostgreSQL em `docs/` é uma proposta futura, sem conexão com esta versão.

Regras detalhadas em `docs/ESPECIFICACAO.md`.
