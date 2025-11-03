# Deploy to Vercel - Complete Setup

## 🚀 Quick Deploy

```bash
cd gametribe-backend
vercel
```

## 📋 Pre-Deployment Checklist

### 1. Install Vercel CLI
```bash
npm i -g vercel
```

### 2. Login to Vercel
```bash
vercel login
```

### 3. Deploy
```bash
cd gametribe-backend
vercel
```

## 🔐 Required Environment Variables in Vercel Dashboard

After initial deployment, go to **Vercel Dashboard → Your Project → Settings → Environment Variables** and add:

### ⚠️ CRITICAL: Firebase Private Key (REQUIRED)
You MUST set this in Vercel Dashboard (cannot be in vercel.json for security):

**Get your Firebase private key:**
1. Go to Firebase Console → Project Settings → Service Accounts
2. Click "Generate New Private Key"
3. Download the JSON file
4. Copy the `private_key` value (starts with `-----BEGIN PRIVATE KEY-----`)

**In Vercel Dashboard, add:**
```
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nYOUR_ACTUAL_KEY_HERE\n-----END PRIVATE KEY-----\n
```
**Important:** Keep the `\n` characters - they will be converted to actual newlines.

### Optional: M-Pesa (if using payments)
```
MPESA_CONSUMER_KEY=your_key
MPESA_CONSUMER_SECRET=your_secret
MPESA_SHORTCODE=174379
MPESA_PASSKEY=your_passkey
MPESA_CALLBACK_URL=https://your-app.vercel.app/api/payments/mpesa/webhook
MPESA_ENVIRONMENT=sandbox
```

### Optional: Stripe (if using payments)
```
STRIPE_SECRET_KEY=sk_live_your_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
```

## ✅ Already Hardcoded in vercel.json

These are already set (no need to add in dashboard):
- `NODE_ENV=production`
- `DISABLE_RATE_LIMITING=false`
- `MOBILE_APP_SECRET=gametribe-mobile-2025`
- `ALLOWED_ORIGINS` (all production URLs)
- `EMAIL_SERVICE=gmail`
- `EMAIL_USER=henrydave0480@gmail.com`
- `EMAIL_PASSWORD=kpzh bmgi njci biyj`
- `FIREBASE_PROJECT_ID=gametibe2025`
- `FIREBASE_DATABASE_URL=https://gametibe2025-default-rtdb.firebaseio.com`
- `FIREBASE_STORAGE_BUCKET=gametibe2025.firebasestorage.app`
- `FIREBASE_CLIENT_EMAIL=firebase-adminsdk-fbsvc@gametibe2025.iam.gserviceaccount.com`

## 🔄 After Setting Environment Variables

**Redeploy to apply changes:**
```bash
vercel --prod
```

Or in Vercel Dashboard: Deployments → Latest → Redeploy

## 📝 Notes

1. **Socket.IO**: Disabled on Vercel (serverless limitation). REST API works fine.
2. **Firebase Private Key**: MUST be set in Vercel Dashboard, NOT in code.
3. **Production URL**: After deployment, update frontend/PlayChat to use Vercel URL.

## 🧪 Test Deployment

```bash
# Test health endpoint
curl https://your-app.vercel.app/api/health

# Test challenges endpoint (requires auth token)
curl https://your-app.vercel.app/api/challenges/history
```

