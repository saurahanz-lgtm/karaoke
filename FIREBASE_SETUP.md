# Firebase Setup Guide for SDkaraoke

## Step 1: Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Create a project"
3. Enter project name: `sdkaraoke` (or your preferred name)
4. Accept terms and click "Create project"
5. Wait for the project to be created

## Step 2: Set Up Realtime Database

1. In Firebase Console, go to **Build** → **Realtime Database**
2. Click **Create Database**
3. Select region (closest to your users)
4. Start in **Test mode** (for development)
5. Click **Enable**

## Step 3: Get Your Firebase Config

1. In Firebase Console, go to **Project Settings** (gear icon)
2. Under "Your apps", click on the web app icon (</> icon)
3. If you don't have an app, click "Create app"
4. Copy the config object that looks like:
```javascript
const firebaseConfig = {
    apiKey: "AIzaSy...",
    authDomain: "your-project.firebaseapp.com",
    databaseURL: "https://your-project-default-rtdb.firebaseio.com",
    projectId: "your-project-id",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcd1234"
};
```

## Step 4: Update firebase-config.js

1. Open `firebase-config.js` in your project
2. Replace the placeholder values with your actual Firebase config
3. Save the file

## Step 5: Test the Connection

1. Deploy your project again: `vercel --prod`
2. Check the browser console (F12) for any Firebase errors
3. The app should now connect to Firebase

## Firebase Database Structure

The app expects the following structure in Firebase:

```
/
├── users/
│   └── {userId}
│       ├── username
│       ├── role (admin or singer)
│       └── password
├── songs/
│   └── {songId}
│       ├── title
│       ├── artist
│       └── videoId
├── queue/
│   └── {queueId}
│       ├── singer
│       ├── song
│       ├── status
│       └── timestamp
└── reservations/
    └── {reservationId}
        ├── user
        ├── song
        └── timestamp
```

## Security Rules (Test Mode Only)

For **development/testing**, the default test mode rules allow all reads and writes:
```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

⚠️ **IMPORTANT**: Before deploying to production, update your security rules:
```json
{
  "rules": {
    "users": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "songs": {
      ".read": true,
      ".write": "root.child('users').child(auth.uid).child('role').val() === 'admin'"
    },
    "queue": {
      ".read": true,
      ".write": "auth != null"
    },
    "reservations": {
      ".read": "auth != null",
      ".write": "auth != null"
    }
  }
}
```

## Integration Complete

Your app now has:
- ✅ Firebase SDK loaded in all HTML files
- ✅ Firebase configuration file created
- ✅ Database references ready to use
- ✅ All pages connected to Firebase Realtime Database

Next steps to fully utilize Firebase:
1. Update `admin.js` to use Firebase instead of localStorage
2. Update `singer.js` to sync with Firebase
3. Update `tv-display.js` to listen to real-time queue updates

Need help? Check Firebase Documentation: https://firebase.google.com/docs
