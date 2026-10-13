# Base de Projetos

Na barra lateral, Meus Projetos fica abaixo de Áreas e reúne os projetos criados. Base de Projetos fica abaixo de Agenda e reúne Avaliação Gemini, dez modelos e Criar projeto. Meus Projetos inclui os projetos criados anteriormente dentro das Áreas. Projetos existentes preservam seus IDs e tarefas vinculadas.

## Da ideia ao plano

1. Em Avaliação Gemini, descreva o problema, pessoas, prazos e restrições.
2. O Gemini recomenda até três modelos da lista, com justificativas e primeiros passos.
3. Montar com este modelo abre a página principal e gera uma proposta. Também é possível escolher qualquer modelo diretamente e usar Gerar plano com Gemini.
4. Revise a proposta e escolha Aplicar ao rascunho. A geração não cria nem salva um projeto automaticamente.
5. Ajuste as etapas e salve. Os campos seguem editáveis depois da criação.

Os modelos são Projeto simples, PDCA, 5W2H, Plano de ação, Melhoria de processo, Projeto acadêmico, Scrum, OKR, A3 / Lean e Design Thinking. Cada etapa traz orientação sobre o conteúdo esperado. Todos os campos de texto têm Melhorar com Gemini. Datas, números, situação e área são definidos diretamente pelo usuário.

## Acompanhamento

- Identificação: área, responsável, recursos, datas e situação do projeto.
- Marcos: entregas, responsáveis, prazos e confirmação de conclusão; datas alimentam a linha do tempo.
- Tarefas: crie uma tarefa, converta uma entrega em tarefa ou vincule uma tarefa existente da mesma área. A confirmação de conclusão preserva o tempo registrado.
- Indicadores: valor inicial, meta e valor atual. A evolução considera metas de crescimento e redução; sem valores comparáveis, não apresenta percentual.
- Riscos: impacto, situação e resposta preventiva.
- Atualizações: decisões e avanços registrados ao salvar. Histórico dos últimos cinquenta salvamentos; até cem atualizações.

O painel separa etapas com conteúdo de tarefas realmente concluídas. A situação do projeto é uma decisão explícita; não é inferida a partir do preenchimento do plano. A exportação gera um relatório HTML, que pode ser aberto no navegador e impresso ou salvo como PDF.

## Dados e Gemini

Salvar usa a sincronização já existente do workspace. Campos não salvos ficam no rascunho da página durante a sessão; use Salvar alterações antes de fechar ou recarregar. Trocar de modelo preserva os textos de cada modelo no rascunho, mas o salvamento registra o modelo escolhido.

Avaliação e geração usam a chave Gemini existente no servidor e verificam a sessão Supabase. Só aceitam recomendações de modelos conhecidos e etapas solicitadas. Datas sugeridas para os marcos precisam constar no texto enviado; datas não informadas ficam vazias. Responsáveis e fatos novos devem ser tratados como hipóteses para revisão. Falhas do Gemini preservam o plano anterior.

`npm run test:projects` verifica validação do servidor, avaliação, geração e revisão, edição, gráficos, vínculo de tarefas, conclusão, histórico, exportação, reabertura e layout móvel com serviços simulados.

## Exclusão e restauração

Excluir projeto pede a digitação do nome para confirmar. O plano, os campos e o acompanhamento ficam na Lixeira de projetos por trinta dias, no mesmo workspace privado e sincronizado. As tarefas e seus tempos permanecem na área, sem o vínculo. Restaurar recupera o projeto e volta a vincular as tarefas que ainda estão na mesma área e não pertencem a outro projeto. Se a área original não existir, escolha uma área disponível.

Depois do prazo, o projeto não pode ser restaurado. O cache vencido é removido ao abrir o app e durante a limpeza periódica enquanto ele está aberto. Backups exportados anteriormente são independentes dessa retenção.
