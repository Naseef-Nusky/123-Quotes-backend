const prisma = require('../config/db')
const { asyncHandler, ok, fail } = require('../utils/helpers')

const getQuestionnaire = asyncHandler(async (req, res) => {
  const questions = await prisma.question.findMany({
    where: { serviceId: req.params.serviceId, isActive: true },
    orderBy: { sortOrder: 'asc' },
    include: {
      options: { orderBy: { sortOrder: 'asc' } },
      branchesFrom: true,
    },
  })
  return ok(res, { questions })
})

const adminListQuestions = asyncHandler(async (req, res) => {
  const questions = await prisma.question.findMany({
    where: req.query.serviceId ? { serviceId: req.query.serviceId } : undefined,
    include: { options: true, branchesFrom: true, service: true },
    orderBy: [{ serviceId: 'asc' }, { sortOrder: 'asc' }],
  })
  return ok(res, { questions })
})

const adminCreateQuestion = asyncHandler(async (req, res) => {
  const { serviceId, label, helpText, type, isRequired, sortOrder, options = [], branches = [] } = req.body
  if (!serviceId || !label || !type) return fail(res, 'serviceId, label and type are required')

  const question = await prisma.question.create({
    data: {
      serviceId,
      label,
      helpText,
      type,
      isRequired: isRequired !== false,
      sortOrder: sortOrder || 0,
      options: {
        create: options.map((o, idx) => ({
          label: o.label,
          value: o.value || o.label,
          sortOrder: o.sortOrder ?? idx,
        })),
      },
    },
    include: { options: true },
  })

  if (branches.length) {
    await prisma.questionBranch.createMany({
      data: branches.map((b) => ({
        sourceQuestionId: question.id,
        targetQuestionId: b.targetQuestionId,
        optionId: b.optionId || null,
        operator: b.operator || 'EQUALS',
        value: b.value || null,
      })),
    })
  }

  const full = await prisma.question.findUnique({
    where: { id: question.id },
    include: { options: true, branchesFrom: true },
  })

  return ok(res, { question: full }, 201)
})

const adminUpdateQuestion = asyncHandler(async (req, res) => {
  const { label, helpText, type, isRequired, sortOrder, isActive, options } = req.body
  const question = await prisma.question.update({
    where: { id: req.params.id },
    data: { label, helpText, type, isRequired, sortOrder, isActive },
  })

  if (Array.isArray(options)) {
    await prisma.answerOption.deleteMany({ where: { questionId: question.id } })
    await prisma.answerOption.createMany({
      data: options.map((o, idx) => ({
        questionId: question.id,
        label: o.label,
        value: o.value || o.label,
        sortOrder: o.sortOrder ?? idx,
      })),
    })
  }

  const full = await prisma.question.findUnique({
    where: { id: question.id },
    include: { options: true, branchesFrom: true },
  })
  return ok(res, { question: full })
})

const adminDeleteQuestion = asyncHandler(async (req, res) => {
  const existing = await prisma.question.findUnique({ where: { id: req.params.id } })
  if (!existing) return fail(res, 'Question not found', 404)

  // Soft-delete to preserve historical answers
  await prisma.question.update({
    where: { id: req.params.id },
    data: { isActive: false },
  })
  return ok(res, { message: 'Question deleted', id: req.params.id, soft: true })
})

const adminCreateBranch = asyncHandler(async (req, res) => {
  const { sourceQuestionId, targetQuestionId, optionId, operator, value } = req.body
  const branch = await prisma.questionBranch.create({
    data: { sourceQuestionId, targetQuestionId, optionId, operator: operator || 'EQUALS', value },
  })
  return ok(res, { branch }, 201)
})

module.exports = {
  getQuestionnaire,
  adminListQuestions,
  adminCreateQuestion,
  adminUpdateQuestion,
  adminDeleteQuestion,
  adminCreateBranch,
}
