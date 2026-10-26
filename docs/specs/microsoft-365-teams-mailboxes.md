# Spec: Microsoft 365 (Outlook, shared mailboxes and Teams) for Sloane

For whoever administers the Microsoft 365 tenant(s), and the developer. Developer-only; not for Kirsty.

## Where things stand

- Outlook is connected through an Azure app registration. Scopes today: `offline_access Mail.Read Calendars.Read openid profile email`, so Sloane can **read** the diary and flagged emails of the one connected account. It cannot write, send, or read Teams, and it does not read shared mailboxes.
- Nothing about Teams exists in Sloane yet.

## What the owner asked for, and what each needs

| Wanted | Microsoft permission (delegated unless noted) | Admin consent? |
|---|---|---|
| Read mail in more than one account | Same sign-in repeated for each account, stored separately (Sloane work) | Per tenant |
| Read shared mailboxes | `Mail.Read.Shared`, `Calendars.Read.Shared` (the signed-in person needs access to the mailbox) | Usually no |
| Draft replies for approval (never sent by Sloane) | `Mail.ReadWrite` (creates drafts in the person's Drafts folder; she sends them herself) | No, but a bigger permission than today |
| Read Teams chats and channels | `Chat.Read`, `ChannelMessage.Read.All`, `Team.ReadBasic.All`, `Channel.ReadBasic.All` | **Yes**, a tenant admin must approve |
| Be told when something new arrives | Microsoft Graph change notifications (a subscription that needs a public HTTPS address; Railway provides one) | Same permissions as above |
| Add meetings and tasks to the calendar | `Calendars.ReadWrite` (only if she wants Sloane to add entries) | No |

Posting in Teams, or sending email on her behalf, is deliberately **not** on the list: that stays her decision (see "always asks first" in Settings).

## Decisions needed before building

1. **Which tenants?** Are TriNova Accounting, CFI Awarding, Emerald Education and MTDflow in one Microsoft 365 tenant or several? Each tenant needs its own admin consent, and an app registered as multi-tenant (or one registration per tenant).
2. **Which mailboxes and Teams?** A list of the shared mailboxes and the Teams / channels Sloane should read. Reading is limited to what the signed-in person can already see.
3. **Who signs in?** Sloane reads as the person who signs in (delegated). Using application permissions (reads every mailbox in the tenant) is a much larger permission and is not recommended.
4. **Admin consent.** Someone with the Global Administrator or Privileged Role Administrator role must approve the Teams permissions once per tenant.

## How it would work in Sloane (to build after the answers)

- A connections list in Settings: one row per account (name, tenant, what is read, connected on, Disconnect). Tokens are stored encrypted (AES-256-GCM, as today).
- Each business is tied to the accounts, mailboxes and Teams it uses, so a question about Emerald Education only reads Emerald's sources and respects the separate permissions the owner asked for.
- Reading stays in the browser or server on demand; Sloane keeps only what it needs (subject, sender, time, a short preview, a link back to the original), not full message bodies.
- Finding work: the "Ask Sloane" pasted-text finder already turns promises and requests into proposed tasks. Pointing it at flagged emails and chosen Teams messages is the next step; each proposal still needs her approval.
- Alerts: a Graph subscription tells Sloane when mail arrives in a watched mailbox, and Sloane raises an alert only for rules she has agreed (for example, a client email marked high importance).

## Not possible yet / honest limits

- Alerts when Sloane is fully closed on a phone need Web Push (VAPID keys and a push endpoint); only alerts while it is open or on the Home Screen exist today.
- Sloane cannot read anything it has no permission for, and cannot tell whether an email was answered unless it can read the thread.
