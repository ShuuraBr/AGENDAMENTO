import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const senhaHash = await bcrypt.hash("123456", 10);

  await prisma.usuario.upsert({
    where: { email: "admin@local.test" },
    update: {},
    create: {
      nome: "Administrador",
      email: "admin@local.test",
      senhaHash,
      perfil: "ADMIN"
    }
  });

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

  await prisma.doca.create({ data: { codigo: "DOCA-01", descricao: "Doca principal" } }).catch(() => {});
  await prisma.janela.create({ data: { codigo: "08:00-09:00", descricao: "Janela manhã 1" } }).catch(() => {});
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
      placa: "ABC1D23",
      doca: "DOCA-01",
      janela: "08:00-09:00",
      dataAgendada: "2026-03-27",
      horaAgendada: "08:00",
      quantidadeNotas: 2,
      quantidadeVolumes: 14,
      status: "APROVADO",
      observacoes: "Carga agendada para teste",
      lgpdConsentAt: new Date()
    }
  }).catch(async () => prisma.agendamento.findUnique({ where: { protocolo: "AGD-EXEMPLO-1" } }));

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

  console.log("Seed concluído. Usuário: admin@local.test | Senha: 123456");
}

main().finally(async () => prisma.$disconnect());
