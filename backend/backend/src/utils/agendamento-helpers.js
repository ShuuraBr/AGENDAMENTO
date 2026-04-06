export function normalizeCpf(value = "") {
  return String(value || "").replace(/\D/g, "").trim();
}

export function calculateTotals(notas = [], fallback = {}) {
  const clean = Array.isArray(notas) ? notas : [];
  const quantidadeNotasCalc = clean.filter((nota) => String(nota?.numeroNf || nota?.chaveAcesso || "").trim()).length;
  const quantidadeVolumesCalc = clean.reduce((acc, nota) => acc + Number(nota?.volumes || 0), 0);
  const pesoTotalKgCalc = clean.reduce((acc, nota) => acc + Number(nota?.peso || 0), 0);
  const valorTotalNfCalc = clean.reduce((acc, nota) => acc + Number(nota?.valorNf || 0), 0);

  return {
    quantidadeNotas: Number((fallback.quantidadeNotas ?? quantidadeNotasCalc) || 0),
    quantidadeVolumes: Number((fallback.quantidadeVolumes ?? quantidadeVolumesCalc) || 0),
    pesoTotalKg: Number((fallback.pesoTotalKg ?? pesoTotalKgCalc) || 0),
    valorTotalNf: Number((fallback.valorTotalNf ?? valorTotalNfCalc) || 0)
  };
}

export function withComputedTotals(item = {}) {
  const totais = calculateTotals(item.notasFiscais || [], item);
  return { ...item, ...totais };
}
