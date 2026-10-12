# Uflow — Workspace

Classifique cada demanda por área e prazo, organize o trabalho em uma esteira comum e concentre-se em uma tarefa de cada vez.

Acesse **https://flow-blue-theta.vercel.app/**. O repositório está conectado à Vercel; pushes para `main` acionam deployment.

## Uso

- **Entrada:** área e data respondem “para onde?” e “para quando?”.
- **Esteira:** fluxo da esquerda para a direita, com setas e Avançar; todas as áreas usam a mesma fila. Aguardando é opcional.
- **Foco:** ciclos de 25 minutos de trabalho e 5 de descanso, ajustáveis, com uma tarefa ativa. Pausas e ausência após o término do ciclo não contam como trabalho.
- **Áreas:** catálogo de 12 classificações e áreas personalizadas. IDs, vínculos e históricos anteriores são preservados.
- **Agenda:** data de execução separada do prazo. Conexão direta com Google Agenda após ativação; exportação .ics continua disponível.
- **Gmail:** extensão 1.3 com Incluir no Flow, escolha de área/data e retorno ao e-mail. Atualize o ZIP instalado separadamente do site.
- **Gestão do Tempo:** análise do dia, semana e mês, tempo por área e tarefa, relatório CSV e impressão/PDF. Usa sessões reais; descansos ficam fora.

