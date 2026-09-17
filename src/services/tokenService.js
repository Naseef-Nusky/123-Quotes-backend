const prisma = require('../config/db')
const { sendEmail } = require('./emailService')

async function adjustTokens({ professionalId, amount, type, reference, meta }) {
  const professional = await prisma.professionalProfile.findUnique({
    where: { id: professionalId },
    include: { user: true },
  })
  if (!professional) throw new Error('Professional not found')

  const nextBalance = professional.tokenBalance + amount
  if (nextBalance < 0) throw new Error('Insufficient tokens')

  const updated = await prisma.$transaction(async (tx) => {
    const pro = await tx.professionalProfile.update({
      where: { id: professionalId },
      data: { tokenBalance: nextBalance },
    })

    await tx.tokenTransaction.create({
      data: {
        professionalId,
        type,
        amount,
        balanceAfter: nextBalance,
        reference: reference || null,
        meta: meta || undefined,
      },
    })

    return pro
  })

  const threshold = Number(process.env.LOW_TOKEN_THRESHOLD || 3)
  if (updated.tokenBalance <= threshold && amount < 0) {
    await sendEmail({
      to: professional.user.email,
      userId: professional.userId,
      templateKey: 'low_token',
      type: 'LOW_TOKEN',
      title: 'Low token balance',
      body: `Your token balance is ${updated.tokenBalance}. Purchase more tokens to unlock leads.`,
      vars: { balance: updated.tokenBalance },
    })
  }

  return updated
}

async function unlockLead({ leadId, professionalId }) {
  const existing = await prisma.leadUnlock.findUnique({
    where: { leadId_professionalId: { leadId, professionalId } },
  })
  if (existing) return { alreadyUnlocked: true, unlock: existing }

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      request: { include: { customer: { include: { user: true } }, answers: { include: { question: true } } } },
      service: true,
    },
  })
  if (!lead) throw new Error('Lead not found')

  const match = await prisma.leadMatch.findUnique({
    where: { leadId_professionalId: { leadId, professionalId } },
  })
  if (!match) throw new Error('Lead is not matched to this professional')

  const cost = lead.tokenCost || lead.service.tokenCost || 1

  await adjustTokens({
    professionalId,
    amount: -cost,
    type: 'UNLOCK',
    reference: leadId,
    meta: { leadId, cost },
  })

  const unlock = await prisma.leadUnlock.create({
    data: { leadId, professionalId, tokensSpent: cost },
  })

  await prisma.leadMatch.update({
    where: { id: match.id },
    data: { status: 'UNLOCKED', unlockedAt: new Date() },
  })

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      unlockedCount: { increment: 1 },
      status: 'PARTIALLY_UNLOCKED',
    },
  })

  const professional = await prisma.professionalProfile.findUnique({
    where: { id: professionalId },
    include: { user: true },
  })

  await sendEmail({
    to: professional.user.email,
    userId: professional.userId,
    templateKey: 'lead_unlocked',
    type: 'LEAD_UNLOCKED',
    title: 'Lead unlocked',
    body: 'Customer contact details are now available.',
    vars: {
      customerName: `${lead.request.customer.firstName} ${lead.request.customer.lastName}`,
      customerEmail: lead.request.customer.user.email,
      customerPhone: lead.request.customer.phone || '',
    },
  })

  return { unlock, lead, cost }
}

module.exports = { adjustTokens, unlockLead }
