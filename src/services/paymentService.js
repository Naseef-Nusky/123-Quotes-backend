const { SquareClient, SquareEnvironment } = require('square')
const { randomUUID } = require('crypto')
const prisma = require('../config/db')
const { adjustTokens } = require('./tokenService')
const { sendEmail } = require('./emailService')

function paymentsLive() {
  return (
    process.env.PAYMENTS_ENABLED === 'true' &&
    Boolean(process.env.SQUARE_ACCESS_TOKEN) &&
    Boolean(process.env.SQUARE_LOCATION_ID)
  )
}

function getSquareConfig() {
  const environment =
    process.env.SQUARE_ENVIRONMENT === 'production' ? 'production' : 'sandbox'
  return {
    paymentsEnabled: paymentsLive(),
    applicationId: process.env.SQUARE_APPLICATION_ID || '',
    locationId: process.env.SQUARE_LOCATION_ID || '',
    environment,
  }
}

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

function squareErrorMessage(err) {
  const errors =
    err?.errors ||
    err?.body?.errors ||
    err?.result?.errors ||
    (Array.isArray(err?.errors) ? err.errors : null)
  if (Array.isArray(errors) && errors[0]) {
    return errors[0].detail || errors[0].code || err.message
  }
  return err?.message || 'Square payment failed'
}

async function purchaseTokenPackage({ user, packageId, sourceId }) {
  const tokenPackage = await prisma.tokenPackage.findUnique({ where: { id: packageId } })
  if (!tokenPackage || !tokenPackage.isActive) {
    throw new Error('Token package not found')
  }

  if (!user.professional) {
    throw new Error('Only professionals can purchase tokens')
  }

  const live = paymentsLive()
  let providerPaymentId = `dev_${randomUUID()}`
  let status = 'COMPLETED'

  if (live) {
    if (!sourceId || sourceId === 'sandbox-token') {
      throw new Error('Card payment token required. Please complete the Square checkout form.')
    }

    try {
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
        autocomplete: true,
      })

      const created = payment?.payment || payment
      providerPaymentId = created?.id || providerPaymentId
      const payStatus = String(created?.status || '').toUpperCase()
      status = payStatus === 'COMPLETED' || payStatus === 'APPROVED' ? 'COMPLETED' : 'PENDING'
    } catch (err) {
      const message = squareErrorMessage(err)
      console.error('[square:payment]', {
        message,
        packageId,
        environment: process.env.SQUARE_ENVIRONMENT || 'sandbox',
        locationId: process.env.SQUARE_LOCATION_ID,
        applicationId: process.env.SQUARE_APPLICATION_ID,
        errors: err?.errors || err?.body?.errors || err?.result?.errors || null,
      })
      throw new Error(message)
    }
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
      meta: {
        tokens: tokenPackage.tokens,
        mocked: !live,
        environment: process.env.SQUARE_ENVIRONMENT || 'sandbox',
      },
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

  return {
    payment: paymentRow,
    tokensAdded: status === 'COMPLETED' ? tokenPackage.tokens : 0,
    mocked: !live,
  }
}

module.exports = { purchaseTokenPackage, getSquareClient, getSquareConfig, paymentsLive }
