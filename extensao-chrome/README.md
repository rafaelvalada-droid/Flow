# UlbraFlow no Gmail — extensão Chrome 1.6.0

A extensão adiciona **Incluir no UlbraFlow** ao lado do assunto da conversa aberta no Gmail.
Você escolhe a área e a data e salva a tarefa em uma caixa no próprio Gmail.
A demanda entra na esteira comum de todas as áreas. Feche a janela clicando fora dela ou pressionando Esc. Após salvar, clique em **Ver no UlbraFlow** para abrir a demanda na aba de destino, ou em **Fechar** para continuar no Gmail.

## Concluir e voltar ao UlbraFlow

Quando a conversa aberta tem uma tarefa em andamento no UlbraFlow, aparece o botão verde **✓ Concluir e voltar ao UlbraFlow** ao lado do assunto. Termine o que precisa no e-mail (responder, encaminhar, anexar) e clique nele:

1. A tarefa é marcada como concluída, com a mesma regra do botão Concluir da esteira (o foco em andamento é encerrado e o tempo trabalhado fica preservado).
2. O Chrome volta para a aba do UlbraFlow, com os detalhes da tarefa abertos.
3. A aba do e-mail é fechada quando foi aberta pelo UlbraFlow (botão **Abrir Gmail**/**Voltar ao Gmail**). Se a conversa estava na sua aba principal do Gmail, ela não é fechada: volta para a caixa de entrada.

O botão só aparece com uma aba do UlbraFlow aberta no endereço configurado; a extensão não abre abas novas só para verificar a conversa. Tarefas já concluídas não mostram o botão; para desfazer, use **Reabrir tarefa** no UlbraFlow.

## Instalação (Chrome no computador)

1. No UlbraFlow, abra **Gmail** e clique em **Baixar extensão para Gmail**.
2. Extraia o arquivo `flow-gmail-extension.zip`. Ele contém a pasta `flow-gmail`.
3. Abra `chrome://extensions` e ative **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação** e selecione a pasta `flow-gmail` que contém `manifest.json`.
5. Recarregue o Gmail, abra uma conversa e clique em **Incluir no UlbraFlow**, ao lado do assunto.
6. Escolha a área e a data, ajuste o título se quiser e clique em **Salvar no UlbraFlow**.

O endereço padrão já é `https://flow-blue-theta.vercel.app/`.
Para outro endereço, clique no ícone da extensão, informe a URL e escolha **Salvar conexão**.
O Chrome pedirá acesso apenas ao domínio escolhido. HTTP é aceito somente em localhost ou 127.0.0.1 para desenvolvimento.

## Como a conexão funciona

- A extensão usa uma aba do UlbraFlow em segundo plano para ler as áreas e gravar a tarefa. Você permanece no Gmail.
- Se o UlbraFlow já estiver aberto no endereço configurado, sua aba será reaproveitada; a interface recebe a tarefa imediatamente.
- São capturados somente assunto, remetente visível, link e identificação da conversa (o mesmo ID usado pela Gmail API, lido do cabeçalho da conversa aberta). O corpo do e-mail não é lido e nenhuma mensagem é enviada.
- O link usa `authuser=<sua conta>` (ou o índice `/u/N/` quando a conta não aparece no título da aba) e abre a conversa pelo ID, não pela posição na caixa de entrada.
- Uma conversa já incluída pela extensão, pelo complemento do celular ou pela revisão da Entrada não gera outra tarefa: a caixa informa que ela já está no UlbraFlow e **Ver no UlbraFlow** abre a demanda existente. A Entrada também não reanalisa com Gemini uma conversa capturada sem novas mensagens.
- Com o Google ativado, entre no UlbraFlow neste perfil do Chrome antes de capturar. A extensão usa a conta ativa e só confirma sucesso após o Supabase confirmar o salvamento. Se outro dispositivo alterou os dados e o UlbraFlow mesclar as versões automaticamente, a confirmação espera o salvamento mesclado e confere se a demanda foi mantida. Sem configuração Google, permanece o armazenamento local. Use o mesmo endereço do UlbraFlow. Erros de rede preservam a captura pendente; repetir Salvar não duplica a tarefa.
- Cada origem possui seu próprio cache e sessão. Com o Supabase configurado, a mesma conta recupera os dados da nuvem; a extensão continua apontando para o domínio configurado.
- Se não houver áreas, crie uma área no UlbraFlow e reabra a caixa no Gmail.
- O botão aparece em uma conversa aberta, não na lista da caixa de entrada. Os seletores do Gmail podem precisar de ajuste se sua interface mudar.
- Não é necessário fornecer senha do Gmail, chave da API ou instalar um servidor adicional.

## Atualização da extensão

Baixe e extraia o ZIP atualizado, substitua a pasta instalada e clique em **Recarregar** no cartão da extensão em `chrome://extensions`.
Depois, recarregue o Gmail. Atualizar o site na Vercel não atualiza automaticamente a extensão instalada no Chrome.

## Desenvolvimento

Depois de alterar a extensão, execute `npm run package:extension` para atualizar o ZIP publicado em `downloads/`.
`npm run check` verifica a sintaxe do aplicativo e da extensão.
`npm run test:extension` testa o fluxo com Chromium e Python Playwright em um perfil temporário, usando páginas de Gmail simuladas, os arquivos reais do UlbraFlow e um adaptador para a comunicação `chrome.*`. Nenhum e-mail real é acessado. O Chromium gerenciado do ambiente na nuvem bloqueia o carregamento nativo de extensões; a instalação real deve ser validada no Chrome do usuário.

A extensão 1.6 pede área e data, respeita a conta Google ativa no UlbraFlow e grava o ID da conversa para evitar tarefas duplicadas entre extensão, celular e Entrada. Capturas antigas sem data ficam na Entrada do UlbraFlow para classificação; capturas anteriores à 1.5 não têm o ID e não são reconhecidas automaticamente.
