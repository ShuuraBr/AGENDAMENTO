import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const adminProfile = await prisma.perfil.upsert({
    where: { nome: "ADMIN" },
    update: {},
    create: { nome: "ADMIN", descricao: "Administrador" }
  });

  await prisma.perfil.upsert({
    where: { nome: "GESTOR_LOGISTICO" },
    update: {},
    create: { nome: "GESTOR_LOGISTICO", descricao: "Gestor Logístico" }
  });

  await prisma.perfil.upsert({
    where: { nome: "OPERADOR_RECEBIMENTO" },
    update: {},
    create: { nome: "OPERADOR_RECEBIMENTO", descricao: "Operador" }
  });

  const senhaHash = await bcrypt.hash("123456", 10);

  await prisma.usuario.upsert({
    where: { email: "admin@local.test" },
    update: {},
    create: {
      nome: "Administrador",
      email: "admin@local.test",
      senhaHash,
      perfilId: adminProfile.id
    }
  });

  const unidade = await prisma.unidade.upsert({
    where: { codigo: "CD-01" },
    update: {},
    create: { codigo: "CD-01", nome: "Centro de Distribuição 01" }
  });

  const doca1 = await prisma.doca.upsert({
    where: { unidadeId_codigo: { unidadeId: unidade.id, codigo: "DOCA-01" } },
    update: {},
    create: { unidadeId: unidade.id, codigo: "DOCA-01", descricao: "Doca principal" }
  });

  await prisma.regraAgendamento.create({
    data: {
      unidadeId: unidade.id,
      permiteAprovacaoAutomatica: true,
      toleranciaAtrasoMin: 15,
      tempoDescargaPrevistoMin: 60
    }
  }).catch(() => {});

  const hoje = new Date();
  hoje.setHours(0,0,0,0);

  await prisma.janelaAgendamento.createMany({
    data: [
      {
        unidadeId: unidade.id,
        docaId: doca1.id,
        dataAgendamento: hoje,
        horaInicio: "08:00",
        horaFim: "09:00",
        capacidadeMaxima: 2,
        capacidadeOcupada: 0,
        status: "DISPONIVEL"
      },
      {
        unidadeId: unidade.id,
        docaId: doca1.id,
        dataAgendamento: hoje,
        horaInicio: "09:00",
        horaFim: "10:00",
        capacidadeMaxima: 2,
        capacidadeOcupada: 0,
        status: "DISPONIVEL"
      }
    ]
  }).catch(() => {});

  await prisma.fornecedor.create({
    data: {
      razaoSocial: "Fornecedor Exemplo LTDA",
      cnpj: "11111111000111",
      email: "fornecedor@test.com",
      whatsapp: "+5500000000001"
    }
  }).catch(() => {});

  const transportadora = await prisma.transportadora.create({
    data: {
      razaoSocial: "Transportadora Exemplo",
      cnpj: "22222222000122",
      email: "transportadora@test.com",
      whatsapp: "+5500000000002"
    }
  }).catch(async () => prisma.transportadora.findFirst());

  if (transportadora) {
    await prisma.motorista.create({
      data: {
        nome: "Motorista Exemplo",
        transportadoraId: transportadora.id,
        cpf: "12345678900",
        whatsapp: "+5500000000003",
        email: "motorista@test.com"
      }
    }).catch(() => {});

    await prisma.veiculo.create({
      data: {
        transportadoraId: transportadora.id,
        tipoVeiculo: "Truck",
        placaCavalo: "ABC1D23"
      }
    }).catch(() => {});
  }

  console.log("Seed concluído. Usuário: admin@local.test | Senha: 123456");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
