export function createCrudController({ model, createSchema, updateSchema }) {
  return {
    list: async (req, res) => { const data = await model.findMany({ orderBy: { id: 'desc' } }); res.json(data); },
    getById: async (req, res) => { const id = BigInt(req.params.id); const data = await model.findUnique({ where: { id } }); if (!data) return res.status(404).json({ message: 'Registro não encontrado.' }); res.json(data); },
    create: async (req, res) => { const payload = createSchema.parse(req.body); const data = await model.create({ data: payload }); res.status(201).json(data); },
    update: async (req, res) => { const id = BigInt(req.params.id); const payload = updateSchema.parse(req.body); const data = await model.update({ where: { id }, data: payload }); res.json(data); },
  };
}