// Firebase Configuration
// Replace these values with your Firebase project credentials
// Get them from Firebase Console: https://console.firebase.google.com/

const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    databaseURL: "YOUR_DATABASE_URL",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Initialize Firebase only if firebase is defined and not already initialized
if (typeof firebase !== 'undefined') {
    try {
        // Check if already initialized
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        
        // Get reference to the database
        const database = firebase.database();
        
        // Firebase database references
        const usersRef = database.ref('users');
        const songsRef = database.ref('songs');
        const queueRef = database.ref('queue');
        const reservationsRef = database.ref('reservations');
    } catch (error) {
        console.warn('Firebase initialization skipped or failed:', error.message);
    }
} else {
    console.warn('Firebase SDK not loaded - using localStorage fallback');
}
