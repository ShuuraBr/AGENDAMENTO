// Diagnóstico somente leitura (não altera nada no banco): mostra, etapa por
// etapa, quantas linhas da RelatorioTerceirizado com Status 'Ag. chegada da
// mercadoria' sobrevivem em cada filtro do pipeline usado pelo app, para achar
// exatamente onde a contagem exibida diverge de um SELECT COUNT(*) bruto.
//
// Uso (a partir da pasta backend/):
//   node scripts/diagnosticar-ag-chegada.js

import { diagnosticarContagemAgChegada } from '../src/utils/relatorio-entradas.js';
import { closeMysqlPool } from '../src/utils/mysql-direct.js';

async function main() {
  console.log('Diagnosticando contagem de "Ag. chegada da mercadoria"...\n');

  const resultado = await diagnosticarContagemAgChegada();

  console.log('== Etapa 1: tabela inteira (qualquer agendamentoId) ==');
  console.log(`  Total com Status contendo "chegada": ${resultado.totalBrutoTabelaInteira}`);
  console.log(`    - com agendamentoId NULO (realmente pendente):      ${resultado.totalBrutoComAgendamentoNulo}`);
  console.log(`    - com agendamentoId PREENCHIDO (já agendada, status desatualizado): ${resultado.totalBrutoComAgendamentoPreenchido}`);

  console.log('\n== Etapa 2: depois de deduplicar por NF dentro do mesmo fornecedor ==');
  console.log(`  Total: ${resultado.totalAposDedupPorNf} (diferença da etapa 1: -${resultado.diferencaDedupPorNf})`);

  console.log('\n== Etapa 3: depois do cross-check com notas de agendamentos ativos ==');
  console.log(`  Total exibido no app: ${resultado.totalExibidoNoApp} (diferença da etapa 2: -${resultado.diferencaCrossCheckAgendamentosAtivos})`);

  if (resultado.fornecedoresRemovidosPeloCrossCheck.length) {
    console.log('\n  Fornecedores cujas notas pendentes sumiram inteiramente nessa etapa:');
    for (const item of resultado.fornecedoresRemovidosPeloCrossCheck) {
      console.log(`    - ${item.fornecedor}: ${item.quantidadeNotasAgChegada} nota(s)`);
    }
  }

  console.log('\n== Resumo ==');
  console.log(`  Bruto (agendamentoId NULO): ${resultado.totalBrutoComAgendamentoNulo}`);
  console.log(`  Exibido no app hoje:        ${resultado.totalExibidoNoApp}`);
  console.log(`  Diferença total:            ${resultado.totalBrutoComAgendamentoNulo - resultado.totalExibidoNoApp}`);
}

main()
  .catch((error) => {
    console.error('\nFalha ao rodar o diagnóstico:', error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMysqlPool();
  });
