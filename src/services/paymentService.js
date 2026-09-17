const { SquareClient, SquareEnvironment } = require('square')
const { randomUUID } = require('crypto')
const prisma = require('../config/db')
const { adjustTokens } = require('./tokenService')
const { sendEmail } = require('./emailService')

function getSquareClient() {
  if (!process.env.SQUARE_ACCESS_TOKEN) return null
  return new SquareClient({
    token: process.env.SQUARE_ACCESS_TOKEN,
    environment:
      process.env.SQUARE_ENVIRONMENT === 'production'
        ? SquareEnvironment.Production
        : SquareEnvironment.Sandbox,
  })
}

async function purchaseTokenPackage({ user, packageId, sourceId }) {
  const tokenPackage = await prisma.tokenPackage.findUnique({ where: { id: packageId } })
  if (!tokenPackage || !tokenPackage.isActive) {
    throw new Error('Token package not found')
  }

  if (!user.professional) {
    throw new Error('Only professionals can purchase tokens')
  }

  const paymentsEnabled =
    process.env.PAYMENTS_ENABLED === 'true' && Boolean(process.env.SQUARE_ACCESS_TOKEN)

  let providerPaymentId = `dev_${randomUUID()}`
  let status = 'COMPLETED'

  if (paymentsEnabled) {
    const client = getSquareClient()
    const payment = await client.payments.create({
      sourceId,
      idempotencyKey: randomUUID(),
      amountMoney: {
        amount: BigInt(tokenPackage.priceCents),
        currency: tokenPackage.currency || 'GBP',
      },
      locationId: process.env.SQUARE_LOCATION_ID,
      note: `Token package: ${tokenPackage.name}`,
    })

    providerPaymentId = payment.payment?.id || providerPaymentId
    status = payment.payment?.status === 'COMPLETED' ? 'COMPLETED' : 'PENDING'
  }

  const paymentRow = await prisma.payment.create({
    data: {
      userId: user.id,
      packageId: tokenPackage.id,
      amountCents: tokenPackage.priceCents,
      currency: tokenPackage.currency,
      status,
      provider: 'square',
      providerPaymentId,
      meta: { tokens: tokenPackage.tokens, mocked: !paymentsEnabled },
    },
  })

  if (status === 'COMPLETED') {
    await adjustTokens({
      professionalId: user.professional.id,
      amount: tokenPackage.tokens,
      type: 'PURCHASE',
      reference: paymentRow.id,
      meta: { packageId: tokenPackage.id },
    })

    await sendEmail({
      to: user.email,
      userId: user.id,
      templateKey: 'token_purchase',
      type: 'TOKEN_PURCHASE',
      title: 'Token purchase successful',
      body: `You purchased ${tokenPackage.tokens} tokens.`,
      vars: {
        packageName: tokenPackage.name,
        tokens: tokenPackage.tokens,
      },
    })
  }

  return { payment: paymentRow, tokensAdded: status === 'COMPLETED' ? tokenPackage.tokens : 0 }
}

module.exports = { purchaseTokenPackage, getSquareClient }
