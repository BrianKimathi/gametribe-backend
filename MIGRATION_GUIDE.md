# Challenge System Migration Guide

## Overview

We've migrated from encrypted challenges (`secureChallenges`) to unencrypted challenges (`challenges`) for better real-time performance.

## What Changed

### Database Structure
- **OLD**: `secureChallenges/{challengeId}` - Fully encrypted with AES-256-CBC
- **NEW**: `challenges/{challengeId}` - Unencrypted, uses Firebase security rules

### Benefits
1. ✅ Real-time Firebase listeners work directly
2. ✅ No decryption overhead
3. ✅ Frontend can read directly from Firebase
4. ✅ Simpler codebase
5. ✅ Better performance

### Security
- Firebase security rules protect data
- Only authenticated users can read challenges they're part of
- Wallet operations remain backend-controlled

## Migration Steps

### 1. Run the Migration Script

```bash
cd gametribe-backend
node scripts/migrate-challenges-to-v2.js
```

**What it does:**
- Reads all challenges from `secureChallenges`
- Decrypts each challenge
- Writes to new `challenges` node
- **Does NOT** delete old data (as backup)

### 2. Verify Migration

Check Firebase Console:
1. Go to Realtime Database
2. Verify `challenges` node has all challenges
3. Verify data is readable (not encrypted)

### 3. Test Backend

```bash
npm start
# or
npm run dev
```

Test endpoints:
- `POST /api/challenges/create` - Create challenge
- `POST /api/challenges/accept/:challengeId` - Accept challenge
- `GET /api/challenges/history` - Get history
- `GET /api/challenges/:challengeId` - Get details

### 4. Update Frontend (PlayChat)

The frontend will automatically work because:
- Backend API still works the same
- Firebase listeners can now read directly from `challenges`

**Optional**: Update frontend to read directly from Firebase for better real-time performance.

### 5. Clean Up (After Verification)

Once you've verified everything works:
1. Delete old `secureChallenges` node from Firebase
2. Remove encryption utilities (or keep as backup)

## Rollback Plan

If something goes wrong:
1. Old data is still in `secureChallenges` (not deleted)
2. Switch routes back to `challengeController` (old version)
3. Redeploy backend

## Files Modified

### Backend
- `controllers/challengeControllerV2.js` - New unencrypted controller
- `routes/challenges.js` - Updated to use V2
- `firebase-security-rules.json` - Added `challenges` rules
- `scripts/migrate-challenges-to-v2.js` - Migration script

### Frontend (No changes needed)
- PlayChat will work as-is
- Optional: Update to read directly from Firebase

## Testing Checklist

- [ ] Run migration script
- [ ] Verify challenges in Firebase Console
- [ ] Test creating challenge
- [ ] Test accepting challenge
- [ ] Test rejecting challenge
- [ ] Test canceling challenge
- [ ] Test submitting score
- [ ] Test getting history
- [ ] Test getting details
- [ ] Verify real-time updates work
- [ ] Test on frontend (PlayChat)

## Support

If you encounter issues:
1. Check logs in backend console
2. Verify Firebase rules are deployed
3. Verify encryption key is set correctly
4. Check migration script output

## Next Steps

After successful migration:
1. Monitor for any issues
2. Update frontend to use direct Firebase reads (optional)
3. Remove encryption code (optional)
4. Document changes in API




