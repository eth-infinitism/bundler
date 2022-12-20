import * as dotenv from 'dotenv'
import { NotFoundError, createSqlTag, createPool } from 'slonik'
import z from 'zod'

dotenv.config()

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
export const db = createPool(process.env.DB_URL!)

const sql = createSqlTag({
  typeAliases: {
    void: z.object({}).strict(),
    stripeId: z.object({
      id: z.string()
    }),
    count: z.object({
      count: z.number()
    })
  }
})

export const getStripeIdByProjectId = async (projectId: string): Promise<string> => {
  // get stripe id from database
  try {
    const stripeId = await (
      await db
    ).oneFirst(
      sql.typeAlias('stripeId')`
        SELECT stripe_id
        FROM billing.users_stripe
        INNER JOIN projects
          ON projects.user_id = billing.users_stripe.user_id
        WHERE projects.id = ${projectId}
      `
    )

    return stripeId
  } catch (e: any) {
    if (e instanceof NotFoundError) {
      throw new Error('This project does not exist')
    } else {
      throw e
    }
  }
}

export const saveUsageRecordMetadata = async (
  stripeSubscriptionItemId: string,
  sender: string
): Promise<void> => {
  await (
    await db
  ).query(
    sql.typeAlias('void')`
      INSERT INTO billing.usage_records (stripe_subscription_item_id, sender)
      VALUES (${stripeSubscriptionItemId}, ${sender})
    `
  )
}

export const checkShouldChargeForOverages = async (
  subscriptionItemId: string,
  mau: number,
  startingDate: number
): Promise<boolean> => {
  const count = await (
    await db
  ).oneFirst(
    sql.typeAlias('count')`
     select count(*)
      from (
        select distinct stripe_subscription_item_id, sender
        from billing.usage_records
        where stripe_subscription_item_id = ${subscriptionItemId}
          and extract(epoch from time) > ${startingDate}
      ) t
    `
  )

  const shouldCharge = count > mau

  return shouldCharge
}
