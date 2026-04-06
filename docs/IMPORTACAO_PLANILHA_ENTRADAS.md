# Importação automática da planilha de entradas

A aplicação agora consegue importar automaticamente a planilha de entradas e atualizar a base usada no agendamento.

## Formatos aceitos
- `.ods`
- `.csv`
- `.json`

## Pasta monitorada automaticamente
A cada 60 segundos o backend verifica a pasta:

`backend/uploads/importacao-relatorio`

Se houver um arquivo novo ou alterado, ele será processado automaticamente.

## Endpoint para upload manual
Rota protegida para ADMIN e GESTOR:

`POST /api/relatorio-entradas/importar`

Campo do formulário multipart:
- `arquivo`

## Endpoint de status
Rota protegida:

`GET /api/relatorio-entradas/status`

Retorna:
- última importação executada
- pasta monitorada
- arquivos detectados

## Comportamento da importação
- a planilha é tratada como fotografia atual do relatório
- a lista de fornecedores pendentes é substituída pela última planilha importada
- quando o banco estiver disponível, os dados são gravados na tabela `RelatorioTerceirizado`
- quando o banco não estiver disponível, o sistema mantém fallback em `backend/data/fornecedores-pendentes.json`

## Colunas utilizadas da planilha
- Entrada
- Fornecedor
- Nr. nota
- Série
- Data emissão
- Data de Entrada
- Tipo custo entrada
- Valor da nota
- Volume total
- Peso total
- Transportadora

## Observação operacional
Para a importação automática funcionar sem ação manual, basta copiar a planilha nova para a pasta monitorada.
