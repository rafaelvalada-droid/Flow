# Flow no Gmail — extensão Chrome 1.1

A extensão adiciona **Incluir no Flow** ao lado do assunto da conversa aberta no Gmail.
Você escolhe uma lista e salva a tarefa em uma caixa no próprio Gmail.
As listas correspondem aos projetos existentes no Flow.

## Instalação (Chrome no computador)

1. No Flow, abra **Gmail** e clique em **Baixar extensão para Gmail**.
2. Extraia o arquivo `flow-gmail-extension.zip`. Ele contém a pasta `flow-gmail`.
3. Abra `chrome://extensions` e ative **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação** e selecione a pasta `flow-gmail` que contém `manifest.json`.
5. Recarregue o Gmail, abra uma conversa e clique em **Incluir no Flow**, ao lado do assunto.
6. Escolha a lista, ajuste o título se quiser e clique em **Salvar no Flow**.

O endereço padrão já é `https://flow-blue-theta.vercel.app/`.
Para outro endereço, clique no ícone da extensão, informe a URL e escolha **Salvar conexão**.
O Chrome pedirá acesso apenas ao domínio escolhido. HTTP é aceito somente em localhost ou 127.0.0.1 para desenvolvimento.

## Como a conexão funciona

- A extensão usa uma aba do Flow em segundo plano para ler as listas e gravar a tarefa. Você permanece no Gmail.
- Se o Flow já estiver aberto no endereço configurado, sua aba será reaproveitada; a interface recebe a tarefa imediatamente.
- São capturados somente assunto, remetente visível e link da conversa. O corpo do e-mail não é lido e nenhuma mensagem é enviada.
- Os dados continuam no armazenamento local do Flow. Use o mesmo perfil do Chrome e o mesmo endereço do Flow em que estão suas listas.
- Cada domínio/subdomínio tem uma base local diferente; mudar entre o domínio principal e URLs de deployment da Vercel não transfere tarefas.
- Se não houver listas, crie um projeto no Flow e reabra a caixa no Gmail.
- O botão aparece em uma conversa aberta, não na lista da caixa de entrada. Os seletores do Gmail podem precisar de ajuste se sua interface mudar.
- Não é necessário fornecer senha do Gmail, chave da API ou instalar um servidor adicional.

## Atualização da extensão

Baixe e extraia o ZIP atualizado, substitua a pasta instalada e clique em **Recarregar** no cartão da extensão em `chrome://extensions`.
Depois, recarregue o Gmail. Atualizar o site na Vercel não atualiza automaticamente a extensão instalada no Chrome.

## Desenvolvimento

Depois de alterar a extensão, execute `npm run package:extension` para atualizar o ZIP publicado em `downloads/`.
`npm run check` verifica a sintaxe do aplicativo e da extensão.
`npm run test:extension` testa o fluxo com Chromium e Python Playwright em um perfil temporário, usando páginas de Gmail simuladas, os arquivos reais do Flow e um adaptador para a comunicação `chrome.*`. Nenhum e-mail real é acessado. O Chromium gerenciado do ambiente na nuvem bloqueia o carregamento nativo de extensões; a instalação real deve ser validada no Chrome do usuário.
