# Username-Only Password Reset Setup

This reset flow updates Firebase Authentication directly. It does not send email. The requester receives a temporary password in the open reset window after an administrator approves the request.

## Vercel Environment Variables

The project pins the Vercel runtime to Node 22. Add these variables to the Vercel project for Production, Preview, and Development, then redeploy:

- `FIREBASE_SERVICE_ACCOUNT_JSON`: the full JSON key for a dedicated Google Cloud service account. Grant only Firebase Authentication Admin and Firebase Realtime Database Admin roles.
- `RESET_PASSWORD_ENCRYPTION_KEY`: a random secret of at least 32 characters. Generate one locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` and enter it directly in Vercel. Never commit it or paste it into chat.

The service account key is server-only. Do not add it to Firebase client configuration, `.env` files tracked by Git, or browser code.

## How It Works

1. The user submits a username. The API limits requests to four per network per hour and returns a private session token that expires after 24 hours.
2. The admin queue lists reset requests. Approve and Reject require a Firebase ID token for an active account with the admin role.
3. Approval generates a temporary password and updates the matching Firebase Auth user's password using the server-only Admin SDK.
4. The temporary password is encrypted before it is stored. Only the browser session holding the private token can retrieve it from the API. The requester must keep that browser session available until approval, then copy the password and sign in.

Firebase Auth-linked accounts are updated through Firebase Admin. Legacy username/password accounts are updated in the existing `users` database record; on their next normal sign-in they can complete the Firebase Auth email-linking migration. Accounts with neither an Auth UID nor a legacy password cannot be reset.
