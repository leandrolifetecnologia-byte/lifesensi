// Dados de referência das faturas das concessionárias (sem dados pessoais).
// Fonte: contas Águas de Joinville (água) e Celesc (energia) do cliente.
// Estes são os medidores OFICIAIS das concessionárias — diferentes dos
// sensores LifeEye do Metam. Servem como referência/histórico e para estimar
// custo (tarifa efetiva = valor da última fatura ÷ consumo do período).

export const FATURAS = {
  agua: {
    concessionaria: "Águas de Joinville",
    hidrometro: "A22L281708",
    unidade: "m³",
    media6m: 32,
    // consumo faturado por mês (m³)
    historico: [
      { mes: "12/2025", consumo: 32 },
      { mes: "01/2026", consumo: 12 },
      { mes: "02/2026", consumo: 19 },
      { mes: "03/2026", consumo: 40 },
      { mes: "04/2026", consumo: 50 },
      { mes: "05/2026", consumo: 43 },
      { mes: "06/2026", consumo: 37 },
    ],
    // última fatura: soma dos serviços (água+esgoto+operacional), sem multa/juros
    ultimaFatura: {
      mes: "06/2026",
      consumo: 37,
      valorServicos: 644.11, // 322,91 + 258,33 + 34,93 + 27,94
    },
  },
  energia: {
    concessionaria: "Celesc",
    uc: "31920728",
    unidade: "kWh",
    // consumo faturado por mês (kWh) — inclui geração/injeção solar
    historico: [
      { mes: "07/2025", consumo: 3344 },
      { mes: "08/2025", consumo: 2563 },
      { mes: "09/2025", consumo: 2432 },
      { mes: "10/2025", consumo: 2414 },
      { mes: "11/2025", consumo: 2310 },
      { mes: "12/2025", consumo: 2306 },
      { mes: "01/2026", consumo: 2598 },
      { mes: "02/2026", consumo: 2972 },
      { mes: "03/2026", consumo: 3092 },
      { mes: "04/2026", consumo: 4845 },
      { mes: "05/2026", consumo: 5000 },
    ],
    // última fatura: total pago (já líquido dos créditos de energia solar)
    ultimaFatura: {
      mes: "05/2026",
      consumo: 5000,
      valorTotal: 894.46,
    },
  },
};

// Tarifa efetiva (R$ por unidade) derivada da última fatura.
export function tarifaEfetiva(conta) {
  const uf = conta.ultimaFatura;
  const valor = uf.valorServicos ?? uf.valorTotal ?? 0;
  return uf.consumo ? valor / uf.consumo : 0;
}
