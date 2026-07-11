import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { creditUserCoinsByEmail } from '../lib/coins'
import { findOne } from '../lib/supabase'

async function run() {
  try {
    console.log('Finding user7@gmail.com...')
    const user = await findOne('users', { email: 'user7@gmail.com' })
    if (!user) {
      console.error('User user7@gmail.com not found in DB.')
      return
    }
    console.log(`User found: id=${user.id}, current_coins=${user.coins}`)

    console.log('Crediting 100 coins to user7@gmail.com...')
    const nextCoins = await creditUserCoinsByEmail('user7@gmail.com', 100)
    console.log(`Success! New coin balance for user7@gmail.com: ${nextCoins}`)
  } catch (error) {
    console.error('Error crediting coins:', error)
  }
}

run()