A marca Uflow apresenta “U” em verde profundo (#045A52) e “flow” em âmbar (#FBB640), com destaques âmbar na interface. O símbolo aprovado é “Uf”: U branco e f âmbar em um quadrado verde com cantos arredondados, acompanhado de uma esteira conectada de três etapas. A mesma imagem aparece no acesso, na barra lateral, no PDF e nos ícones de instalação, com um ícone maskable separado para Android. O logo verde Ulbra S.A. aparece no acesso e na barra superior.

## Google e armazenamento

**[Ativar Google, Supabase e Agenda](docs/ATIVACAO-GOOGLE.md)** contém as etapas de criação do projeto, SQL, provedor OAuth e variáveis da Vercel. Essa configuração externa ainda é necessária para ativar os serviços.

Sem configuração Google, o Flow continua usando `flow.workspace.v1` neste navegador. Com a configuração válida, exige login Google e salva um workspace privado por usuário no Supabase, com cache local separado por ID. Dados antigos são importados por uma ação explícita na conta; não são atribuídos silenciosamente a quem fizer login.

O SQL em `supabase/flow.sql` implementa RLS e salvamento com revisões. `docs/schema-postgresql-futuro.sql` é uma proposta antiga, não o schema utilizado. Erros deixam alterações pendentes; conflitos exigem revisão/carregamento explícito da nuvem. Exporte backups em Dados do Flow.

A Agenda sincroniza com o calendário principal enquanto o Flow está aberto. Tokens Google expirados exigem reconexão. O prazo final fica na descrição do evento, sem alterar a data de execução. A conexão é opcional e solicita consentimento separado.

## Desenvolvimento

Node.js 24, sem dependências npm nem build.

```bash
npm run check
npm run test:workflow
npm run dev
```

Servidor em `127.0.0.1:3000`; `PORT` é opcional. Variáveis são injetadas no processo; o servidor não lê `.env` automaticamente.

Com o servidor ativo:

```bash
npm run test:app
npm run test:cloud
npm run test:time
npm run test:extension
npm run package:extension
```

Python Playwright e Chromium são necessários aos testes de navegador. `FLOW_TEST_URL` permite trocar o endereço local. Os perfis são temporários. Os testes cloud simulam HTTP Supabase/Google; os da extensão simulam Gmail e transporte `chrome.*`. O Chromium gerenciado bloqueia extensões sem compactação; o carregamento nativo precisa do Chrome do usuário. A validação SQL descartável está documentada no guia de ativação.

Módulos: `areas.js` (catálogo), `workflow.js` (tarefas e foco), `cloud.js` (OAuth PKCE e dados), `calendar.js` (Google Agenda), `time-report.js` (análise/exportação), `app.js` (interface).

## Vercel e integrações opcionais

`vercel.json`: framework Other, Build/Install vazios, Output Directory `.`. A interface e downloads são estáticos; `/api/auth-config` entrega apenas a configuração pública do Supabase e `/api/gemini` é a função opcional de IA.

Gemini requer `GEMINI_API_KEY` e `FLOW_AI_ACCESS_TOKEN` no servidor; a chave não vai ao frontend. `GEMINI_MODEL` deve ser permitido na conta. Sem credenciais, a rota retorna 503. Alertas ainda gravam preferências sem enviar e-mails.

Leia [a especificação funcional](docs/ESPECIFICACAO.md) e [a extensão](extensao-chrome/README.md).

A Agenda mostra tarefas e compromissos da agenda principal do Google na semana visível. A leitura expande recorrências, respeita o fuso local, pagina resultados e omite cópias das próprias tarefas. Compromissos externos são somente leitura e ficam apenas em memória. Atualiza ao trocar de semana, sincronizar, voltar à aba e a cada minuto enquanto a aba está visível. Não funciona com o Flow fechado. Cards de áreas usam cores suaves derivadas da cor de cada área.

Nova demanda inclui data e hora de execução separadas do prazo final. Pela Agenda, a data de execução é obrigatória e começa no dia atual ou na semana consultada; ao salvar, a Agenda permanece aberta na semana escolhida. Sem horário, a demanda aparece como dia inteiro.

A esteira oferece Retornar de Em andamento para A fazer, de Aguardando para Em andamento e de Concluídas para Aguardando, preservando a classificação e o histórico de tempo. Conexão da Agenda e instruções do Gmail ficam em controles compactos com detalhes expansíveis.

O relatório de Gestão do Tempo baixa um PDF direto no navegador, sem diálogo de impressão. Cabeçalho com Uflow e Ulbra S.A., fontes incorporadas, indicadores, gráficos e tarefas paginadas. jsPDF 3.0.3 e fontes DejaVu estão incluídos localmente com licenças em vendor/ e assets/fonts/. Dados permanecem no navegador; não são enviados para gerar o PDF.

Ocultar concluídas recolhe a coluna de entregues sem excluir dados; Mostrar concluídas restaura a esteira completa. Os indicadores superiores são compactos. A Agenda mantém conexão e navegação da semana junto do cabeçalho.

Concluídas aparecem como cartões compactos com título e área. Clicar abre os detalhes, incluindo Reabrir tarefa; a coluna acompanha a altura do conteúdo.

A esteira diferencia as etapas por cores suaves: lilás na classificação, azul em A fazer, turquesa em andamento, areia em Aguardando e verde nas concluídas. Colunas, cards e marcadores compartilham a cor da etapa; a classificação por área fica preservada.

## Gmail no Android

Complemento Google Workspace preparado em `gmail-addon/`, com pacote `downloads/flow-gmail-addon.zip`. A ativação exige executar `supabase/gmail-addon.sql` e instalar/distribuir o complemento na conta Google. Veja `gmail-addon/README.md`. `npm run test:gmail-addon` valida o código Apps Script com serviços simulados.

## Projetos dentro das áreas

Clique numa área para criar tarefas com a área preenchida e projetos que agrupam tarefas. Os projetos ficam em `initiatives`; `projects` continua representando o catálogo de áreas legado. Cada tarefa pode ter `initiativeId`. Todas seguem na esteira comum.

## Entrada unificada e Gemini

Gmail e registros manuais agora compartilham a Entrada. Ativação de Gmail API, variável GEMINI_API_KEY, consentimento e comportamento: [docs/GMAIL-ENTRADA.md](docs/GMAIL-ENTRADA.md). Testes: `npm run test:gmail-review`.

A análise Gemini consulta os modelos disponíveis quando o configurado retorna 404. Modelos que rejeitam o esquema estruturado usam uma chamada compatível, mantendo a validação da resposta. Erros 400 mostram o parâmetro rejeitado, com credenciais removidas da mensagem.

## Instalar no Android

Abra o Flow no Chrome normal e escolha menu ⋮ → Adicionar à tela inicial → Instalar. O manifesto define nome, ícones 192/512 e abertura standalone. O service worker guarda apenas a página pública de reconexão; APIs, e-mails e dados da conta não são colocados em cache. `npm run test:pwa` verifica os critérios de instalação do Chrome e o fallback sem conexão. O aplicativo continua exigindo internet para autenticar e sincronizar.

## Compartilhar do Android para o Flow

O manifesto registra um Web Share Target de texto e links, via POST multipart no service worker. O Flow precisa estar instalado como aplicativo no Chrome para aparecer na folha de compartilhamento dos apps que oferecem essa ação. O WhatsApp pode oferecer compartilhamento ou apenas copiar/encaminhar dependendo do tipo de mensagem e da versão.

O texto recebido fica temporariamente no IndexedDB do aparelho, associado a um identificador aleatório. Expira após 30 minutos, é removido na próxima leitura/captura ou após salvar/descartar e não vai no URL nem vira tarefa automaticamente. O identificador permanece na sessão durante o login. O usuário revisa título, área e prazo e pode pedir uma sugestão ao Gemini antes de salvar. Esta versão recebe apenas texto e links.

`npm run test:share` exercita o recebimento POST pelo service worker, cancelamento, recarga e salvamento de uma única demanda. O compartilhamento real do Android/WhatsApp requer validação no aparelho.

## Revisão de desempenho e confiabilidade

[Revisão de 12/10/2026](docs/REVISAO-PROJETO-2026-10-12.md) documenta as medições, correções e limites restantes. A leitura Gmail reaproveita conversas pelo histórico da caixa; a classificação inicia durante o carregamento e atualiza os cartões sem substituir a tela inteira. Testes de regressão de desempenho estão em `npm run test:gmail-review`.
