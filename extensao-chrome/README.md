# Extensão Chrome para Gmail

1. Abra `chrome://extensions` no Google Chrome e ative **Modo do desenvolvedor**.
2. Clique em **Carregar sem compactação** e selecione a pasta `extensao-chrome`.
3. Abra um e-mail no Gmail e clique no ícone da extensão Flow.
4. Confira o assunto, informe a URL do aplicativo (por exemplo, `http://localhost:3000`) e clique em **Criar tarefa no Flow**.
5. O Flow abrirá uma tela para escolher projeto, data de execução e prazo.

## Limitações
- A primeira versão utiliza assunto, remetente e URL da aba; **não acessa o corpo completo nem envia a resposta**.
- O Gmail muda seletores HTML periodicamente; o assunto pode precisar de revisão manual.
- Para a versão institucional, a captura será migrada para autenticação oficial/OAuth conforme as permissões necessárias.
- A URL da conversa é mantida localmente no navegador; seu acesso exige estar logado no Gmail correspondente.
