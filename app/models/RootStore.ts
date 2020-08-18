import AsyncStorage from "@react-native-community/async-storage"
import { values } from "mobx"
import { Instance, types, flow, getEnv } from "mobx-state-tree"
import moment from "moment"
import { localStorageMixin } from "mst-gql"
import { AccountType, CurrencyType } from "../utils/enum"
import { Token } from "../utils/token"
import { RootStoreBase } from "./RootStore.base"
import { TransactionModel } from "./TransactionModel"
import { map, filter, sumBy } from "lodash"
import analytics from '@react-native-firebase/analytics';

export const ROOT_STATE_STORAGE_KEY = "rootAppGaloy"


export interface RootStoreType extends Instance<typeof RootStore.Type> {}

export const OnboardingModel = types.model("Onboarding", {
  getStarted: types.optional(types.boolean, false),
}).actions(self => ({
  getStartedCompleted() { self.getStarted = true },
}))
  
export const RootStore = RootStoreBase
.extend(
  localStorageMixin({
    storage: AsyncStorage,
    // throttle: 1000,
    storageKey: ROOT_STATE_STORAGE_KEY
}))
.props({
  onboarding: types.optional(OnboardingModel, {}),
  accountRefresh: types.optional(types.boolean, false), // used to refresh the account screen
  modalClipboardVisible: types.optional(types.boolean, false),
})
.actions(self => {
  // This is an auto-generated example action.
  const log = () => {
    console.log(JSON.stringify(self))
  }

  const setModalClipboardVisible = (value) => {
    self.modalClipboardVisible = value
  }

  const earnComplete = async (id) => {
    const earn = self.earns.get(id)
    if (earn.completed) {
      return
    }

    const token = new Token().has()

    analytics().logEvent('earn', {
      id,
      loggedIn: !!token // FIXME: don't know if that is already a given?
    })

    if (!token) {
      earn.completed = true
      self.earns.set(id, earn)
      
      const amount = earn.value
      
      const tx = TransactionModel.create({
        __typename: "Transaction",
        id,
        amount,
        description: id,
        created_at: moment().unix(),
        hash: null,
        type: "earn"
      })
      
      self.transactions.set(id, tx)
      console.tron.log("transaction:", self.transactions)
      
      self.wallet("BTC").transactions.push(id)
      self.wallet("BTC").balance += amount
    } else {
      await self.mutateEarnCompleted({ids: [id]}, "__typename, id, completed")
      await self.queryWallet()
    }
  }

  const loginSuccessful = flow(function*() {
    analytics().logLogin({ method: "phone" })

    getEnv(self).gqlHttpClient.setHeaders({authorization: new Token().bearerString})

    // sync the earned quizzes
    const ids = map(filter(values(self.earns), {completed: true}), "id")
    yield self.mutateEarnCompleted({ids})

    console.tron.log("succesfully update earns id")
    
    self.transactions.clear()
    self.wallets.get("BTC").transactions.clear()
    
    console.tron.log("cleared local transactions")
    self.accountRefresh = !self.accountRefresh

    // FIXME
    // self.users.delete("incognito")
    console.tron.log("home query done")
  })

  return { log, earnComplete, loginSuccessful, setModalClipboardVisible }
})
.views((self) => ({
  // workaround on the fact key can't be enum
  rate(currency: CurrencyType) {
    if (currency === CurrencyType.USD) {
      return 1
    } else if (currency === CurrencyType.BTC) {
      const p = values(self.prices)
      if (p.length > 0) {
        return p[p.length - 1].o
      } else {
        return 1 // FIXME
      }
    } else {
      throw Error(`currency ${currency} doesn't exist`)
    }
  },
  get user() {
    const users = values(self.users)
    // FIXME dirty way to manage incognito user
    return  users[users.length - 1]
  },
  get earnedSat() {
    return sumBy(filter(values(self.earns), {completed: true}), "value")
  },
  wallet(currency) {
    return values(self.wallets).filter(item => item.currency === currency)[0]
  },
  balance(currency) {
    const wallet = self.wallet(currency)
    return wallet.balance
  },
  balances({ currency, account }) {
    const balances = {}

    const btcConversion = self.rate("BTC") / self.rate(currency)

    balances[AccountType.Bitcoin] = self.balance("BTC") * btcConversion
    balances[AccountType.Bank] = self.balance("USD") / self.rate(currency)
    balances[AccountType.BankAndBitcoin] =
      balances[AccountType.Bank] + balances[AccountType.Bitcoin]

    return balances[account]
  },
}))
  // return in BTC instead of SAT
  // get getInBTC() {
  //   return (self.BTC * Math.pow(10, 8))
  // }