// Firebase Configuration
// Replace these values with your Firebase project credentials
// Get them from Firebase Console: https://console.firebase.google.com/

const firebaseConfig = {
    apiKey: "AIzaSyDYb-5yacfYrk41YwwQD1hqvricJJk1viI",
    authDomain: "karaoke-58233.firebaseapp.com",
    databaseURL: "https://karaoke-58233-default-rtdb.firebaseio.com",
    projectId: "karaoke-58233",
    storageBucket: "karaoke-58233.firebasestorage.app",
    messagingSenderId: "950264063313",
    appId: "1:950264063313:web:862ac7f406eea00c715f70"
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
        
        console.log('✅ Firebase initialized for project: karaoke-58233');
        console.log('📝 NOTE: Configure Firebase Realtime Database Rules:');
        console.log('Go to Firebase Console > Realtime Database > Rules');
        console.log('Replace with: { "rules": { ".read": true, ".write": true } }');
        console.log('Then click "Publish" button');
    } catch (error) {
        console.warn('Firebase initialization skipped or failed:', error.message);
    }
} else {
    console.warn('Firebase SDK not loaded - using localStorage fallback');
}
