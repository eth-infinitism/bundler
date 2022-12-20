import { TransactionReceipt } from '@ethersproject/providers'
import { formatUnits } from 'ethers/lib/utils'
import { Stripe } from 'stripe'
import { getLatestPrice } from './chainlink'
import {
  checkShouldChargeForOverages,
  getStripeIdByProjectId,
  saveUsageRecordMetadata
} from './db'

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2022-11-15'
})

export const getSubscriptionId = async (
  stripeId: string
): Promise<{ subscriptionId: string, mau: number, startingDate: number }> => {
  // get the stripe subscriptions for the user
  const subscriptions = await stripe.subscriptions.list({
    customer: stripeId,
    status: 'active'
  })
  if (subscriptions.data.length === 0) {
    throw new Error('No active subscriptions found for the project ID')
  }

  const subscription = subscriptions.data[0]
  const startingDate = subscriptions.data[0].current_period_start

  // find the user's plan, if they dont have one then they are on the free plan
  let mau = 100 // default for free plan
  const plan = subscription.items.data.find(
    (s) => s.price.metadata.type === 'plan'
  )
  if (plan != null) {
    mau = parseInt(plan.price.metadata.mau)
  }

  return {
    subscriptionId: subscription.id,
    mau,
    startingDate
  }
}

export const getSubscriptionItem = async (
  subscriptionId: string,
  chainId: number
): Promise<string> => {
  // get stripe subscription item ids from the subscription
  const subscriptionItems = await stripe.subscriptionItems.list({
    subscription: subscriptionId
  })
  if (subscriptionItems.data.length === 0) {
    const subscriptionItem = await createSubscriptionItem(
      subscriptionId,
      chainId
    )
    subscriptionItems.data.push(subscriptionItem)
    throw new Error('No subscription items found for user')
  }

  // find the correct subscription item based on the chainId metadata
  let subscriptionItem = subscriptionItems.data.find(
    (item) => item.price.metadata.chainId === chainId.toString()
  )
  if (subscriptionItem == null) {
    subscriptionItem = await createSubscriptionItem(subscriptionId, chainId)
  }

  return subscriptionItem.id
}

const createSubscriptionItem = async (
  subscriptionId: string,
  chainId: number
): Promise<Stripe.SubscriptionItem> => {
  const price = await stripe.prices.search({
    query: `active:'true' AND metadata['chainId']:'${chainId}'`
  })
  if (price.data.length === 0) {
    throw new Error('No price found for chainId')
  }

  return stripe.subscriptionItems.create({
    subscription: subscriptionId,
    price: price.data[0].id
  })
}

const createOverageSubscriptionItem = async (
  subscriptionId: string
): Promise<Stripe.SubscriptionItem> => {
  const price = await stripe.prices.search({
    query: "active:'true' AND metadata['type']:'overage'"
  })
  if (price.data.length === 0) {
    throw new Error('No price found for overages')
  }

  return stripe.subscriptionItems.create({
    subscription: subscriptionId,
    price: price.data[0].id
  })
}

export const chargeOverages = async (
  stripeSubscriptionId: string
): Promise<void> => {
  const subscriptionItemIds = await stripe.subscriptionItems.list({
    subscription: stripeSubscriptionId
  })

  // find the ovarges subscription item or create it if it doesn't exist
  let subscriptionItem = subscriptionItemIds.data.find(
    (item) => item.price.metadata.type === 'overage'
  )
  if (subscriptionItem == null) {
    subscriptionItem = await createOverageSubscriptionItem(
      stripeSubscriptionId
    )
  }

  // charge the user
  await stripe.subscriptionItems.createUsageRecord(subscriptionItem.id, {
    quantity: 1,
    timestamp: 'now'
  })
}

export const trackUsage = async (
  projectId: string,
  chainId: number,
  sender: string,
  receiptPromise: Promise<TransactionReceipt>
): Promise<void> => {
  const stripeId = await getStripeIdByProjectId(projectId)

  const { subscriptionId, mau, startingDate } = await getSubscriptionId(
    stripeId
  )

  const subscriptionItemId = await getSubscriptionItem(subscriptionId, chainId)

  // charge for overages if mau exceeds plan limit
  const chargeForOverages = await checkShouldChargeForOverages(
    subscriptionItemId,
    mau,
    startingDate
  )
  if (chargeForOverages) {
    await chargeOverages(subscriptionId)
  }

  const receipt = await receiptPromise
  const totalGasWei = receipt.gasUsed.mul(receipt.effectiveGasPrice)
  const totalGasEth = parseFloat(formatUnits(totalGasWei, 'ether'))
  const latestPrice = await getLatestPrice(chainId)
  const totalUnits = Math.floor(totalGasEth * (latestPrice / 10 ** 8) * 100)

  // if the price is 0 then we don't track usage
  if (latestPrice !== 0) {
    await stripe.subscriptionItems.createUsageRecord(subscriptionItemId, {
      quantity: totalUnits,
      timestamp: 'now'
    })

    await saveUsageRecordMetadata(subscriptionItemId, sender)
  }
}
