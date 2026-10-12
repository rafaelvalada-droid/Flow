# Uflow no Gmail — extensão Chrome 1.3.7

A extensão adiciona **Incluir no Uflow** ao lado do assunto da conversa aberta no Gmail.
Você escolhe a área e a data e salva a tarefa em uma caixa no próprio Gmail.
A demanda entra na esteira comum de todas as áreas. Feche a janela clicando fora dela ou pressionando Esc. Após salvar, clique em **Ver no Uflow** para abrir a demanda na aba de destino, ou em **Fechar** para continuar no Gmail.

## Instalação (Chrome no computador)

1. No Uflow, abra **Gmail** e clique em **Baixar extensão para Gmail**.
2. Extraia o arquivo `flow-gmail-extension.zip`. Ele contém a pasta `flow-gmail`.
3. Abra `chrome://extensions` e ative **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação** e selecione a pasta `flow-gmail` que contém `manifest.json`.
5. Recarregue o Gmail, abra uma conversa e clique em **Incluir no Uflow**, ao lado do assunto.
6. Escolha a área e a data, ajuste o título se quiser e clique em **Salvar no Uflow**.

O endereço padrão já é `https://flow-blue-theta.vercel.app/`.
Para outro endereço, clique no ícone da extensão, informe a URL e escolha **Salvar conexão**.
O Chrome pedirá acesso apenas ao domínio escolhido. HTTP é aceito somente em localhost ou 127.0.0.1 para desenvolvimento.

## Como a conexão funciona

- A extensão usa uma aba do Uflow em segundo plano para ler as áreas e gravar a tarefa. Você permanece no Gmail.
- Se o Uflow já estiver aberto no endereço configurado, sua aba será reaproveitada; a interface recebe a tarefa imediatamente.
- São capturados somente assunto, remetente visível e link da conversa. O corpo do e-mail não é lido e nenhuma mensagem é enviada.
- Com o Google ativado, entre no Uflow neste perfil do Chrome antes de capturar. A extensão usa a conta ativa e só confirma sucesso após o Supabase confirmar o salvamento. Sem configuração Google, permanece o armazenamento local. Use o mesmo endereço do Uflow. Erros de rede preservam a captura pendente; repetir Salvar não duplica a tarefa.
- Cada origem possui seu próprio cache e sessão. Com o Supabase configurado, a mesma conta recupera os dados da nuvem; a extensão continua apontando para o domínio configurado.
- Se não houver áreas, crie uma área no Uflow e reabra a caixa no Gmail.
- O botão aparece em uma conversa aberta, não na lista da caixa de entrada. Os seletores do Gmail podem precisar de ajuste se sua interface mudar.
- Não é necessário fornecer senha do Gmail, chave da API ou instalar um servidor adicional.

## Atualização da extensão

Baixe e extraia o ZIP atualizado, substitua a pasta instalada e clique em **Recarregar** no cartão da extensão em `chrome://extensions`.
Depois, recarregue o Gmail. Atualizar o site na Vercel não atualiza automaticamente a extensão instalada no Chrome.

## Desenvolvimento

Depois de alterar a extensão, execute `npm run package:extension` para atualizar o ZIP publicado em `downloads/`.
`npm run check` verifica a sintaxe do aplicativo e da extensão.
`npm run test:extension` testa o fluxo com Chromium e Python Playwright em um perfil temporário, usando páginas de Gmail simuladas, os arquivos reais do Uflow e um adaptador para a comunicação `chrome.*`. Nenhum e-mail real é acessado. O Chromium gerenciado do ambiente na nuvem bloqueia o carregamento nativo de extensões; a instalação real deve ser validada no Chrome do usuário.

A extensão 1.3 pede área e data e respeita a conta Google ativa no Uflow. Capturas antigas sem data ficam na Entrada do Uflow para classificação.
