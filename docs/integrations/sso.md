# Single sign-on

CoreTask can let people in three more ways than a password:

- **Continue with Google** — any Google account, personal or Workspace.
- **Continue with Microsoft** — work or school accounts from Entra ID, and
  personal Microsoft accounts.
- **Sign in with SSO** — a workspace's own identity provider over SAML 2.0:
  Okta, Microsoft Entra ID, Google Workspace, OneLogin, JumpCloud, ADFS…

Google and Microsoft are set up once, for the whole server, by whoever runs it.
SAML is set up per workspace, by its admins, in **Settings › Single sign-on**.
How each one decides who is signing in is in
[api/authentication.md](../api/authentication.md#single-sign-on).

Both kinds come back to the API, which sets the session cookie, so the web app
and the API must be on the same site — `app.example.com` and
`api.example.com`, or two ports of `localhost` — just as for the refresh
cookie.

## Google

1. In the [Google Cloud console](https://console.cloud.google.com/), pick or
   create a project, then **APIs & Services › OAuth consent screen**. Choose
   **External** (anyone with a Google account) or **Internal** (only your
   Workspace), give the app its name, support address and logo, and add the
   scopes `openid`, `email` and `profile` — nothing else is needed.
2. **APIs & Services › Credentials › Create credentials › OAuth client ID**,
   type **Web application**. Under **Authorized redirect URIs** add

   ```
   <API_URL>/api/v1/auth/sso/google/callback
   ```

   with `API_URL` exactly as the API's `.env` has it, e.g.
   `https://api.example.com/api/v1/auth/sso/google/callback`, or
   `http://localhost:3010/api/v1/auth/sso/google/callback` while developing.

3. Put the client ID and secret in the API's `.env`:

   ```
   GOOGLE_SSO_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
   GOOGLE_SSO_CLIENT_SECRET=GOCSPX-…
   ```

4. Restart the API. The sign-in and sign-up pages now show **Continue with
   Google**.

A Google account signs in to the CoreTask account with the same address only
when Google says the address is verified (`email_verified`), which it does for
Gmail and Workspace addresses, and only once that CoreTask account has
confirmed its address itself — otherwise whoever registered it, who may not
own the address, would end up sharing the account. Either way, the person can
sign in with their password and connect Google in **Settings › Connected
accounts**.

## Microsoft

1. In the [Entra admin centre](https://entra.microsoft.com/), **Identity ›
   Applications › App registrations › New registration**.
   - **Supported account types:** "Accounts in any organizational directory
     and personal Microsoft accounts" for everyone; narrower if you like (see
     `MICROSOFT_SSO_TENANT` below).
   - **Redirect URI:** platform **Web**,
     `<API_URL>/api/v1/auth/sso/microsoft/callback`.
2. **Certificates & secrets › New client secret.** Copy the _value_ (not the
   secret ID) now; it is not shown again. Note its expiry: sign-in stops when
   it lapses.
3. **Token configuration › Add optional claim**, token type **ID**, and tick
   `email` and `xms_edov`. Accept the prompt to add the Microsoft Graph
   `email` permission.

   `xms_edov` ("email domain owner verified") is what says a work account's
   address is really theirs: an Entra admin can type any address into a user's
   profile, so without it CoreTask will not match a work account to an
   existing CoreTask account by address. Personal Microsoft accounts are
   always trusted.

4. **API permissions** should hold `openid`, `email` and `profile` (delegated).
   For a single-tenant app, grant admin consent.
5. Put the values in the API's `.env`:

   ```
   MICROSOFT_SSO_CLIENT_ID=00000000-0000-0000-0000-000000000000
   MICROSOFT_SSO_CLIENT_SECRET=…
   # common (work and personal), organizations (work only), consumers
   # (personal only), or one tenant's ID to admit only that organization.
   MICROSOFT_SSO_TENANT=common
   ```

6. Restart the API.

People are told apart by their tenant and object ID, so renaming someone, or
changing their address, keeps their CoreTask account connected.

## A workspace's SAML provider

Admins and owners set it up in **Settings › Single sign-on**. Nothing changes
for anyone until it is switched on.

### 1. Give your identity provider CoreTask's addresses

Choose **Get CoreTask's addresses**. CoreTask saves an empty connection,
switched off, and shows:

| CoreTask calls it    | Your provider may call it                                     |
| -------------------- | ------------------------------------------------------------- |
| Entity ID (audience) | Audience URI, SP Entity ID, Identifier                        |
| ACS URL (reply URL)  | Single sign-on URL, Reply URL, Assertion Consumer Service URL |
| Metadata URL         | SP metadata — some providers can read the two above from it   |

They look like
`<API_URL>/api/v1/auth/sso/saml/<connection-id>/metadata` and `…/acs`, and
stay the same for as long as the connection exists.

In your provider, make a SAML 2.0 app with those, and:

- **NameID:** something that never changes for the person — a persistent ID,
  or the e-mail address. CoreTask remembers people by it. A transient NameID
  works only for people at a verified domain, matched afresh each time.
- **Attributes:** `email` (or the standard
  `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress`), and
  optionally `firstName`/`givenName` and `lastName`/`surname` for new
  accounts' names. An emailAddress-format NameID serves as the address when
  there is no attribute.
- **Signing:** sign the assertion (the default almost everywhere), SHA-256.
  Signing the whole response as well is fine. Encrypted assertions are not
  supported.
- **Sign-in:** CoreTask starts sign-ins (SP-initiated); a sign-in started from
  the provider's dashboard is refused.

Assign the app to the people who should use it.

Provider notes:

- **Okta:** Applications › Create App Integration › SAML 2.0. _Single sign-on
  URL_ is the ACS URL, _Audience URI_ the entity ID, _Name ID format_
  EmailAddress or Persistent. Add an attribute statement `email` →
  `user.email`.
- **Microsoft Entra ID:** Enterprise applications › New application › Create
  your own (non-gallery) › Single sign-on › SAML. _Identifier_ is the entity
  ID, _Reply URL_ the ACS URL. The default claims already send the address.
- **Google Workspace:** Admin console › Apps › Web and mobile apps › Add custom
  SAML app. _ACS URL_ and _Entity ID_ as above, _Name ID_ Basic Information ›
  Primary email; map Primary email to `email`.

### 2. Fill in your provider's details

From the provider's setup or metadata page:

- **Identity provider entity ID** — the Issuer of its responses (Okta:
  _Identity Provider Issuer_; Entra: _Microsoft Entra Identifier_).
- **Sign-in URL** — where sign-in requests go (Okta: _Identity Provider Single
  Sign-On URL_; Entra: _Login URL_).
- **Signing certificate** — the X.509 certificate, as PEM or the bare base64;
  CoreTask wraps the bare kind.

Switch **Let people sign in with it** on and save. Then **Connect my account**
tries it: it goes to the provider and back to Settings, and connects your
account to it.

### 3. Verify your e-mail domains

Until a domain is verified, the provider signs in only people who connected it
to their account themselves (**Connect my account** in Settings), and they
must still be members of the workspace. Once `acme.com` is verified, anyone
the provider signs in with an `@acme.com` address gets in: an existing account
with that address is connected and added to the workspace as a member, and
someone with no account gets one.

Add the domain, then publish the TXT record CoreTask shows **at the domain
itself** (host `@`), e.g.

```
acme.com.  3600  IN  TXT  "coretask-verification=3f0c…"
```

and choose **Verify**. DNS can take a while to show a new record. A domain can
be verified by only one workspace; the record can be removed afterwards, but
keeping it does no harm.

### Signing in

People choose **Sign in with SSO** on the sign-in page and enter their work
address (for a verified domain) or the workspace's name from its link — `acme`
in `/w/acme`. Two-step verification, where they have turned it on, is still
asked for afterwards.

Removing the connection disconnects everyone from it; their accounts stay.
Someone who only ever signed in through it sets a password with **Forgot
password?**.

## Trying it locally

The API e2e suite (`api/test/e2e/sso.e2e-spec.ts`) stands in for all three:
Google's and Microsoft's token endpoints are a local server, and the SAML
provider is a key pair and certificate made in the test, signing responses as
Okta does. `GOOGLE_SSO_TOKEN_URL`, `GOOGLE_SSO_AUTHORIZE_URL`,
`GOOGLE_SSO_ISSUER` and `MICROSOFT_SSO_LOGIN_URL` exist for that, and need not
be set otherwise.
