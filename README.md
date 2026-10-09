# Flow — Gestão de projetos, tarefas e tempo de trabalho

Base executável do **Flow**, em azul executivo. Projetada para desenvolvimento no VS Code, repositório GitHub e publicação na Vercel.

## Comece por aqui

1. Extraia o ZIP e abra a pasta **flow-v1** no VS Code.
2. Abra o terminal integrado (**Terminal > Novo Terminal**).
3. Execute:

```bash
npm run dev
```

4. Abra **http://localhost:3000** no Chrome.

Não há `npm install` obrigatório: o primeiro protótipo usa HTML, CSS e JavaScript sem dependências.

## Funcionalidades operacionais

- Cinco telas: tarefas, projetos (com Kanban), agenda semanal, Gmail e alertas.
- Criar/editar/excluir tarefas e projetos, adicionar/concluir/excluir subtarefas.
- Status, prioridade, data de execução (com horário opcional) e prazo final.
- Cronômetro por tarefa, com início/pausa/retomada e histórico de sessões. A contagem leva em conta timestamps e não depende da aba estar aberta.
- Uma tarefa ativa por vez (na mesma base local).
- Vínculo manual com link do Gmail, abertura da conversa original em outra aba.
- Botão **Incluir no Flow** dentro do Gmail: escolha uma lista (projeto) e salve a tarefa sem sair do e-mail, usando a extensão Chrome.
- Exportação de evento `.ics` para importação manual no Google Agenda.
- Exportação do backup JSON; alerta de vencimento configurável em preferências (envio por e-mail ainda não implementado).
- Integração opcional Gemini na API do servidor para melhorar descrições, preparar respostas e sugerir subtarefas.

## Estrutura

```text
flow-v1/
├── index.html                 # Entrada do aplicativo
├── styles.css                 # Identidade visual azul executivo
├── app.js                     # Interface e lógica do MVP
├── server.mjs                 # Servidor local Node.js
├── api/gemini.mjs             # Função da Vercel / Gemini
├── extensao-chrome/          # Extensão Manifest V3
├── docs/ESPECIFICACAO.md     # Regras do sistema
├── docs/schema-postgresql-futuro.sql
├── .env.example
└── package.json
```

## Gemini (opcional)

O frontend NÃO recebe a chave Gemini. Configure no ambiente do servidor:

- `GEMINI_API_KEY`: chave de acesso Google AI Studio.
- `FLOW_AI_ACCESS_TOKEN`: senha longa e distinta para proteger a rota nesta versão pessoal.
- `GEMINI_MODEL`: opcional (padrão `gemini-3.8-flash`).

Localmente, variáveis podem ser informadas pelo shell antes do `npm run dev`; o servidor Node não carrega arquivos `.env` automaticamente.

Na Vercel: **Project → Settings → Environment Variables**. O frontend solicitará a senha `FLOW_AI_ACCESS_TOKEN` na primeira chamada ao Gemini; essa senha permanece somente na memória da aba. O servidor chama a API Interactions com `store:false` e retorna a sugestão para revisão.

**Segurança:** o token compartilhado da versão local não substitui login, autorização por usuário, proteção contra abuso e limites de requisições. Antes de abrir o site ao público ou processar dados institucionais, faça a etapa de autenticação e controles de acesso. Não coloque nenhuma chave no GitHub.

## Extensão Chrome

No Flow, abra **Gmail → Baixar extensão para Gmail**. Extraia o ZIP; em `chrome://extensions`, ative Modo do desenvolvedor e carregue a pasta `flow-gmail` sem compactação. Recarregue o Gmail e, em uma conversa aberta, clique em **Incluir no Flow**, escolha a lista e salve. O endereço publicado já está configurado. A extensão mantém o Flow em uma aba de apoio e usa as listas e os dados do mesmo perfil do Chrome. Leia `extensao-chrome/README.md` para atualização e outros endereços.

Para desenvolver a extensão: `npm run check`, `npm run test:extension` (Python Playwright e Chromium) e `npm run package:extension` para regenerar o ZIP. O aplicativo continua sem dependências e sem build obrigatório.

## GitHub

Crie um repositório vazio no GitHub chamado, por exemplo, `flow-workspace`. No terminal desta pasta:

```bash
git init
git add .
git commit -m "Flow v1 - base funcional azul"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/flow-workspace.git
git push -u origin main
```

Você precisa substituir `SEU-USUARIO` pelo usuário real do seu GitHub e criar o repositório antes de enviar. Não incluí endereços fictícios como se o repositório já existisse.

## Vercel

1. Acesse https://vercel.com/new e importe seu repositório GitHub.
2. Escolha **Other** como framework, se necessário. Não há comando de build obrigatório.
3. Configure as variáveis `GEMINI_API_KEY` e `FLOW_AI_ACCESS_TOKEN` se quiser usar o Gemini.
4. Faça o deploy. Arquivos estáticos são servidos pela raiz e a função `api/gemini.mjs` fica em `/api/gemini`.
5. Atualize o endereço do Flow no popup da extensão.

Ao enviar novos commits ao repositório, a Vercel poderá fazer novos deploys automaticamente.

## Restrições desta primeira entrega

- **Não há banco de dados de produção nem login.** Os dados ficam no `localStorage` do navegador e não sincronizam entre computadores/celulares. Faça backup regularmente.
- **O Gmail não envia respostas e não é lido por API.** A extensão captura somente metadados básicos visíveis e o link da conversa.
- **A agenda ainda não sincroniza automaticamente.** O arquivo `.ics` é importado manualmente pelo usuário.
- **Alertas por e-mail ainda não são enviados.** Apenas as preferências são gravadas.
- **O Gemini precisa de credenciais e servidor configurados.** Sem isso, o aplicativo informará que a integração está indisponível.
- A modelagem PostgreSQL está em `docs/schema-postgresql-futuro.sql` para a próxima fase, não está conectada ao MVP.

Leia `docs/ESPECIFICACAO.md` antes de implementar autenticação, banco de dados ou integrações em produção.
