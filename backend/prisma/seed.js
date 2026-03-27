import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

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
    update: {},
    create: { codigo, descricao }
  });
}

async function ensureJanela(codigo, descricao) {
  return prisma.janela.upsert({
    where: { codigo },
    update: {},
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
    update: {},
    create: { nome: "Fornecedor Exemplo LTDA", cnpj: "11.111.111/0001-11", email: "fornecedor@test.com" }
  });

  await prisma.transportadora.upsert({
    where: { cnpj: "22.222.222/0001-22" },
    update: {},
    create: { nome: "Transportadora Exemplo", cnpj: "22.222.222/0001-22", email: "transportadora@test.com" }
  });

  await prisma.motorista.create({
    data: { nome: "Motorista Exemplo", cpf: "12345678900", telefone: "61999999999", transportadora: "Transportadora Exemplo" }
  }).catch(() => {});
  await prisma.veiculo.create({
    data: { placa: "ABC1D23", tipo: "Truck", transportadora: "Transportadora Exemplo" }
  }).catch(() => {});

  const doca1 = await ensureDoca("DOCA-01", "Doca principal");
  const doca2 = await ensureDoca("DOCA-02", "Doca secundária");
  const janela1 = await ensureJanela("08:00-09:00", "Janela manhã 1");
  const janela2 = await ensureJanela("09:00-10:00", "Janela manhã 2");
  await prisma.regra.create({ data: { nome: "Padrão", toleranciaAtrasoMin: 15, tempoDescargaPrevistoMin: 60 } }).catch(() => {});

  const ag = await prisma.agendamento.create({
    data: {
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
      dataAgendada: "2026-03-27",
      horaAgendada: "08:00",
      quantidadeNotas: 2,
      quantidadeVolumes: 14,
      status: "APROVADO",
      observacoes: "Carga agendada para teste",
      lgpdConsentAt: new Date()
    }
  }).catch(async () => prisma.agendamento.findUnique({ where: { protocolo: "AGD-EXEMPLO-1" } }));

  await prisma.agendamento.create({
    data: {
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
      dataAgendada: "2026-03-27",
      horaAgendada: "09:00",
      quantidadeNotas: 1,
      quantidadeVolumes: 5,
      status: "CHEGOU",
      observacoes: "Na fila da doca",
      lgpdConsentAt: new Date()
    }
  }).catch(() => {});

  if (ag) {
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
  }

  console.log("Seed concluído.");
  console.log("ADMIN: admin@local.test / 123456");
  console.log("OPERADOR: operador@local.test / 123456");
  console.log("PORTARIA: portaria@local.test / 123456");
  console.log("GESTOR: gestor@local.test / 123456");
}

main().finally(async () => prisma.$disconnect());
