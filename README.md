# Flow — Workspace

Classifique cada demanda por área e prazo, organize o trabalho em uma esteira comum e concentre-se em uma tarefa de cada vez.

Acesse **https://flow-blue-theta.vercel.app/**. O repositório está conectado à Vercel; pushes para `main` acionam deployment.

## Uso

- **Entrada:** área e data respondem “para onde?” e “para quando?”.
- **Esteira:** fluxo da esquerda para a direita, com setas e Avançar; todas as áreas usam a mesma fila. Aguardando é opcional.
- **Foco:** ciclos de 25 minutos de trabalho e 5 de descanso, ajustáveis, com uma tarefa ativa. Pausas e ausência após o término do ciclo não contam como trabalho.
- **Áreas:** catálogo de 13 classificações, incluindo Ubra S.A., e áreas personalizadas. IDs, vínculos e históricos anteriores são preservados.
- **Agenda:** data de execução separada do prazo. Conexão direta com Google Agenda após ativação; exportação .ics continua disponível.
- **Gmail:** extensão 1.3 com Incluir no Flow, escolha de área/data e retorno ao e-mail. Atualize o ZIP instalado separadamente do site.
- **Gestão do Tempo:** análise do dia, semana e mês, tempo por área e tarefa, relatório CSV e impressão/PDF. Usa sessões reais; descansos ficam fora.

O slogan foi retirado. O logo verde Ulbra S.A. enviado aparece na tela de acesso e na barra superior. A interface usa tons de cinza claro com ações e destaques no verde Ulbra S.A. (#045A52), com letras brancas. O relatório para impressão/PDF usa fundo claro.

## Google e armazenamento

**[Ativar Google, Supabase e Agenda](docs/ATIVACAO-GOOGLE.md)** contém as etapas de criação do projeto, SQL, provedor OAuth e variáveis da Vercel. Essa configuração externa ainda é necessária para ativar os serviços.

Sem configuração Google, o Flow continua usando `flow.workspace.v1` neste navegador. Com a configuração válida, exige login Google e salva um workspace privado por usuário no Supabase, com cache local separado por ID. Dados antigos são importados por uma ação explícita na conta; não são atribuídos silenciosamente a quem fizer login.

O SQL em `supabase/flow.sql` implementa RLS e salvamento com revisões. `docs/schema-postgresql-futuro.sql` é uma proposta antiga, não o schema utilizado. Erros deixam alterações pendentes; conflitos exigem revisão/carregamento explícito da nuvem. Exporte backups em Dados do Flow.

A Agenda sincroniza com o calendário principal enquanto o Flow está aberto. Tokens Google expirados exigem reconexão. O prazo final fica na descrição do evento, sem alterar a data de execução. A conexão é opcional e solicita consentimento separado.

## Desenvolvimento

Node.js ≥20, sem dependências npm nem build.

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
