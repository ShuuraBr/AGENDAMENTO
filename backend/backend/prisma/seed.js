import bcrypt from "bcryptjs";
import prismaPkg from "@prisma/client";

const { PrismaClient } = prismaPkg;
const prisma = new PrismaClient();

async function ensureUser(email, nome, perfil) {
  const senhaHash = await bcrypt.hash("123456", 10);
  await prisma.usuario.upsert({
    where: { email },
    update: { perfil },
    create: { nome, email, senhaHash, perfil }
  });
}

async function ensureDoca(codigo, descricao) {
  return prisma.doca.upsert({
    where: { codigo },
    update: { descricao },
    create: { codigo, descricao }
  });
}

async function ensureJanela(codigo, descricao) {
  return prisma.janela.upsert({
    where: { codigo },
    update: { descricao },
    create: { codigo, descricao }
  });
}

async function main() {
  await ensureUser("admin@local.test", "Administrador", "ADMIN");
  await ensureUser("operador@local.test", "Operador", "OPERADOR");
  await ensureUser("portaria@local.test", "Portaria", "PORTARIA");
  await ensureUser("gestor@local.test", "Gestor", "GESTOR");

  await prisma.fornecedor.upsert({
    where: { cnpj: "11.111.111/0001-11" },
    update: { nome: "Fornecedor Exemplo LTDA", email: "fornecedor@test.com" },
    create: { nome: "Fornecedor Exemplo LTDA", cnpj: "11.111.111/0001-11", email: "fornecedor@test.com", telefone: "6133334444" }
  });

  await prisma.transportadora.upsert({
    where: { cnpj: "22.222.222/0001-22" },
    update: { nome: "Transportadora Exemplo", email: "transportadora@test.com" },
    create: { nome: "Transportadora Exemplo", cnpj: "22.222.222/0001-22", email: "transportadora@test.com", telefone: "6144445555" }
  });

  await prisma.motorista.upsert({
    where: { id: 1 },
    update: { nome: "Motorista Exemplo", cpf: "12345678900", telefone: "61999999999", transportadora: "Transportadora Exemplo" },
    create: { nome: "Motorista Exemplo", cpf: "12345678900", telefone: "61999999999", transportadora: "Transportadora Exemplo" }
  }).catch(() => {});

  await prisma.veiculo.upsert({
    where: { placa: "ABC1D23" },
    update: { tipo: "Truck", transportadora: "Transportadora Exemplo" },
    create: { placa: "ABC1D23", tipo: "Truck", transportadora: "Transportadora Exemplo" }
  });

  const docaDefinir = await ensureDoca("A DEFINIR", "Doca definida pelo operador no recebimento");
  const doca1 = await ensureDoca("DOCA-01", "Doca principal");
  const doca2 = await ensureDoca("DOCA-02", "Doca secundária");
  const janela1 = await ensureJanela("08:00-09:00", "Janela manhã 1");
  const janela2 = await ensureJanela("09:00-10:00", "Janela manhã 2");
  const janela3 = await ensureJanela("10:00-11:00", "Janela manhã 3");
  await prisma.regra.create({ data: { nome: "Padrão", toleranciaAtrasoMin: 15, tempoDescargaPrevistoMin: 60 } }).catch(() => {});

  const ag = await prisma.agendamento.upsert({
    where: { protocolo: "AGD-EXEMPLO-1" },
    update: {},
    create: {
      protocolo: "AGD-EXEMPLO-1",
      publicTokenMotorista: "MOT-EXEMPLO-1",
      publicTokenFornecedor: "FOR-EXEMPLO-1",
      checkinToken: "CHK-EXEMPLO-1",
      fornecedor: "Fornecedor Exemplo LTDA",
      transportadora: "Transportadora Exemplo",
      motorista: "Motorista Exemplo",
      telefoneMotorista: "61999999999",
      emailMotorista: "motorista@test.com",
      emailTransportadora: "transportadora@test.com",
      placa: "ABC1D23",
      docaId: doca1.id,
      janelaId: janela1.id,
      dataAgendada: new Date().toISOString().slice(0, 10),
      horaAgendada: "08:00",
      quantidadeNotas: 2,
      quantidadeVolumes: 14,
      status: "APROVADO",
      observacoes: "Carga agendada para teste",
      lgpdConsentAt: new Date()
    }
  });

  await prisma.agendamento.upsert({
    where: { protocolo: "AGD-EXEMPLO-2" },
    update: {},
    create: {
      protocolo: "AGD-EXEMPLO-2",
      publicTokenMotorista: "MOT-EXEMPLO-2",
      publicTokenFornecedor: "FOR-EXEMPLO-2",
      checkinToken: "CHK-EXEMPLO-2",
      fornecedor: "Fornecedor Exemplo LTDA",
      transportadora: "Transportadora Exemplo",
      motorista: "Motorista Exemplo 2",
      telefoneMotorista: "61988888888",
      placa: "ZZZ9X99",
      docaId: doca2.id,
      janelaId: janela2.id,
      dataAgendada: new Date().toISOString().slice(0, 10),
      horaAgendada: "09:00",
      quantidadeNotas: 1,
      quantidadeVolumes: 5,
      status: "CHEGOU",
      observacoes: "Na fila da doca",
      lgpdConsentAt: new Date()
    }
  }).catch(() => {});

  await prisma.agendamento.upsert({
    where: { protocolo: "AGD-EXEMPLO-3" },
    update: {},
    create: {
      protocolo: "AGD-EXEMPLO-3",
      publicTokenMotorista: "MOT-EXEMPLO-3",
      publicTokenFornecedor: "FOR-EXEMPLO-3",
      checkinToken: "CHK-EXEMPLO-3",
      fornecedor: "Fornecedor Exemplo LTDA",
      transportadora: "Transportadora Exemplo",
      motorista: "Motorista Exemplo 3",
      telefoneMotorista: "61977777777",
      placa: "AAA0B11",
      docaId: docaDefinir.id,
      janelaId: janela3.id,
      dataAgendada: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      horaAgendada: "10:00",
      quantidadeNotas: 1,
      quantidadeVolumes: 3,
      status: "PENDENTE_APROVACAO",
      observacoes: "Solicitação pública pendente",
      lgpdConsentAt: new Date()
    }
  }).catch(() => {});

  await prisma.notaFiscal.create({
    data: {
      agendamentoId: ag.id,
      numeroNf: "12345",
      serie: "1",
      chaveAcesso: "12345678901234567890123456789012345678901234",
      volumes: 10,
      peso: 150.5,
      valorNf: 1200.75
    }
  }).catch(() => {});

  console.log("Seed concluído.");
  console.log("ADMIN: admin@local.test / 123456");
}

main().finally(async () => prisma.$disconnect());
