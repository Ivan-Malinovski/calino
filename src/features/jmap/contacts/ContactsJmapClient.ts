import { JmapClient } from '../client/JmapClient'
import { JmapError } from '../client/errors'
import { JMAP_CONTACTS } from '../types'

/** Keeps blob upload/download in the contacts account, including contacts-only sessions. */
export class ContactsJmapClient extends JmapClient {
  override get accountId(): string {
    const session = this.session
    const primary = session.primaryAccounts[JMAP_CONTACTS]
    const id =
      primary ??
      Object.keys(session.accounts).find(
        (key) => session.accounts[key].accountCapabilities[JMAP_CONTACTS]
      )
    if (
      !session.capabilities[JMAP_CONTACTS] ||
      !id ||
      !session.accounts[id]?.accountCapabilities[JMAP_CONTACTS]
    )
      throw new JmapError('JMAP session has no contacts account', {
        type: 'accountNotFound',
        status: 404,
      })
    return id
  }
}
