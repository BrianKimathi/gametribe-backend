# Vercel Deployment Guide

This guide will help you deploy the GameTribe backend to Vercel.

## Prerequisites

1. Vercel account (sign up at https://vercel.com)
2. Vercel CLI installed: `npm i -g vercel`
3. Firebase project credentials

## Quick Deploy

```bash
cd gametribe-backend
vercel
```

Or connect your GitHub repository in the Vercel dashboard.

## Environment Variables to Set in Vercel Dashboard

Go to your Vercel project → Settings → Environment Variables and add:

### Firebase (REQUIRED)
```
FIREBASE_PROJECT_ID=gametibe2025
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-fbsvc@gametibe2025.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nYOUR_KEY_HERE\n-----END PRIVATE KEY-----\n
FIREBASE_DATABASE_URL=https://gametibe2025-default-rtdb.firebaseio.com
FIREBASE_STORAGE_BUCKET=gametibe2025.firebasestorage.app
```

### Email (REQUIRED)
```
EMAIL_SERVICE=gmail
EMAIL_USER=henrydave0480@gmail.com
EMAIL_PASSWORD=kpzh bmgi njci biyj
```

### M-Pesa (Optional - if using payments)
```
MPESA_CONSUMER_KEY=your_consumer_key
MPESA_CONSUMER_SECRET=your_consumer_secret
MPESA_SHORTCODE=174379
MPESA_PASSKEY=your_passkey
MPESA_CALLBACK_URL=https://your-vercel-app.vercel.app/api/payments/mpesa/webhook
MPESA_ENVIRONMENT=sandbox
```

### Stripe (Optional - if using payments)
```
STRIPE_SECRET_KEY=sk_live_your_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
```

### Webhook Secret (Optional)
```
WEBHOOK_SECRET=your_webhook_secret
```

## Important Notes

1. **Socket.IO**: Real-time Socket.IO features are disabled on Vercel (serverless limitation). REST API endpoints work fine.

2. **Firebase Private Key**: When setting `FIREBASE_PRIVATE_KEY` in Vercel, keep the `\n` characters - they will be converted to newlines automatically.

3. **Production URL**: After deployment, update your frontend/PlayChat to use the new Vercel URL instead of localhost.

## Deployment Steps

1. **Install Vercel CLI** (if not already installed):
   ```bash
   npm i -g vercel
   ```

2. **Login to Vercel**:
   ```bash
   vercel login
   ```

3. **Deploy**:
   ```bash
   cd gametribe-backend
   vercel
   ```

4. **Set Environment Variables**:
   - Go to Vercel Dashboard → Your Project → Settings → Environment Variables
   - Add all the required environment variables listed above

5. **Redeploy** (to apply env vars):
   ```bash
   vercel --prod
   ```

## Testing Deployment

After deployment, test the API:
```bash
curl https://your-app.vercel.app/api/health
```

## Custom Domain (Optional)

In Vercel Dashboard → Settings → Domains, add your custom domain (e.g., `api.gametribe.com`).

## Limitations

- **Socket.IO**: Not supported (use Firebase Realtime Database listeners as alternative)
- **WebSockets**: Not supported
- **Long-running tasks**: Limited to 30 seconds (can be increased with Pro plan)

## Troubleshooting

### Error: "Firebase not initialized"
- Check that all Firebase environment variables are set correctly
- Verify `FIREBASE_PRIVATE_KEY` includes `\n` characters for newlines

### Error: "Rate limit exceeded"
- Check that `DISABLE_RATE_LIMITING` is set to `false` in production
- Adjust rate limits in `middleware/rateLimiter.js` if needed

### Socket.IO connection fails
- This is expected on Vercel - Socket.IO is disabled
- Frontend should handle gracefully and use REST API polling instead
